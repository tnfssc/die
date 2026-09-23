#include <pulse/simple.h>
#include <modules/audio_processing/include/audio_processing.h>
#include <json-c/json.h>
#include <glib.h>
#include <array>
#include <atomic>
#include <algorithm>
#include <mutex>
#include <thread>
#include <string>
#include <cstring>
#include <cstdio>
#include <cerrno>
#include <cstdlib>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
using namespace std;
namespace {
mutex output;
void event(const string& s, bool capture=false) { lock_guard<mutex> l(output); string line=s+"\n"; ssize_t n=write(1,line.data(),line.size()); if(n<0 && errno==EAGAIN && !capture) { pollfd fd{1,POLLOUT,0}; if(poll(&fd,1,100)>0) n=write(1,line.data(),line.size()); } if(n != (ssize_t)line.size() && !capture) fputs("audio helper stdout unavailable\n",stderr); }
void error(const char* code,const char* msg) { event(string("{\"type\":\"error\",\"code\":\"")+code+"\",\"message\":\""+msg+"\"}"); }
int16_t load(const uint8_t* p) { return (int16_t)(p[0] | (unsigned(p[1])<<8)); }
void store(uint8_t* p,int16_t s) { p[0]=s&255; p[1]=(uint16_t(s)>>8)&255; }
bool get(json_object* o,const char* key,json_type t,json_object** v) { return json_object_object_get_ex(o,key,v) && json_object_get_type(*v)==t; }
struct Lab {
 const char *src,*sink; pa_simple *in=nullptr,*out=nullptr;
 unique_ptr<webrtc::AudioProcessing> apm;
 mutex queue,process,pulseOutput; thread player,reader; atomic<bool> running{false};
 array<int16_t,24000> ring{}; size_t head=0,size=0; int generation=0; bool flush=false;
 Lab(const char* a,const char* b):src(a),sink(b){}
 void deviceError(const char* code) { if(running.exchange(false)) error(code,"Audio device unavailable"); }
 void stop() { running=false; if(player.joinable()) player.join(); if(reader.joinable()) reader.join(); if(in) pa_simple_free(in); if(out) pa_simple_free(out); in=out=nullptr; apm.reset(); }
 void start() {
  if(running) { error("state","Audio already started"); return; } stop();
  int e=0; pa_sample_spec capture{PA_SAMPLE_S16LE,16000,1},render{PA_SAMPLE_S16LE,24000,1};
  pa_buffer_attr ia{uint32_t(-1),uint32_t(-1),uint32_t(-1),uint32_t(-1),640};
  pa_buffer_attr oa{uint32_t(-1),960,uint32_t(-1),uint32_t(-1),uint32_t(-1)};
  in=pa_simple_new(nullptr,"die-live-lab",PA_STREAM_RECORD,src,"voice capture",&capture,nullptr,&ia,&e);
  if(!in) { error("audio_start","Could not open input audio device"); return; }
  out=pa_simple_new(nullptr,"die-live-lab",PA_STREAM_PLAYBACK,sink,"voice playback",&render,nullptr,&oa,&e);
  if(!out) { error("audio_start","Could not open output audio device"); stop(); return; }
  apm.reset(webrtc::AudioProcessingBuilder().Create());
  if(!apm) { error("audio_start","Could not initialize echo processing"); stop(); return; }
  webrtc::AudioProcessing::Config config; config.echo_canceller.enabled=true; config.noise_suppression.enabled=true;
  apm->ApplyConfig(config);
  if(apm->Initialize()!=0) { error("audio_start","Could not initialize echo processing"); stop(); return; }
  { lock_guard<mutex> l(queue); head=size=0; flush=false; }
  running=true; player=thread([this]{play();}); reader=thread([this]{record();}); event("{\"type\":\"ready\"}");
 }
 void play() {
  array<uint8_t,480> bytes{}; array<int16_t,160> ref{};
  while(running) {
   bool doFlush=false;
   { lock_guard<mutex> l(queue); doFlush=flush; flush=false;
     if(!doFlush) for(int i=0;i<240;i++) { int16_t v=0; if(size) { v=ring[head]; head=(head+1)%ring.size(); --size; } store(bytes.data()+2*i,v); }
   }
   if(doFlush) { int e=0; { lock_guard<mutex> l(pulseOutput); if(pa_simple_flush(out,&e)<0) { deviceError("audio_output"); break; } } lock_guard<mutex> l(process); if(apm->Initialize()!=0) { deviceError("audio_processing"); break; } continue; }
   for(int i=0;i<160;i++) { int j=i*3/2; int a=load(bytes.data()+2*j),b=load(bytes.data()+2*min(j+1,239)); ref[i]=i%2?(a+b)/2:a; }
   { lock_guard<mutex> l(process); if(apm->ProcessReverseStream(ref.data(),{16000,1},{16000,1},ref.data())!=0) { deviceError("audio_processing"); break; } }
   int e=0; lock_guard<mutex> l(pulseOutput); if(pa_simple_write(out,bytes.data(),bytes.size(),&e)<0) { deviceError("audio_output"); break; }
  }
 }
 void record() {
  array<uint8_t,320> data{}; array<int16_t,160> pcm{}; array<uint8_t,640> packet{}; int half=0;
  while(running) {
   int e=0; if(pa_simple_read(in,data.data(),data.size(),&e)<0) { deviceError("audio_input"); break; } if(!running) break;
   for(int i=0;i<160;i++) pcm[i]=load(data.data()+2*i);
   pa_usec_t a; { lock_guard<mutex> l(pulseOutput); a=pa_simple_get_latency(out,&e); } pa_usec_t b=pa_simple_get_latency(in,&e);
   if(a==pa_usec_t(-1)) a=20000; if(b==pa_usec_t(-1)) b=10000;
   { lock_guard<mutex> l(process); apm->set_stream_delay_ms(min<int>(500,(a+b)/1000));
     if(apm->ProcessStream(pcm.data(),{16000,1},{16000,1},pcm.data())!=0) { deviceError("audio_processing"); break; } }
   for(int i=0;i<160;i++) store(packet.data()+half*320+i*2,pcm[i]);
   if(++half==2) { gchar* encoded=g_base64_encode(packet.data(),packet.size()); event(string("{\"type\":\"capture\",\"data\":\"")+encoded+"\"}",true); g_free(encoded); half=0; }
  }
 }
 void command(json_object* o) {
  json_object* t; if(!get(o,"type",json_type_string,&t)) { error("protocol","Missing type"); return; }
  const char* action=json_object_get_string(t);
  if(!strcmp(action,"start")) { start(); return; }
  if(!strcmp(action,"stop")) { stop(); event("{\"type\":\"stopped\"}"); return; }
  if(!strcmp(action,"flush") || !strcmp(action,"play")) {
   json_object* g; if(!get(o,"generation",json_type_int,&g)) { error("generation","Invalid generation"); return; }
   int64_t gen=json_object_get_int64(g); if(gen<0 || gen>INT32_MAX) { error("generation","Invalid generation"); return; }
   lock_guard<mutex> l(queue);
   if(!strcmp(action,"flush")) { if(gen<=generation) { error("generation","Flush generation must increase"); return; } generation=gen; size=head=0; flush=running; return; }
   json_object* d; if(!running) { error("state","Start audio before play"); return; }
   if(gen!=generation || !get(o,"data",json_type_string,&d)) { error("play","Invalid PCM16 data or generation"); return; }
   const char* text=json_object_get_string(d); size_t len=json_object_get_string_len(d);
   if(!len || len>64000 || len%4) { error("play","Invalid PCM16 data or generation"); return; }
   size_t n=0; guchar* bytes=g_base64_decode(text,&n); gchar* canonical=g_base64_encode(bytes,n);
   bool valid=!strcmp(text,canonical) && n && n<=48000 && n%2==0; g_free(canonical);
   if(!valid) { g_free(bytes); error("play","Invalid PCM16 data or generation"); return; }
   if(n/2>ring.size()-size) { g_free(bytes); error("playback_full","Playback ring full; tail dropped"); return; }
   for(size_t i=0;i<n/2;i++) ring[(head+size+i)%ring.size()]=load(bytes+2*i);
   size+=n/2; g_free(bytes); event("{\"type\":\"played\",\"queuedMs\":"+to_string(size/24)+"}"); return;
  }
  error("protocol","Unknown command");
 }
};
}
int main(int argc,char** argv) {
 const char *source=getenv("LIVE_LAB_SOURCE"),*sink=getenv("LIVE_LAB_SINK");
 for(int i=1;i<argc;i++) {
  if(!strcmp(argv[i],"--help")) { puts("live-lab-audio-linux [--source NAME] [--sink NAME] [--self-test]\nNo devices opened until start."); return 0; }
  if(!strcmp(argv[i],"--self-test")) { puts("live-lab-audio-linux: build OK"); return 0; }
  bool s=!strcmp(argv[i],"--source"),o=!strcmp(argv[i],"--sink");
  if(!(s||o) || ++i==argc || !*argv[i] || strlen(argv[i])>255) { fputs("Invalid argument (see --help)\n",stderr); return 2; }
  if(s) source=argv[i]; else sink=argv[i];
 }
 int flags=fcntl(1,F_GETFL); if(flags>=0) fcntl(1,F_SETFL,flags|O_NONBLOCK);
 Lab lab(source,sink); event("{\"type\":\"hello\",\"protocol\":1}");
 char line[100002];
 while(fgets(line,sizeof(line),stdin)) {
  size_t n=strlen(line); if(!n || line[n-1]!='\n') { int ch; while((ch=fgetc(stdin))!=EOF && ch!='\n') {} error("protocol","Command too large"); continue; }
  json_tokener* tok=json_tokener_new(); json_object* cmd=json_tokener_parse_ex(tok,line,n);
  if(json_tokener_get_error(tok)!=json_tokener_success || !cmd || json_object_get_type(cmd)!=json_type_object) error("protocol","Invalid JSON command"); else lab.command(cmd);
  if(cmd) json_object_put(cmd); json_tokener_free(tok);
 }
 lab.stop();
}
