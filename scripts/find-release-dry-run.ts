export interface DryRun {
  id?: number;
  workflow_id?: number;
  path?: string;
  event?: string;
  head_branch?: string;
  head_sha?: string;
  status?: string;
  conclusion?: string;
  repository?: { full_name?: string };
  head_repository?: { full_name?: string };
}
export interface RunArtifact {
  id?: number;
  name?: string;
  expired?: boolean;
  size_in_bytes?: number;
}

export function qualifies(run: DryRun, repo: string, sha: string, workflowId: number): boolean {
  return (
    run.workflow_id === workflowId &&
    (run.path === ".github/workflows/release.yml" ||
      run.path === `${repo}/.github/workflows/release.yml@refs/heads/develop`) &&
    run.event === "workflow_dispatch" &&
    run.head_branch === "develop" &&
    run.head_sha === sha &&
    run.status === "completed" &&
    run.conclusion === "success" &&
    run.repository?.full_name === repo &&
    run.head_repository?.full_name === repo
  );
}
export function hasUniqueArtifact(artifacts: RunArtifact[]): boolean {
  const matches = artifacts.filter((a) => a.name === "stable-release-assets");
  return (
    matches.length === 1 &&
    Number.isSafeInteger(matches[0].id) &&
    (matches[0].id ?? 0) > 0 &&
    matches[0].expired === false &&
    (matches[0].size_in_bytes ?? 0) > 0
  );
}

export async function findDryRun(
  repo: string,
  sha: string,
  token: string,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<number | undefined> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(sha) || !token) return;
  const base = `https://api.github.com/repos/${repo}/actions`;
  const get = async <T>(url: string): Promise<T> => {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return response.json() as Promise<T>;
  };
  // The workflow endpoint pins the workflow; verify its ID and path again.
  try {
    const workflow = await get<{ id: number; path: string }>(`${base}/workflows/release.yml`);
    if (!Number.isSafeInteger(workflow.id) || workflow.path !== ".github/workflows/release.yml") return;
    const list = await get<{ workflow_runs: DryRun[] }>(
      `${base}/workflows/${workflow.id}/runs?event=workflow_dispatch&branch=develop&head_sha=${sha}&per_page=100`,
    );
    for (const run of list.workflow_runs ?? []) {
      if (!qualifies(run, repo, sha, workflow.id) || !Number.isSafeInteger(run.id)) continue;
      const result = await get<{ total_count: number; artifacts: RunArtifact[] }>(
        `${base}/runs/${run.id}/artifacts?per_page=100`,
      );
      if (
        Array.isArray(result.artifacts) &&
        result.total_count === result.artifacts.length &&
        hasUniqueArtifact(result.artifacts)
      )
        return run.id;
    }
  } catch (error) {
    console.error(
      "No reusable dry run; running full release verification:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
if (import.meta.main) {
  const run = await findDryRun(
    process.env.GITHUB_REPOSITORY ?? "",
    process.env.GITHUB_SHA ?? "",
    process.env.GH_TOKEN ?? "",
  );
  if (run) process.stdout.write(String(run));
}
