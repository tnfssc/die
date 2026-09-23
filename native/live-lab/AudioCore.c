#include "AudioCore.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
typedef struct { int generation, count; int16_t data[LL_PLAY_SAMPLES]; } PlayBlock;
typedef struct { int count; float data[LL_CAPTURE_SAMPLES]; } CaptureBlock;
struct LLCore {
    _Atomic unsigned playWrite, playRead, capWrite, capRead;
    _Atomic int generation;
    _Atomic unsigned flushMarker;
    PlayBlock play[LL_PLAY_BLOCKS]; CaptureBlock capture[LL_CAPTURE_BLOCKS];
    int offset, current, a, b, primed;
    double phase;
};
LLCore *ll_create(void) { return calloc(1, sizeof(LLCore)); }
void ll_destroy(LLCore *c) { free(c); }
int ll_generation(LLCore *c) { return atomic_load(&c->generation); }
void ll_flush(LLCore *c, int gen) { atomic_store(&c->flushMarker, atomic_load(&c->playWrite)); atomic_store(&c->generation, gen); }
int ll_play_push(LLCore *c, const int16_t *data, int count, int gen) {
    if (count < 1 || count > LL_PLAY_SAMPLES || gen != ll_generation(c)) return 0;
    unsigned w = atomic_load(&c->playWrite), r = atomic_load(&c->playRead);
    if (w-r >= LL_PLAY_BLOCKS) return 0;
    PlayBlock *b = &c->play[w % LL_PLAY_BLOCKS];
    b->generation = gen; b->count = count; memcpy(b->data, data, (size_t)count*2);
    atomic_store(&c->playWrite, w+1); return 1;
}
int ll_queued_ms(LLCore *c) {
    unsigned w=atomic_load(&c->playWrite), r=atomic_load(&c->playRead);
    unsigned marker=atomic_load(&c->flushMarker);
    if (r<marker) r=marker;
    return (int)(w-r)*20;
}
static int pull(LLCore *c, int gen, int *sample) {
    while (atomic_load(&c->playRead) != atomic_load(&c->playWrite)) {
        unsigned r=atomic_load(&c->playRead);
        PlayBlock *b=&c->play[r % LL_PLAY_BLOCKS];
        if (b->generation != gen || c->offset >= b->count) {
            c->offset=0; atomic_store(&c->playRead,r+1); continue;
        }
        *sample=b->data[c->offset++]; return 1;
    }
    return 0;
}
void ll_render(LLCore *c, float *out, int count, double rate) {
    int gen=ll_generation(c);
    if (c->current != gen) { c->current=gen; c->primed=0; c->phase=0; }
    if (rate <= 0) { memset(out,0,(size_t)count*sizeof(float)); return; }
    double step=24000.0/rate;
    for (int i=0;i<count;i++) {
        if (ll_generation(c) != gen) { gen=ll_generation(c); c->current=gen; c->primed=0; c->phase=0; }
        if (!c->primed) {
            if (!pull(c,gen,&c->a)) { out[i]=0; continue; }
            if (!pull(c,gen,&c->b)) c->b=c->a;
            c->primed=1; c->phase=0;
        }
        out[i]=(float)(c->a+(c->b-c->a)*c->phase)/32768.0f;
        c->phase+=step;
        while(c->phase>=1.0) {
            c->a=c->b;
            if (!pull(c,gen,&c->b)) { c->primed=0; break; }
            c->phase-=1.0;
        }
    }
}
int ll_capture_push(LLCore *c, const float *data, int count) {
    if (count<1 || count>LL_CAPTURE_SAMPLES) return 0;
    unsigned w=atomic_load(&c->capWrite), r=atomic_load(&c->capRead);
    if (w-r>=LL_CAPTURE_BLOCKS) return 0;
    CaptureBlock *b=&c->capture[w % LL_CAPTURE_BLOCKS];
    b->count=count; memcpy(b->data,data,(size_t)count*sizeof(float));
    atomic_store(&c->capWrite,w+1); return 1;
}
int ll_capture_pop(LLCore *c, float *out) {
    unsigned r=atomic_load(&c->capRead);
    if (r==atomic_load(&c->capWrite)) return 0;
    CaptureBlock *b=&c->capture[r % LL_CAPTURE_BLOCKS];
    int n=b->count; memcpy(out,b->data,(size_t)n*sizeof(float));
    atomic_store(&c->capRead,r+1); return n;
}
int ll_self_test(void) {
    LLCore *c=ll_create(); if (!c) return 0;
    int16_t a[480]; for(int i=0;i<480;i++) a[i]=1234;
    float out[960];
    int ok=ll_play_push(c,a,480,0) && ll_queued_ms(c)==20;
    ll_flush(c,1); ok &= ll_queued_ms(c)==0 && !ll_play_push(c,a,480,0);
    ll_render(c,out,960,48000); for(int i=0;i<960;i++) ok &= out[i]==0;
    ok &= ll_play_push(c,a,480,1);
    ll_render(c,out,960,48000); ok &= out[0]>0 && out[100]>0;
    float cap[1024]={0}, copy[1024]; cap[0]=0.5f;
    ok &= ll_capture_push(c,cap,1024) && ll_capture_pop(c,copy)==1024 && copy[0]==0.5f;
    ll_destroy(c); return ok;
}
