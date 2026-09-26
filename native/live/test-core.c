#include "AudioCore.h"
#include <assert.h>
#include <stdio.h>
static void test_packet_tail_rates(void) {
    double rates[] = {24000, 44100, 48000, 96000};
    int16_t ramp[] = {0, 10000, 20000, 30000, 20000, 10000, 0, -10000};
    int16_t fresh[] = {-7000, -11000};
    for (unsigned r=0; r<sizeof(rates)/sizeof(rates[0]); ++r) {
        LLCore *whole=ll_create(), *split=ll_create();
        float expected[64], actual[64];
        int first=(int)(rates[r]/24000.0);
        if (first*24000 < rates[r]) ++first;
        assert(ll_play_push_batch(whole,ramp,8,0));
        ll_render(whole,expected,64,rates[r]);
        assert(ll_play_push_batch(split,ramp,2,0));
        ll_render(split,actual,first,rates[r]);
        assert(ll_play_push_batch(split,ramp+2,6,0));
        ll_render(split,actual+first,64-first,rates[r]);
        for(int i=0;i<64;++i) assert(actual[i]==expected[i]);
        assert(ll_queued_ms(split)==0);
        // Starved tail fully drains to zero; new epoch cannot leak old lookahead.
        ll_flush(split,1);
        assert(ll_play_push_batch(split,ramp,2,1));
        ll_render(split,actual,first,rates[r]);
        ll_flush(split,2);
        ll_render(split,actual,64,rates[r]);
        for(int i=0;i<64;++i) assert(actual[i]==0);
        assert(!ll_play_push_batch(split,ramp,2,1));
        assert(ll_play_push_batch(split,fresh,2,2));
        ll_render(split,actual,64,rates[r]);
        assert(actual[0]==fresh[0]/32768.f);
        for(int i=16;i<64;++i) assert(actual[i]==0);
        assert(ll_queued_ms(split)==0);
        ll_destroy(whole); ll_destroy(split);
    }
}

int main(void) {
    test_packet_tail_rates();
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
    // A packet boundary is not a response boundary: if the next packet arrives
    // before the held sample is rendered, interpolation must match contiguous PCM.
    ll_flush(core, 5);
    int16_t ramp[] = {0, 10000, 20000, 30000};
    float contiguous[8], split[8];
    assert(ll_play_push_batch(core, ramp, 4, 5));
    ll_render(core, contiguous, 8, 48000);
    ll_flush(core, 6);
    assert(ll_play_push_batch(core, ramp, 2, 6));
    ll_render(core, split, 2, 48000);
    assert(ll_play_push_batch(core, ramp + 2, 2, 6));
    ll_render(core, split + 2, 6, 48000);
    for (int i = 0; i < 8; ++i) assert(split[i] == contiguous[i]);
    // If a second chunk arrives halfway through a held sample, its remaining
    // fractional output can still interpolate toward the new lookahead.
    ll_flush(core, 7);
    assert(ll_play_push_batch(core, ramp, 2, 7));
    ll_render(core, split, 3, 48000);
    assert(ll_play_push_batch(core, ramp + 2, 2, 7));
    ll_render(core, split + 3, 5, 48000);
    for (int i = 0; i < 8; ++i) assert(split[i] == contiguous[i]);
    ll_flush(core, 8);
    // Flush cannot accidentally expose old audio, even with unread blocks.
    assert(ll_play_push_batch(core, samples, 480, 8));
    ll_flush(core, 9);
    assert(ll_queued_ms(core) == 0);
    assert(!ll_play_push_batch(core, tail, 3, 8));
    ll_render(core, fine, 12, 48000);
    for (int i=0; i<12; ++i) assert(fine[i] == 0);
    // Admission is all-or-nothing; no prefix of a rejected play may be heard.
    int16_t huge[LL_PLAY_BLOCKS * LL_PLAY_SAMPLES] = {0};
    assert(ll_play_push_batch(core, huge, LL_PLAY_BLOCKS * LL_PLAY_SAMPLES, 9));
    assert(!ll_play_push_batch(core, tail, 3, 9));
    assert(ll_queued_ms(core) == 1000);
    ll_flush(core, 10);
    for (int i=0; i<LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_push(core, input, 1024));
    assert(!ll_capture_push(core, input, 1024));
    assert(ll_capture_dropped(core) == 1024);
    assert(ll_capture_dropped(core) == 0);
    ll_destroy(core);
    puts("core tests passed");
    return 0;
}
