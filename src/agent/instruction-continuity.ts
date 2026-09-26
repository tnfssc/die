import { withOrdinaryMainTurn } from "../live/main-owner";
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { AgentSession, type NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

/**
 * Keep Die's instruction continuity behind this compatibility boundary.
 *
 * Pi's public extension API frames each turn but does not expose the classic
 * session that prepares requests. This module owns the pinned private
 * AgentSession seams and manager-keyed state. That state carries the final frame
 * through tool continuations and fresh compaction. Runtime construction finds
 * the classic owner. scopeInstructionContinuity() starts frame state. Manager
 * identity isolates both, and the saved session ID also guards frames.
 * clearInstructionContinuity() must release all state on replacement or shutdown.
 *
 * Keep this version coupling in one place. If a private seam is missing, fail
 * while installing the adapter instead of sending a differently framed request.
 */

export type ClassicSession = {
  agent: Agent;
  sessionManager: object;
  _buildRuntime(options: unknown): void;
  readonly systemPrompt: string;
  getActiveToolNames(): string[];
  _runSystemPromptOptions?: NormalizedBuildSystemPromptOptions;
  _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void>;
  prompt: AgentSession["prompt"];
  abort: AgentSession["abort"];
  _preparePromptAndToolLoadout(
    options: NormalizedBuildSystemPromptOptions,
    messages?: AgentMessage[],
  ): AgentMessage | undefined;
  _extensionRunner?: {
    emitBeforeAgentStart(
      prompt: string,
      images: ImageContent[] | undefined,
      options: NormalizedBuildSystemPromptOptions,
    ): Promise<{
      messages: Array<{ customType: string; content: unknown[]; display?: boolean; details?: unknown }>;
      systemPromptOptions: NormalizedBuildSystemPromptOptions;
    }>;
  };
  _baseSystemPromptOptions: NormalizedBuildSystemPromptOptions;
};

type InstructionFrame = {
  sessionId: string;
  systemPrompt?: string;
  systemPromptOptions?: NormalizedBuildSystemPromptOptions;
};

const classicSessions = new WeakMap<object, ClassicSession>();
// A persisted session id is not an owner identity: two in-memory managers may
// legitimately load the same session. Key by the manager and guard every access
// with its current id so a manager reused for new/resume cannot inherit a frame.
const dieInstructionFrames = new WeakMap<object, InstructionFrame>();

function currentSessionId(sessionManager: object | undefined): string | undefined {
  if (!sessionManager) return undefined;
  const getSessionId = (sessionManager as { getSessionId?: () => string }).getSessionId;
  return typeof getSessionId === "function" ? getSessionId.call(sessionManager) : undefined;
}

function currentInstructionFrame(sessionManager: object | undefined): InstructionFrame | undefined {
  const id = currentSessionId(sessionManager);
  const frame = sessionManager ? dieInstructionFrames.get(sessionManager) : undefined;
  if (frame && frame.sessionId === id) return frame;
  // A SessionManager can change its active session in place. Delete stale state
  // eagerly rather than allowing a later switch back to revive it.
  if (frame && sessionManager) dieInstructionFrames.delete(sessionManager);
  return undefined;
}

/** Start continuity for the manager's current die-owned session. */
export function scopeInstructionContinuity(sessionManager: object | undefined): void {
  const sessionId = currentSessionId(sessionManager);
  if (!sessionManager || !sessionId) return;
  if (!currentInstructionFrame(sessionManager)) dieInstructionFrames.set(sessionManager, { sessionId });
}

/** Release all compatibility objects owned by this manager. */
export function clearInstructionContinuity(sessionManager: object | undefined): void {
  if (!sessionManager) return;
  dieInstructionFrames.delete(sessionManager);
  classicSessions.delete(sessionManager);
}

/** Keep a frame prepared outside AgentSession.prompt(), such as for fresh compaction. */
export function setCurrentInstructionFrame(sessionManager: object, systemPrompt: string): boolean {
  const frame = currentInstructionFrame(sessionManager);
  if (!frame) return false;
  frame.systemPrompt = systemPrompt;
  // Pi 0.87 carries instructions as transcript system messages. Keep the
  // active run options in sync so tool continuations use the exact forced frame.
  const owner = classicSessions.get(sessionManager);
  if (owner) {
    const basis = owner._runSystemPromptOptions ?? owner._baseSystemPromptOptions;
    frame.systemPromptOptions = { ...basis, forceSystemPrompt: systemPrompt };
    owner._runSystemPromptOptions = frame.systemPromptOptions;
  }
  return true;
}

/** Rewrite a prepared frame after a session-scoped instruction change. */
export function updateCurrentInstructionFrame(sessionManager: object, update: (prompt: string) => string): boolean {
  const frame = currentInstructionFrame(sessionManager);
  if (!frame || frame.systemPrompt === undefined) return false;
  return setCurrentInstructionFrame(sessionManager, update(frame.systemPrompt));
}

/** Bind the owning classic session. Explicit session embedders can use this too. */
export function bindInstructionContinuitySession(session: ClassicSession): void {
  if (session.sessionManager && typeof session.sessionManager === "object") {
    classicSessions.set(session.sessionManager, session);
  }
}

/** Keep the old name for explicit compaction embedders. */
export const bindCurrentCompactionSession = bindInstructionContinuitySession;

/** Return only the classic session owned by this in-memory manager. */
export function getInstructionContinuitySession(sessionManager: object): ClassicSession | undefined {
  return classicSessions.get(sessionManager);
}

let classicAdapterInstalled = false;

/**
 * Install the process-wide classic Pi adapter once.
 *
 * The prototype patch only watches sessions. Manager scope decides whether Die
 * may carry an instruction frame. This pins AgentSession._buildRuntime and
 * AgentSession._runAgentPrompt. It does not edit node_modules or make up a turn.
 */
export function installCurrentConversationAdapter(): void {
  if (classicAdapterInstalled) return;
  const prototype = AgentSession.prototype as unknown as ClassicSession;
  const runAgentPrompt = prototype._runAgentPrompt;
  const buildRuntime = prototype._buildRuntime;
  if (typeof runAgentPrompt !== "function" || typeof buildRuntime !== "function") {
    throw new Error(
      "die instruction continuity is unsupported by this Pi runtime: required private AgentSession._runAgentPrompt/_buildRuntime seams are unavailable",
    );
  }
  classicAdapterInstalled = true;
  prototype._runAgentPrompt = async function (this: ClassicSession, messages: AgentMessage | AgentMessage[]) {
    return withOrdinaryMainTurn(this.sessionManager, async () => {
      const frame = currentInstructionFrame(this.sessionManager);
      if (frame) {
        // prompt() has already run before_agent_start and prepared its transcript
        // update. Capture those final options. Custom-message turns do not run the
        // hook, so restore the options for the provider projection and continuations.
        if (this._runSystemPromptOptions !== undefined) {
          frame.systemPromptOptions = this._runSystemPromptOptions;
          frame.systemPrompt = this.systemPrompt;
        } else if (frame.systemPromptOptions !== undefined) {
          this._runSystemPromptOptions = frame.systemPromptOptions;
        }
      }
      return runAgentPrompt.call(this, messages);
    });
  };
  prototype._buildRuntime = function (this: ClassicSession, options: unknown) {
    bindInstructionContinuitySession(this);
    return buildRuntime.call(this, options);
  };
}
