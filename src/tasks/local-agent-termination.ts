import type { TaskManager } from "./task-manager";

/** A local agent is a process-group leader, but its own jobs are separate groups.
 * SIGTERM from its parent must drain its session-owned manager before it exits.
 * This is deliberately only installed in local agent processes, not root/host sessions.
 */
export function installLocalAgentTermination(
  signals: Pick<NodeJS.Process, "on" | "off">,
  manager: Pick<TaskManager, "shutdown">,
  exit: (code: number) => void,
): () => void {
  let requested = false;
  const terminate = () => {
    if (requested) return;
    requested = true;
    void Promise.resolve()
      .then(() => manager.shutdown())
      .catch((error) => console.error("Local agent job shutdown failed:", error))
      .finally(() => exit(143));
  };
  signals.on("SIGTERM", terminate);
  return () => signals.off("SIGTERM", terminate);
}
