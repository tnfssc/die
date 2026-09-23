import { describe, expect, test } from 'bun:test';
import { VoiceSession } from '../src/live-lab/session.js';
import type { LiveAdapter, LiveParams, LiveConnection } from '../src/live-lab/types.js';

function harness() {
  let params!: LiveParams;
  let resolve!: (connection: LiveConnection) => void;
  const sends: unknown[] = [];
  let closes = 0;
  const adapter: LiveAdapter = () => ({ live: { connect: (p: LiveParams) => {
    params = p;
    return new Promise<LiveConnection>(r => { resolve = r; });
  } } }) as ReturnType<LiveAdapter>;
  const connection = { sendRealtimeInput: (data: unknown) => sends.push(data), close: () => { closes++; } } as unknown as LiveConnection;
  return { adapter, sends, get params() { return params; }, get closes() { return closes; }, ready: () => resolve(connection) };
}
const msg = (content: object) => content as Parameters<LiveParams['callbacks']['onmessage']>[0];

describe('voice-only SDK session', () => {
  test('explicit start, audio and transcription config, stream end idempotence', async () => {
    const h = harness(); const events: string[] = [];
    const s = new VoiceSession({ onReady: () => events.push('ready'), onState: v => events.push(v) }, h.adapter);
    expect(s.state).toBe('idle'); s.sendAudio('AAAAAA=='); expect(h.sends).toHaveLength(0);
    const pending = s.connect('test-key');
    expect(h.params.model).toBe('gemini-3.8-live');
    expect(h.params.config).toMatchObject({ responseModalities: ['AUDIO'], inputAudioTranscription: {}, outputAudioTranscription: {} });
    expect(h.params.config?.tools).toBeUndefined();
    h.ready(); await pending;
    s.sendAudio('AAAAAA=='); s.sendAudio('not base64'); s.endAudio(); s.endAudio();
    expect(h.sends).toEqual([{ audio: { data: 'AAAAAA==', mimeType: 'audio/pcm;rate=16000' } }, { audioStreamEnd: true }]);
    expect(events).toEqual(['connecting', 'ready', 'ready']);
    s.close(); s.close(); expect(h.closes).toBe(1);
    expect(() => s.connect('again')).toThrow();
  });
  test('interruption flush generation, final transcripts, turn markers and bounds', async () => {
    const h = harness(); const out: unknown[] = [];
    const s = new VoiceSession({ onAudio: (a, g) => out.push(['audio', a, g]), onInputTranscript: t => out.push(['input', t]), onOutputTranscript: (t,g) => out.push(['output', t,g]), onInterrupted: g => out.push(['interrupt',g]), onTurnComplete: g => out.push(['done',g]), onError: e => out.push(e) },h.adapter);
    const pending = s.connect('key'); h.ready(); await pending;
    h.params.callbacks.onmessage(msg({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA==' } }] }, inputTranscription: { text: 'heard' }, outputTranscription: { text: 'said' }, turnComplete: true } }));
    h.params.callbacks.onmessage(msg({ serverContent: { interrupted: true, outputTranscription: { text: 'final' }, turnComplete: true } }));
    expect(out).toEqual([['audio','AAAAAA==',0],['input','heard'],['output','said',0],['done',0],['interrupt',2],['output','final',2],['done',2]]);
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: 'x'.repeat(4097) }, turnComplete: true } }));
    expect(out.at(-1)).toEqual(['done',3]);
    h.params.callbacks.onmessage(msg({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAAAAA=='.repeat(32001) } }] } } }));
    expect(out.at(-1)).toEqual({ code: 'invalid_audio', message: 'Invalid output audio chunk' });
    expect(s.state).toBe('closed');
  });
  test('close during connect discards late connection/callbacks; errors sanitized and expiry terminal', async () => {
    const h = harness(); const out: unknown[] = [];
    const s = new VoiceSession({ onReady: () => out.push('ready'), onError: e => out.push(e) },h.adapter);
    const pending = s.connect('private'); s.close(); h.ready(); await pending;
    h.params.callbacks.onmessage(msg({ serverContent: { inputTranscription: { text: 'secret' } } }));
    expect(out).toEqual([]); expect(h.closes).toBe(1);
    const k = harness(); const errors: unknown[] = []; const second = new VoiceSession({ onError: e => errors.push(e), onOutputTranscript: text => errors.push(text), onTurnComplete: generation => errors.push(generation) }, k.adapter);
    const p = second.connect('private'); k.ready(); await p;
    k.params.callbacks.onmessage(msg({ goAway: { timeLeft: '3s' }, serverContent: { outputTranscription: { text: 'last words' }, turnComplete: true } }));
    k.params.callbacks.onerror?.({ error: new Error('private server error') } as ErrorEvent);
    expect(errors).toEqual(['last words', 0, { code: 'expiring', message: 'Voice session expiring; start a new session' }]);
  });
});
