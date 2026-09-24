import { describe, expect, test } from "bun:test";
import { LiveWaveform, pcmLevel, renderWave, WAVE_CELLS } from "../src/live/waveform";

const pcm = (value: number, samples = 960) => {
  const frame = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) frame.writeInt16LE(value, i * 2);
  return frame;
};
const dots = (s: string) =>
  [...s].reduce((n, c) => n + (c.codePointAt(0)! - 0x2800).toString(2).replace(/0/g, "").length, 0);

describe("Live footer waveform", () => {
  test("PCM response, silence, empty and fixed terminal width", () => {
    expect(pcmLevel(Buffer.alloc(0))).toBe(0);
    expect(pcmLevel(Buffer.alloc(1))).toBe(0);
    expect(pcmLevel(pcm(0))).toBe(0);
    expect(pcmLevel(pcm(30000))).toBeGreaterThan(pcmLevel(pcm(3000)));
    expect(renderWave(NaN)).toBe(renderWave(0));
    expect(renderWave(Infinity)).toBe(renderWave(0));
    for (const v of [0, 0.1, 0.5, 1, NaN, Infinity]) expect([...renderWave(v)]).toHaveLength(WAVE_CELLS);
    expect(dots(renderWave(0.85))).toBeGreaterThan(dots(renderWave(0.12)));
    expect(renderWave(0.5, 2)).toBe(renderWave(0.5, 2));
  });
  test("capture continues during output, then falls back to quiet listening; interrupt clears output now", () => {
    const wave = new LiveWaveform();
    wave.capture(pcm(25000));
    expect(dots(wave.tick(false, 0))).toBeGreaterThan(dots(renderWave(0)));
    wave.capture(pcm(0));
    for (let i = 1; i < 25; i++) wave.tick(false, i * 80);
    expect(wave.tick(false, 2100)).toBe(renderWave(0));
    wave.scheduled(pcm(24000), 2200, 100);
    expect(dots(wave.tick(true, 2200))).toBeGreaterThan(dots(renderWave(0)));
    wave.capture(pcm(24000)); // Mic is not suspended during playback.
    wave.resetOutput();
    expect(wave.tick(true, 2210)).toBe(renderWave(0));
    wave.capture(pcm(24000));
    expect(dots(wave.tick(false, 2290))).toBeGreaterThan(dots(renderWave(0)));
    wave.scheduled(pcm(24000), 2300, 60);
    wave.queued(2330, 100);
    expect(dots(wave.tick(true, 2400))).toBeGreaterThan(dots(renderWave(0)));
    for (let i = 1; i < 25; i++) wave.tick(true, 2500 + i * 80);
    expect(wave.tick(true, 4600)).toBe(renderWave(0));
  });
});
