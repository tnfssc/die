#include <pulse/pulseaudio.h>
#include <webrtc-audio-processing-1/modules/audio_processing/include/audio_processing.h>
#include <glib.h>
#include <json-c/json.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <cerrno>
#include <climits>
#include <cstring>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace std;
namespace {
mutex output;
// A short write is not a frame. Finish it under the same lock, or fail the entire
// helper: silently skipping capture makes the session's audio timeline dishonest.
void event(const string& text) {
  lock_guard<mutex> lock(output);
  string line = text + "\n";
  size_t pos = 0;
  auto deadline = chrono::steady_clock::now() + chrono::milliseconds(200);
  while (pos < line.size()) {
    ssize_t n = write(STDOUT_FILENO, line.data() + pos, line.size() - pos);
    if (n > 0) { pos += size_t(n); continue; }
    if (n < 0 && errno == EINTR) continue;
    if (n < 0 && errno == EAGAIN) {
      auto left = chrono::duration_cast<chrono::milliseconds>(deadline - chrono::steady_clock::now()).count();
      if (left > 0) {
        pollfd fd{STDOUT_FILENO, POLLOUT, 0};
        if (poll(&fd, 1, int(left)) > 0) continue;
      }
    }
    static const char msg[] = "audio helper stdout backpressure/closed; terminating\n";
    write(STDERR_FILENO, msg, sizeof(msg) - 1);
    _Exit(74); // Parent receives EOF/nonzero status; never resume after a partial frame.
  }
}
void error(const char* code, const char* message) {
  event(string("{\"type\":\"error\",\"code\":\"") + code + "\",\"message\":\"" + message + "\"}");
}
int16_t load(const uint8_t* p) { return int16_t(p[0] | (unsigned(p[1]) << 8)); }
void store(uint8_t* p, int16_t s) { p[0] = s & 255; p[1] = (uint16_t(s) >> 8) & 255; }
bool get(json_object* o, const char* key, json_type type, json_object** value) {
  return json_object_object_get_ex(o, key, value) && json_object_get_type(*value) == type;
}

struct Lab {
  const char *source, *sink;
  pa_mainloop* loop = nullptr;
  pa_context* context = nullptr;
  pa_stream *input = nullptr, *outputStream = nullptr;
  unique_ptr<webrtc::AudioProcessing> apm;
  thread worker;
  atomic<bool> running{false}, ready{false};
  mutex queue;
  array<int16_t, 24000> ring{}; // One second max; never allocate on playback path.
  size_t head = 0, size = 0;
  int generation = 0;
  bool flushPending = false;
  vector<uint8_t> capture;
  size_t captureHead = 0;
  int lastQueued = -1;
  chrono::steady_clock::time_point lastReport{};
  chrono::steady_clock::time_point startTime{};
  chrono::steady_clock::time_point audioUntil{};

