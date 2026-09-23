import Foundation
import AVFoundation
import Darwin

// Input tap never emits JSON or allocates: it copies at most 1024 mono frames into a bounded SPSC ring.
// Output callback only pulls from the bounded PCM ring. The command queue alone produces playback.
final class CaptureResampler {
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var targetFormat: AVAudioFormat?
    private var pending = Data()
    private var rate: Double = 0
    func reset() { converter = nil; sourceFormat = nil; targetFormat = nil; pending.removeAll(keepingCapacity: true); rate = 0 }
    func feed(_ samples: UnsafeBufferPointer<Float>, rate newRate: Double, emit: (Data) -> Void) {
        guard newRate >= 8000 && newRate <= 192000 && samples.count <= 1024 else { return }
        if newRate != rate {
            reset(); rate = newRate
            sourceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: newRate, channels: 1, interleaved: false)
            targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)
            guard let sourceFormat, let targetFormat else { return }
            converter = AVAudioConverter(from: sourceFormat, to: targetFormat)
        }
        guard let sourceFormat, let targetFormat, let converter,
              let input = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: AVAudioFrameCount(samples.count)),
              let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: 4096),
              let inputData = input.floatChannelData?[0] else { return }
        input.frameLength = AVAudioFrameCount(samples.count)
        inputData.update(from: samples.baseAddress!, count: samples.count)
        var supplied = false
        while true {
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { _, inputStatus in
                if supplied { inputStatus.pointee = .noDataNow; return nil }
                supplied = true; inputStatus.pointee = .haveData; return input
            }
            if failure != nil { reset(); return }
            if let data = output.floatChannelData?[0] {
                for i in 0..<Int(output.frameLength) {
                    let value = data[i]
                    let scaled = value.isFinite ? Int(max(-32768, min(32767, (Double(value) * 32768).rounded()))) : 0
                    let bits = UInt16(bitPattern: Int16(scaled))
                    pending.append(UInt8(truncatingIfNeeded: bits))
                    pending.append(UInt8(truncatingIfNeeded: bits >> 8))
                }
                while pending.count >= 640 {
                    emit(Data(pending.prefix(640)))
                    pending.removeFirst(640)
                }
            }
            if status != .haveData || output.frameLength == 0 { break }
        }
    }
}

func parse(_ line: String) -> [String: Any]? {
    guard let data = line.data(using: .utf8), data.count <= 1_000_000,
          let value = try? JSONSerialization.jsonObject(with: data),
          let object = value as? [String: Any], object["type"] is String else { return nil }
    return object
}
func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let n = number.doubleValue
    guard n.isFinite && n >= 0 && n <= Double(Int32.max) && n.rounded() == n else { return nil }
    return Int(n)
}
import CoreFoundation

if CommandLine.arguments.count > 1 {
    switch CommandLine.arguments[1] {
    case "--help":
        print("live-lab-helper: JSON lines on stdin/stdout. Commands: start, play(data, generation), flush(generation), stop. Run --self-test without devices.")
        exit(0)
    case "--self-test":
        let resampler = CaptureResampler()
        let input = [Float](repeating: 0.25, count: 48000)
        var frames = 0
        for start in stride(from: 0, to: input.count, by: 1024) {
            input[start..<min(start + 1024, input.count)].withUnsafeBufferPointer { samples in
                resampler.feed(samples, rate: 48000) { data in
                    if data.count == 640 { frames += 1 }
                }
            }
        }
        guard ll_self_test() != 0, frames >= 49 && frames <= 50,
              parse("{\"type\":\"start\"}")?["type"] as? String == "start",
              parse("invalid") == nil, integer(1.5) == nil, integer(2) == 2 else {
            fputs("self-test failed\n", stderr); exit(1)
        }
        print("self-test passed: protocol, ring, flush, capture and 48k->16k framing")
        exit(0)
    default: fputs("unknown option; use --help\n", stderr); exit(2)
    }
}

