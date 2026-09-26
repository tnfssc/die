// Offline regression: packet arrival before the last held source sample is rendered.
// Build/run command and baseline measurements: wisdom/live/gpt-live-crackling-investigation.md.
#include "AudioCore.h"
#include <math.h>
#include <stdio.h>
#include <assert.h>
int main(void) {
  int16_t pcm[24000]; float expected[48000], actual[48000];
  for(int i=0;i<24000;i++) pcm[i]=(int16_t)lrint(10000*sin(2*3.141592653589793*437*i/24000));
  LLCore *a=ll_create(), *b=ll_create();
  assert(ll_play_push_batch(a,pcm,24000,0)); ll_render(a,expected,48000,48000);
  assert(ll_play_push_batch(b,pcm,480,0)); ll_render(b,actual,958,48000);
  int at=958;
  for(int i=480;i<24000;i+=480) { assert(ll_play_push_batch(b,pcm+i,480,0)); ll_render(b,actual+at,960,48000); at+=960; }
  ll_render(b,actual+at,48000-at,48000);
  double max=0, power=0; int errors=0;
  for(int i=0;i<48000;i++) { double d=fabs(actual[i]-expected[i]); if(d) errors++; if(d>max) max=d; power+=d*d; }
  printf("one_second_437Hz_20ms_packets mismatched=%d max_error=%.9f rms_error=%.9f\n",errors,max,sqrt(power/48000));
  assert(errors == 0);
  ll_destroy(a); ll_destroy(b);
}