  Lab(const char* a, const char* b) : source(a), sink(b) {}
  ~Lab() { stop(); }
  static void contextState(pa_context*, void*) {}
  static void streamState(pa_stream*, void*) {}
  static void onRead(pa_stream* stream, size_t, void* userdata) {
    auto& self = *static_cast<Lab*>(userdata);
    while (pa_stream_readable_size(stream) > 0) {
      const void* data = nullptr; size_t n = 0;
      if (pa_stream_peek(stream, &data, &n) < 0) { self.fail("audio_input"); return; }
      if (!self.ready) { pa_stream_drop(stream); if (!n) break; continue; }
      if (data) {
        const auto* bytes = static_cast<const uint8_t*>(data);
        if (self.capture.size() - self.captureHead + n > 6400) {
          self.fail("audio_input"); return; // No silent microphone sample loss.
        }
        self.capture.insert(self.capture.end(), bytes, bytes + n);
      } else if (n) {
        self.fail("audio_input"); return; // Pulse hole is not a real mic sample.
      }
      pa_stream_drop(stream);
      if (!n) break;
    }
  }
  void fail(const char* code) {
    if (running.exchange(false)) error(code, "Audio device unavailable");
  }
  void closePulse() {
    if (input) { pa_stream_disconnect(input); pa_stream_unref(input); input = nullptr; }
    if (outputStream) { pa_stream_disconnect(outputStream); pa_stream_unref(outputStream); outputStream = nullptr; }
    if (context) { pa_context_disconnect(context); pa_context_unref(context); context = nullptr; }
    if (loop) { pa_mainloop_free(loop); loop = nullptr; }
    apm.reset();
  }
  void stop() {
    running = false;
    ready = false;
    if (worker.joinable()) worker.join(); // pa_mainloop_iterate(0): no blocking device calls.
    closePulse();
    lock_guard<mutex> lock(queue);
    head = size = 0;
    flushPending = false;
  }
  void start() {
    if (running) { error("state", "Audio already started"); return; }
    stop();
    apm.reset(webrtc::AudioProcessingBuilder().Create());
    if (!apm) { error("audio_start", "Could not initialize echo processing"); return; }
    webrtc::AudioProcessing::Config config;
    config.echo_canceller.enabled = true;
    config.noise_suppression.enabled = true;
    apm->ApplyConfig(config);
    if (apm->Initialize() != 0) { error("audio_start", "Could not initialize echo processing"); stop(); return; }
    loop = pa_mainloop_new();
    if (loop) context = pa_context_new(pa_mainloop_get_api(loop), "die-live-lab");
    if (!context || pa_context_connect(context, nullptr, PA_CONTEXT_NOFLAGS, nullptr) < 0) {
      error("audio_start", "Could not connect to audio server"); stop(); return;
    }
    pa_context_set_state_callback(context, contextState, this);
    capture.clear(); captureHead = 0; packetHalf = 0; lastQueued = -1; audioUntil = {};
    startTime = chrono::steady_clock::now();
    running = true;
    worker = thread([this] { pump(); });
  }
  bool openStreams() {
    pa_sample_spec mic{PA_SAMPLE_S16LE, 16000, 1}, speaker{PA_SAMPLE_S16LE, 24000, 1};
    input = pa_stream_new(context, "voice capture", &mic, nullptr);
    outputStream = pa_stream_new(context, "voice playback", &speaker, nullptr);
    if (!input || !outputStream) return false;
    pa_stream_set_state_callback(input, streamState, this);
    pa_stream_set_state_callback(outputStream, streamState, this);
    pa_stream_set_read_callback(input, onRead, this);
    pa_buffer_attr ia{uint32_t(-1), uint32_t(-1), uint32_t(-1), uint32_t(-1), 320};
    pa_buffer_attr oa{1920, 960, uint32_t(-1), 480, uint32_t(-1)};
    return pa_stream_connect_record(input, source, &ia, pa_stream_flags_t(PA_STREAM_ADJUST_LATENCY | PA_STREAM_DONT_MOVE)) >= 0 &&
           pa_stream_connect_playback(outputStream, sink, &oa, pa_stream_flags_t(PA_STREAM_ADJUST_LATENCY | PA_STREAM_DONT_MOVE),
                                      nullptr, nullptr) >= 0;
  }
  void reportQueue(bool force = false) {
    int ms;
    { lock_guard<mutex> lock(queue); ms = int(size / 24); }
    pa_usec_t latency = 0; int negative = 0;
    if (ready && chrono::steady_clock::now() < audioUntil &&
        pa_stream_get_latency(outputStream, &latency, &negative) == 0 && !negative)
      ms += int(min<pa_usec_t>(latency / 1000, 1000));
    auto now = chrono::steady_clock::now();
    if (force || (ms != lastQueued &&
        (lastQueued < 0 || ms == 0 || now - lastReport >= chrono::milliseconds(100)))) {
      lastQueued = ms; lastReport = now;
      event("{\"type\":\"played\",\"queuedMs\":" + to_string(ms) + "}");
    }
  }
  void render() {
    if (!ready) return;
    while (running && pa_stream_writable_size(outputStream) >= 480) {
      array<uint8_t, 480> bytes{};
      bool flush = false;
      bool hasAudio = false;
      {
        lock_guard<mutex> lock(queue);
        flush = flushPending;
        if (flush) { flushPending = false; }
        else for (int i = 0; i < 240; ++i) {
          int16_t s = 0;
          if (size) { hasAudio = true; s = ring[head]; head = (head + 1) % ring.size(); --size; }
          store(bytes.data() + 2*i, s);
        }
      }
      if (flush) {
        pa_operation* op = pa_stream_flush(outputStream, nullptr, nullptr);
        if (!op) { fail("audio_output"); return; }
        pa_operation_unref(op);
        if (apm->Initialize() != 0) { fail("audio_processing"); return; }
        continue;
      }
      // 24k -> 16k band-limited conversion: a small 3:2 FIR, instead of
      // interpolating samples (which aliases 8-12k energy into the AEC reference).
      array<int16_t, 160> ref{};
      for (int i = 0; i < 160; ++i) {
        double center = i * 1.5;
        double sum = 0, weight = 0;
        for (int tap = -8; tap <= 8; ++tap) {
          int j = int(center) + tap;
          double x = j - center;
          double sinc = x == 0 ? 1 : sin(3.141592653589793 * x * 2 / 3) / (3.141592653589793 * x * 2 / 3);
          double window = 0.5 + 0.5 * cos(3.141592653589793 * x / 9);
          double w = sinc * window;
          sum += load(bytes.data() + 2*clamp(j, 0, 239)) * w;
          weight += w;
        }
        ref[i] = int16_t(clamp(lround(sum / weight), -32768L, 32767L));
      }
      if (apm->ProcessReverseStream(ref.data(), {16000, 1}, {16000, 1}, ref.data()) != 0) {
        fail("audio_processing"); return;
      }
      if (pa_stream_write(outputStream, bytes.data(), bytes.size(), nullptr, 0, PA_SEEK_RELATIVE) < 0) {
        fail("audio_output"); return;
      }
      if (hasAudio) {
        pa_usec_t latency = 0; int negative = 0;
        if (pa_stream_get_latency(outputStream, &latency, &negative) < 0 || negative) latency = 20000;
        audioUntil = chrono::steady_clock::now() + chrono::microseconds(latency + 10000);
      }
    }
  }
  void processCapture() {
    while (running && capture.size() - captureHead >= 320) {
      array<int16_t, 160> frame{};
      static_assert(sizeof(frame) == 320);
      for (int i = 0; i < 160; ++i) frame[i] = load(capture.data() + captureHead + 2*i);
      captureHead += 320;
      pa_usec_t outLatency = 0, inLatency = 0; int negative = 0;
      if (pa_stream_get_latency(outputStream, &outLatency, &negative) < 0 || negative) outLatency = 0;
      if (pa_stream_get_latency(input, &inLatency, &negative) < 0 || negative) inLatency = 0;
      apm->set_stream_delay_ms(min<int>(500, (outLatency + inLatency) / 1000));
      if (apm->ProcessStream(frame.data(), {16000, 1}, {16000, 1}, frame.data()) != 0) {
        fail("audio_processing"); return;
      }
      for (int i = 0; i < 160; ++i) store(packet.data() + packetHalf * 320 + 2*i, frame[i]);
      if (++packetHalf == 2) {
        gchar* encoded = g_base64_encode(packet.data(), packet.size());
        event(string("{\"type\":\"capture\",\"data\":\"") + encoded + "\"}");
        g_free(encoded);
        packetHalf = 0;
      }
    }
    if (captureHead) {
      capture.erase(capture.begin(), capture.begin() + captureHead);
      captureHead = 0;
    }
  }
  array<uint8_t, 640> packet{};
  int packetHalf = 0;
  void pump() {
    bool opening = false;
    while (running) {
      int result = 0;
      if (pa_mainloop_iterate(loop, 0, &result) < 0) { fail("audio_device"); break; }
      auto state = pa_context_get_state(context);
      if (state == PA_CONTEXT_FAILED || state == PA_CONTEXT_TERMINATED) { fail("audio_device"); break; }
      if (state == PA_CONTEXT_READY && !opening) {
        opening = true;
        if (!openStreams()) { fail("audio_start"); break; }
      }
      if (opening) {
        auto a = pa_stream_get_state(input), b = pa_stream_get_state(outputStream);
        if (a == PA_STREAM_FAILED || b == PA_STREAM_FAILED || a == PA_STREAM_TERMINATED || b == PA_STREAM_TERMINATED) {
          fail("audio_device"); break;
        }
        if (!ready && a == PA_STREAM_READY && b == PA_STREAM_READY) {
          ready = true;
          event("{\"type\":\"ready\"}"); // never deliver capture before ready
        }
      }
      if (chrono::steady_clock::now() - startTime > chrono::seconds(5) && !ready) {
        fail("audio_start"); break;
      }
      if (ready) {
        // Flush even if Pulse has no writable space.
        bool flush;
        { lock_guard<mutex> lock(queue); flush = flushPending; if (flush) flushPending = false; }
        if (flush) {
          pa_operation* op = pa_stream_flush(outputStream, nullptr, nullptr);
          if (!op) { fail("audio_output"); break; }
          pa_operation_unref(op);
          packetHalf = 0;
          if (apm->Initialize() != 0) { fail("audio_processing"); break; }
          audioUntil = {};
          reportQueue(true);
        }
        render();
        processCapture();
        reportQueue();
      }
      this_thread::sleep_for(chrono::milliseconds(2));
    }
  }
  void command(json_object* obj) {
    json_object* t;
    if (!get(obj, "type", json_type_string, &t)) { error("protocol", "Missing type"); return; }
    const char* action = json_object_get_string(t);
    if (!strcmp(action, "start")) { start(); return; }
    if (!strcmp(action, "stop")) { stop(); event("{\"type\":\"stopped\"}"); return; }
    if (!strcmp(action, "flush") || !strcmp(action, "play")) {
      json_object* g;
      if (!get(obj, "generation", json_type_int, &g)) { error("generation", "Invalid generation"); return; }
      int64_t gen = json_object_get_int64(g);
      if (gen < 0 || gen > INT32_MAX) { error("generation", "Invalid generation"); return; }
      if (!strcmp(action, "flush")) {
        lock_guard<mutex> lock(queue);
        if (gen <= generation) { error("generation", "Flush generation must increase"); return; }
        generation = int(gen); head = size = 0; flushPending = running;
        return;
      }
      if (!ready) { error("state", "Start audio before play"); return; }
      json_object* d;
      if (!get(obj, "data", json_type_string, &d)) { error("play", "Invalid PCM16 data or generation"); return; }
      const char* text = json_object_get_string(d);
      size_t len = json_object_get_string_len(d);
      if (!len || len > 64000 || len % 4) { error("play", "Invalid PCM16 data or generation"); return; }
      size_t n = 0;
      guchar* bytes = g_base64_decode(text, &n);
      gchar* canonical = g_base64_encode(bytes, n);
      bool valid = !strcmp(text, canonical) && n && n <= 48000 && n % 2 == 0;
      g_free(canonical);
      if (!valid) { g_free(bytes); error("play", "Invalid PCM16 data or generation"); return; }
      {
        lock_guard<mutex> lock(queue);
        if (gen != generation) { g_free(bytes); error("play", "Invalid PCM16 data or generation"); return; }
        if (n/2 > ring.size() - size) { g_free(bytes); error("playback_full", "Playback ring full; tail dropped"); return; }
        for (size_t i = 0; i < n/2; ++i) ring[(head + size + i) % ring.size()] = load(bytes + 2*i);
        size += n/2;
      }
      g_free(bytes);
      // Pump emits current queue depth, including Pulse's pending render latency.
      return;
    }
    error("protocol", "Unknown command");
  }
};
} // namespace

