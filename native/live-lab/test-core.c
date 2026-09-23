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
    ll_destroy(core);
    puts("core tests passed");
    return 0;
}
