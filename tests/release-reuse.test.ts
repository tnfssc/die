import { describe, expect, test } from "bun:test";
import { findDryRun, hasUniqueArtifact, qualifies, type RunArtifact } from "../scripts/find-release-dry-run";

const repo = "example/die";
const sha = "a".repeat(40);
const workflow = { id: 55, path: ".github/workflows/release.yml" };
const run = {
  id: 123,
  workflow_id: 55,
  path: repo + "/.github/workflows/release.yml@refs/heads/develop",
  event: "workflow_dispatch",
  head_branch: "develop",
  head_sha: sha,
  status: "completed",
  conclusion: "success",
  repository: { full_name: repo },
  head_repository: { full_name: repo },
};
const artifact = { id: 456, name: "stable-release-assets", expired: false, size_in_bytes: 200 };
const api =
  (r = run, a: RunArtifact = artifact, w = workflow) =>
  async (url: string | URL | Request) => {
    const path = String(url);
    const data = path.endsWith("/workflows/release.yml")
      ? w
      : path.includes("/artifacts?")
        ? { total_count: 1, artifacts: [a] }
        : { workflow_runs: [r] };
    return new Response(JSON.stringify(data), { status: 200 });
  };

describe("release dry run reuse", () => {
  test("accepts completed same-repository dispatch at exact SHA with one live artifact", async () => {
    expect(qualifies(run, repo, sha, 55)).toBe(true);
    expect(await findDryRun(repo, sha, "token", api())).toBe(123);
  });
  test("rejects PR, push, fork, wrong SHA/branch/workflow, pending and failed run", async () => {
    for (const change of [
      { event: "pull_request" },
      { event: "push" },
      { head_repository: { full_name: "attacker/die" } },
      { repository: { full_name: "attacker/die" } },
      { head_sha: "b".repeat(40) },
      { head_branch: "feature" },
      { workflow_id: 56 },
      { path: ".github/workflows/ci.yml" },
      { status: "in_progress" },
      { conclusion: "failure" },
    ]) {
      expect(await findDryRun(repo, sha, "token", api({ ...run, ...change }))).toBeUndefined();
    }
  });
  test("rejects missing, expired, duplicate or empty artifact and mismatched workflow", async () => {
    for (const change of [{ expired: true }, { size_in_bytes: 0 }, { id: undefined }, { name: "other" }]) {
      expect(await findDryRun(repo, sha, "token", api(run, { ...artifact, ...change }))).toBeUndefined();
    }
    expect(hasUniqueArtifact([artifact, artifact])).toBe(false);
    expect(await findDryRun(repo, sha, "token", api(run, artifact, { ...workflow, id: 56 }))).toBeUndefined();
  });
  test("API errors or invalid inputs fall back to full build", async () => {
    expect(await findDryRun("fork/die", sha, "", api())).toBeUndefined();
    expect(await findDryRun(repo, "invalid", "token", api())).toBeUndefined();
    const fail = async () => new Response("", { status: 403 });
    expect(await findDryRun(repo, sha, "token", fail)).toBeUndefined();
  });
});