int main(int argc, char** argv) {
  signal(SIGPIPE, SIG_IGN);
  const char *source = getenv("LIVE_LAB_SOURCE"), *sink = getenv("LIVE_LAB_SINK");
  for (int i = 1; i < argc; ++i) {
    if (!strcmp(argv[i], "--help")) { puts("live-lab-audio-linux [--source NAME] [--sink NAME] [--self-test]\nNo devices opened until start."); return 0; }
    if (!strcmp(argv[i], "--self-test")) { puts("live-lab-audio-linux: build OK"); return 0; }
    bool s = !strcmp(argv[i], "--source"), o = !strcmp(argv[i], "--sink");
    if (!(s || o) || ++i == argc || !*argv[i] || strlen(argv[i]) > 255) {
      fputs("Invalid argument (see --help)\n", stderr); return 2;
    }
    if (s) source = argv[i]; else sink = argv[i];
  }
  int flags = fcntl(STDOUT_FILENO, F_GETFL);
  if (flags >= 0) fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK);
  Lab lab(source, sink);
  event("{\"type\":\"hello\",\"protocol\":1}");
  char line[100002];
  while (fgets(line, sizeof(line), stdin)) {
    size_t n = strlen(line);
    if (!n || line[n-1] != '\n') {
      int ch; while ((ch = fgetc(stdin)) != EOF && ch != '\n') {}
      error("protocol", "Command too large"); continue;
    }
    json_tokener* tok = json_tokener_new();
    json_object* cmd = json_tokener_parse_ex(tok, line, n);
    if (json_tokener_get_error(tok) != json_tokener_success || !cmd || json_object_get_type(cmd) != json_type_object)
      error("protocol", "Invalid JSON command");
    else lab.command(cmd);
    if (cmd) json_object_put(cmd);
    json_tokener_free(tok);
  }
  lab.stop();
}
