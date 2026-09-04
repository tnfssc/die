export function boundedMiddlePreview(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let marker = "…";
  for (;;) {
    const retained = Math.max(2, limit - marker.length);
    const next = `…[${value.length - retained} characters omitted]…`;
    if (next === marker) break;
    marker = next;
  }
  const retained = Math.max(2, limit - marker.length);
  const head = Math.ceil(retained / 2);
  const tail = retained - head;
  return `${value.slice(0, head)}${marker}${value.slice(-tail)}`;
}
