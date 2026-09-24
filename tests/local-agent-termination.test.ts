import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { installLocalAgentTermination } from "../src/tasks/local-agent-termination";

// A fake process tree: the root owns two detached agent groups, each agent
// owns its own async jobs. No OS processes or signals are used here.
class FakeAgent {
  readonly signals = new EventEmitter();
  readonly jobs: { running: boolean; stopped: boolean }[] = [];
  readonly exits: number[] = [];
  shutdowns = 0;
  readonly detach = installLocalAgentTermination(
    this.signals,
    {
      shutdown: async () => {
        this.shutdowns++;
        for (const job of this.jobs) {
          if (job.running) job.stopped = true;
        }
      },
    },
    (code) => this.exits.push(code),
  );
  addJob() {
    const job = { running: true, stopped: false };
    this.jobs.push(job);
    return job;
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("local agent termination bridge", () => {
  test("SIGTERM drains only the signalled agent manager, once, before exit", async () => {
    const owned = new FakeAgent();
    const sibling = new FakeAgent();
    const child = owned.addJob();
    const siblingJob = sibling.addJob();
    owned.signals.emit("SIGTERM");
    owned.signals.emit("SIGTERM");
    await tick();
    expect(child.stopped).toBe(true);
    expect(siblingJob.stopped).toBe(false);
    expect(owned.shutdowns).toBe(1);
    expect(owned.exits).toEqual([143]);
    expect(sibling.exits).toEqual([]);
    owned.detach();
    sibling.detach();
  });

  test("waits for shutdown and detaches on session replacement", async () => {
    const agent = new FakeAgent();
    agent.detach();
    agent.signals.emit("SIGTERM");
    await tick();
    expect(agent.shutdowns).toBe(0);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const signals = new EventEmitter();
    const exits: number[] = [];
    const detach = installLocalAgentTermination(signals, { shutdown: () => pending }, (code) => exits.push(code));
    signals.emit("SIGTERM");
    await tick();
    expect(exits).toEqual([]);
    finish();
    await tick();
    expect(exits).toEqual([143]);
    detach();
  });
});
