// Offline owning Pi child: real anonymous FD3/FD4 frames, never a provider SDK.
const fs = require('node:fs');
let pending = Buffer.alloc(0);
const evidence = process.env.DIE_FAKE_EVIDENCE;
const state = { providers: [], paidCalls: 0, uploadBytes: 0, stops: 0 };
function save() { fs.writeFileSync(evidence, JSON.stringify(state)); }
function send(kind, bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(JSON.stringify(bytes));
  const header = Buffer.alloc(5); header[0] = kind; header.writeUInt32BE(payload.length, 1);
  fs.writeSync(4, Buffer.concat([header, payload]));
}
save();
const input = fs.createReadStream(null, {fd:3, autoClose:false});
input.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 5) {
    const kind = pending[0], len = pending.readUInt32BE(1);
    if (len > 65536) process.exit(3);
    if (pending.length < len + 5) break;
    const payload = pending.subarray(5, 5 + len); pending = pending.subarray(5 + len);
    if (kind === 1) { state.uploadBytes += len; save(); continue; }
    if (kind !== 0) process.exit(4);
    const control = JSON.parse(payload.toString());
    if (control.type === 'start') {
      if (!process.env.DIE_FAKE_MISSING) {
        if (!state.providers.includes(control.provider)) state.providers.push(control.provider);
        save(); setTimeout(() => { send(0, {type:'ready'}); send(0, {type:'status',state:'ready'}); send(2, Buffer.alloc(960)); }, 150);
      } else setTimeout(() => send(0, {type:'error', code:'credentials_unavailable', message:'Configure a voice provider API key to continue.'}), 150);
    } else if (control.type === 'stop') { state.stops++; save(); send(0, {type:'stopped', stopped:true}); }
  }
});
