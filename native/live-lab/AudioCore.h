#ifndef LIVE_LAB_AUDIO_CORE_H
#define LIVE_LAB_AUDIO_CORE_H
#include <stdint.h>
#define LL_PLAY_BLOCKS 50
#define LL_CAPTURE_BLOCKS 16
#define LL_PLAY_SAMPLES 480
#define LL_CAPTURE_SAMPLES 1024
typedef struct LLCore LLCore;
LLCore *ll_create(void);
void ll_destroy(LLCore *core);
int ll_play_push(LLCore *core, const int16_t *samples, int count, int generation);
void ll_flush(LLCore *core, int generation);
int ll_generation(LLCore *core);
int ll_queued_ms(LLCore *core);
void ll_render(LLCore *core, float *out, int count, double output_rate);
int ll_capture_push(LLCore *core, const float *samples, int count);
int ll_capture_pop(LLCore *core, float *samples);
int ll_self_test(void);
#endif