final class Lab {
    let core = ll_create()!
    let output = DispatchQueue(label: "live-lab.json-output")
    let resampler = CaptureResampler()
    var engine: AVAudioEngine?
    var timer: DispatchSourceTimer?
    var notification: NSObjectProtocol?
    var starting = false
    var captureRate: Double = 0
    var reportedQueuedMs = 0 // output queue only
    var running = false // output queue only
    var zeroSince: DispatchTime? // output queue only
    let inputSlots = DispatchSemaphore(value: 8)
    let eventSlots = DispatchSemaphore(value: 32)
    // A blocked stdout cannot buffer audio indefinitely: fail closed on backpressure.
    func writeEvent(_ object: [String: Any]) {
        guard let bytes = try? JSONSerialization.data(withJSONObject: object) else { _exit(74) }
        var line = bytes; line.append(10)
        line.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(STDOUT_FILENO, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if n > 0 { offset += n }
                else if n < 0 && errno == EINTR { continue }
                else { _exit(74) }
            }
        }
    }
    func event(_ object: [String: Any]) {
        eventSlots.wait() // never called from a realtime callback or the output queue
        output.async { self.writeEvent(object); self.eventSlots.signal() }
    }
    func error(_ code: String, _ message: String) { event(["type":"error", "code":code, "message":message]) }
    func start() {
        guard engine == nil && !starting else { error("state", "Audio is already starting or running"); return }
        starting = true
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: open()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    if !self.starting { return }
                    if granted { self.open() }
                    else { self.starting = false; self.error("permission", "Microphone permission denied") }
                }
            }
        default: starting = false; error("permission", "Microphone permission denied")
        }
    }
    func open() {
        guard starting else { return }
        let audio = AVAudioEngine()
        do {
            try audio.inputNode.setVoiceProcessingEnabled(true)
            guard audio.inputNode.isVoiceProcessingEnabled else { throw NSError(domain: "voice-processing", code: 1) }
            let inputFormat = audio.inputNode.outputFormat(forBus: 0)
            guard inputFormat.channelCount > 0, inputFormat.commonFormat == .pcmFormatFloat32,
                  !inputFormat.isInterleaved, inputFormat.sampleRate >= 8000,
                  inputFormat.sampleRate <= 192000 else { throw NSError(domain: "input-format", code: 1) }
            captureRate = inputFormat.sampleRate
            let mixFormat = audio.mainMixerNode.outputFormat(forBus: 0)
            guard let sourceFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                sampleRate: mixFormat.sampleRate, channels: 1, interleaved: false),
                mixFormat.sampleRate >= 24000 else { throw NSError(domain: "output-format", code: 1) }
            let source = AVAudioSourceNode { [core, rate = mixFormat.sampleRate] _, _, frameCount, buffers -> OSStatus in
                let list = UnsafeMutableAudioBufferListPointer(buffers)
                guard list.count == 1, let first = list.first, let memory = first.mData,
                      first.mDataByteSize >= frameCount * 4 else { return -1 }
                let frames = Int(frameCount)
                ll_render(core, memory.assumingMemoryBound(to: Float.self), Int32(frames), rate)
                return noErr
            }
            audio.attach(source)
            audio.connect(source, to: audio.mainMixerNode, format: sourceFormat)
            audio.inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [core] buffer, _ in
                guard let channel = buffer.floatChannelData?[0] else { return }
                var offset = 0
                let length = Int(buffer.frameLength)
                while offset < length {
                    let n = min(Int(LL_CAPTURE_SAMPLES), length - offset)
                    _ = ll_capture_push(core, channel + offset, Int32(n))
                    offset += n
                }
            }
            notification = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: audio, queue: .main) { [weak self] _ in
                self?.error("route_lost", "Audio device route changed; restart with start after stop")
                self?.stop()
            }
            try audio.start()
            engine = audio
            starting = false
            let t = DispatchSource.makeTimerSource(queue: output)
            t.schedule(deadline: .now() + .milliseconds(10), repeating: .milliseconds(10))
            output.sync { self.resampler.reset(); self.running = true; self.reportedQueuedMs = 0; self.zeroSince = nil }
            event(["type":"ready"])
            t.setEventHandler { [weak self] in
                guard let self, self.running else { return }
                self.drainCapture()
                let dropped = ll_capture_dropped(self.core)
                if dropped > 0 { self.writeEvent(["type":"error", "code":"capture_overflow", "message":"Capture ring overflow: \(dropped) frames lost"]) }
                let queued = Int(ll_queued_ms(self.core))
                if queued > 0 { self.zeroSince = nil }
                else if self.zeroSince == nil { self.zeroSince = .now() }
                // Ring drained does not certify mixer/OS/hardware silence.
                let visible = queued == 0 && .now().uptimeNanoseconds - (self.zeroSince?.uptimeNanoseconds ?? 0) < 200_000_000 ? max(1, self.reportedQueuedMs) : queued
                if visible != self.reportedQueuedMs {
                    self.reportedQueuedMs = visible
                    self.writeEvent(["type":"played", "queuedMs":visible])
                }
            }
            timer = t; t.resume()
        } catch {
            audio.inputNode.removeTap(onBus: 0)
            if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }
            audio.stop(); starting = false
            self.error("audio_start", "Could not start default audio route with voice processing")
        }
    }
    func drainCapture() {
        guard running else { return }
        var samples = [Float](repeating: 0, count: 1024)
        samples.withUnsafeMutableBufferPointer { ptr in
            while true {
                let n = Int(ll_capture_pop(core, ptr.baseAddress!))
                if n <= 0 { break }
                resampler.feed(UnsafeBufferPointer(start: ptr.baseAddress!, count: n), rate: captureRate) { data in
                    self.writeEvent(["type":"capture", "data":data.base64EncodedString()])
                }
            }
        }
    }
    func stop() {
        starting = false
        if let notification { NotificationCenter.default.removeObserver(notification); self.notification = nil }
        timer?.cancel(); timer = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop(); engine = nil
        ll_flush(core, ll_generation(core) + 1)
        output.sync {
            self.running = false
            self.resampler.reset()
            self.reportedQueuedMs = 0
            self.zeroSince = nil
            var discarded = [Float](repeating: 0, count: Int(LL_CAPTURE_SAMPLES))
            discarded.withUnsafeMutableBufferPointer { ptr in
                while ll_capture_pop(self.core, ptr.baseAddress!) > 0 {}
            }
            _ = ll_capture_dropped(self.core)
            self.writeEvent(["type":"played", "queuedMs":0])
            self.writeEvent(["type":"stopped"])
        }
    }
    func command(_ c: [String: Any]) {
        guard let type = c["type"] as? String else { error("protocol", "Missing type"); return }
        switch type {
        case "start": start()
        case "stop": stop()
        case "flush":
            guard let generation = integer(c["generation"]), generation > ll_generation(core) else {
                error("generation", "Flush generation must increase"); return
            }
            ll_flush(core, Int32(generation))
            output.sync { self.zeroSince = nil; self.reportedQueuedMs = 0; self.writeEvent(["type":"played", "queuedMs":0]) }
        case "play":
            guard engine != nil else { error("state", "Start audio before play"); return }
            guard let generation = integer(c["generation"]), generation == ll_generation(core),
                  let encoded = c["data"] as? String, encoded.count <= 64000,
                  let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count % 2 == 0,
                  bytes.count <= 48000 else { error("play", "Invalid PCM16 data or generation"); return }
            let count = bytes.count / 2
            var samples = [Int16](repeating: 0, count: count)
            for i in 0..<count { samples[i] = Int16(bitPattern: UInt16(bytes[i*2]) | (UInt16(bytes[i*2+1]) << 8)) }
            let accepted = samples.withUnsafeBufferPointer { ptr in
                ll_play_push_batch(core, ptr.baseAddress!, Int32(count), Int32(generation)) != 0
            }
            if !accepted { error("playback_full", "Playback ring full; entire play command rejected"); return }
            event(["type":"played", "queuedMs":max(1, ll_queued_ms(core))])
        default: error("protocol", "Unknown command")
        }
    }
}
let flags = fcntl(STDOUT_FILENO, F_GETFL)
if flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) < 0 { _exit(74) }
let lab = Lab()
lab.event(["type":"hello", "protocol":1])
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        lab.inputSlots.wait()
        let parsed = parse(line)
        DispatchQueue.main.async {
            if let parsed { lab.command(parsed) }
            else { lab.error("protocol", "Invalid JSON command") }
            lab.inputSlots.signal()
        }
    }
    DispatchQueue.main.async { lab.stop(); exit(0) }
}
dispatchMain()
