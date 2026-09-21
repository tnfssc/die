import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AgentInfo } from "./agent-progress";

export async function prepareAgentSession(
  cwd: string,
  sessionDir: string | undefined,
  info: Omit<AgentInfo, "sessionFile">,
  taskId?: string,
  title?: string,
) {
  // Dynamic import: die must initialize its Pi configuration before loading Pi.
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { disposeDiskBackedSessionManager } = await import("../history/session-manager");
  const session = SessionManager.create(cwd, sessionDir || undefined, { parentSession: info.parentSessionFile });
  let persisted: typeof session | undefined;
  try {
    const sessionFile = session.getSessionFile()!;
    // Pi normally delays persistence until the first assistant message. Persist the
    // header now so even a launch/provider stall has a durable diagnostic identity.
    await writeFile(sessionFile, JSON.stringify(session.getHeader()) + "\n", { flag: "wx", mode: 0o600 });
    persisted = SessionManager.open(sessionFile);
    const id = taskId ?? "task_" + randomUUID().slice(0, 8);
    persisted.appendCustomEntry("die-agent", { ...info, taskId: id });
    persisted.appendSessionInfo(
      (info.type === "orchestrator" ? "[orchestrator agent] " : "[subagent · " + info.type + "] ") + (title ?? id),
    );
    return { id, agent: { ...info, sessionFile } };
  } finally {
    // Both managers are private to preparation; SDK shutdown is not an ownership boundary.
    disposeDiskBackedSessionManager(session);
    if (persisted) disposeDiskBackedSessionManager(persisted);
  }
}
