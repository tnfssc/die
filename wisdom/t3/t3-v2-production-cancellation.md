# Native Die subtree cancellation

## Backend interface

Native `die_task_cancel` keeps its version-1 request and response contract. The backend now uses this event-store command for every nonterminal selected task:

```ts
{
  type: "delegated_task.cancel";
  commandId: CommandId;
  parentThreadId: ThreadId;
  taskId: NodeId;
  reason?: string;
}
```

The command is accepted only for an existing `app_owned` task of `parentThreadId`. In one persisted dispatch it:

1. writes the task as `status: "cancelled"` (the durable cancellation authority),
2. preserves prompt, result, transcript, transfers, and all historical runs,
3. changes completion delivery to `{ state: "disposed", observedByRunId: null }`,
4. removes the task from a pending completion cohort, and
5. cancels a queued completion-wake run when that task was its final member.

A repeated command is a successful event-store idempotent operation. A late child settlement does not overwrite a cancelled/disposed task and cannot publish a result wake.

After authority is persisted, `OrchestratorMcpService.cancelTask` interrupts an active child run when one exists. No active run is needed: an idle child thread waiting for descendants is still cancellable. Terminal tasks retain the existing completion-delivery disposal path and are not rewritten.

`DieTaskService.cancel` walks only the selected app-owned subtree, ancestor first. This establishes each ancestor's disposed delivery before descendant interruption can race to wake it. Siblings are not visited. Ordinary parent runs/handoffs are not interrupted.

Observation treats durable cancelled/interrupted task rows as cancelled. Otherwise, `delegatedTaskProgress.state === "working" | "waiting_for_children"` reports running even when the task's own run is terminal.

## Migration

No database or projection-table migration is needed. The command emits existing `subagent.updated` and `run.updated` domain events and uses existing subagent status/completion-delivery fields. Existing event streams replay unchanged. Command receipts provide retry deduplication. No process-local cancellation registry is introduced.

Mixed-version note: deploy contract and server changes together because older command decoders do not recognize `delegated_task.cancel`. There is no client API version change and no canonical adoption/export step.
