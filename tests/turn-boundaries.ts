/** Match Pi's all-results-yield batch rule, not just an individual hint. */
export function yieldedEntries(entries: any[]): any[] {
  const results = new Map(entries.filter(e=>e.type==="message" && e.message?.role==="toolResult").map(e=>[e.message.toolCallId,e]));
  const yielded = new Set<any>();
  for (const entry of entries) {
    if (entry.type!=="message" || entry.message?.role!=="assistant") continue;
    if (entry.message.stopReason==="stop") yielded.add(entry);
    const calls=(entry.message.content??[]).filter((p:any)=>p.type==="toolCall");
    const batch=calls.map((c:any)=>results.get(c.id));
    if (batch.length && batch.every((e:any)=>e && !e.message.isError && typeof e.message.details?.handoff==="string")) {
      yielded.add(batch.reduce((a:any,b:any)=>Date.parse(a.timestamp)>Date.parse(b.timestamp)?a:b));
    }
  }
  return entries.filter(e=>yielded.has(e));
}
