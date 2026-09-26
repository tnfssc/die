/** Lossy voice observations of canonical session data, never new commands. */
export function gptLiveContext(text: string): string[] {
  const points = Array.from(text);
  const retained = points.slice(-2400);
  if (!retained.length) return [];
  const omitted = points.length - retained.length;
  const prefix = "Quoted session observation" + (omitted ? ` (${omitted} earlier code points omitted)` : "") + ":\n";
  const chunks: string[] = [];
  let data = prefix;
  for (const point of retained) {
    if (Buffer.byteLength(data + point) > 480) {
      chunks.push(data);
      data = "Observation continued:\n";
    }
    data += point;
  }
  chunks.push(data);
  return chunks;
}
