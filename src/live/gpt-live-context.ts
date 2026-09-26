/** Bounded data-only context for GPT-Live's small text append budget.
 * Keep the canonical session's full originals; these are explicitly lossy voice observations.
 */
export function gptLiveContext(text: string): string[] {
  const points = Array.from(text);
  const retained = points.slice(-2400);
  const omitted = points.length - retained.length;
  const chunks: string[] = [];
  let data = "";
  const encode = (value: string, part: number) =>
    JSON.stringify({
      source: "canonical_session",
      untrustedData: true,
      omittedCodePoints: omitted,
      part,
      data: value,
    });
  for (const point of retained) {
    if (Buffer.byteLength(encode(data + point, chunks.length + 1)) > 480) {
      chunks.push(encode(data, chunks.length + 1));
      data = "";
    }
    data += point;
  }
  if (data) chunks.push(encode(data, chunks.length + 1));
  return chunks;
}
