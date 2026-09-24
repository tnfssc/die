#include "AudioCore.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
    assert(ll_self_test());
    LLCore *core = ll_create();
    assert(core);
    int16_t samples[480] = {1};
    for (int i = 0; i < LL_PLAY_BLOCKS; ++i) assert(ll_play_push(core, samples, 480, 0));
    assert(!ll_play_push(core, samples, 480, 0));
    ll_flush(core, 1);
    assert(ll_queued_ms(core) == 0);
    float output[960];
    ll_render(core, output, 960, 48000);
    for (int i = 0; i < 960; ++i) assert(output[i] == 0);
    float input[1024] = {0}, copy[1024];
    for (int i = 0; i < LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_push(core, input, 1024));
    assert(!ll_capture_push(core, input, 1024));
    for (int i = 0; i < LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_pop(core, copy) == 1024);
    assert(ll_capture_pop(core, copy) == 0);
    assert(ll_capture_dropped(core) == 1024);
    // Partially consumed blocks count frames rather than assuming 20ms per block.
    ll_flush(core, 2);
    int16_t tail[] = { 8000, 16000, 24000 };
    assert(ll_play_push_batch(core, tail, 3, 2));
    assert(ll_queued_ms(core) == 1);
    float fine[12] = {0};
    ll_render(core, fine, 12, 48000);
    assert(fine[0] == 8000.f/32768.f);
    assert(fine[2] == 16000.f/32768.f);
    assert(fine[4] == 24000.f/32768.f); // final frame survives interpolation
    assert(fine[5] == fine[4]);
    assert(fine[6] == 0);
    assert(ll_queued_ms(core) == 0);
    assert(ll_play_push_batch(core, tail, 3, 2));
    ll_render(core, fine, 12, 48000);
    assert(fine[0] == fine[5] * 8000.f/24000.f);
    assert(fine[4] == 24000.f/32768.f);
    // Flush cannot accidentally expose old audio, even with unread blocks.
    assert(ll_play_push_batch(core, samples, 480, 2));
    ll_flush(core, 3);
    assert(ll_queued_ms(core) == 0);
    assert(!ll_play_push_batch(core, tail, 3, 2));
    ll_render(core, fine, 12, 48000);
    for (int i=0; i<12; ++i) assert(fine[i] == 0);
    // Admission is all-or-nothing; no prefix of a rejected play may be heard.
    int16_t huge[LL_PLAY_BLOCKS * LL_PLAY_SAMPLES] = {0};
    assert(ll_play_push_batch(core, huge, LL_PLAY_BLOCKS * LL_PLAY_SAMPLES, 3));
    assert(!ll_play_push_batch(core, tail, 3, 3));
    assert(ll_queued_ms(core) == 1000);
    ll_flush(core, 4);
    for (int i=0; i<LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_push(core, input, 1024));
    assert(!ll_capture_push(core, input, 1024));
    assert(ll_capture_dropped(core) == 1024);
    assert(ll_capture_dropped(core) == 0);
    ll_destroy(core);
    puts("core tests passed");
    return 0;
}
