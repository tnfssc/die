#!/usr/bin/env bash
# Shared local / GitHub Actions validation. CI owns tool setup and log upload only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
lane="${1:-linux}"
if [[ "$lane" != linux && "$lane" != macos || $# -gt 1 ]]; then
  echo 'usage: scripts/ci.sh [linux|macos]' >&2
  exit 2
fi

# Isolate transient session files from prior runs and real user sessions.
run_tmp="$(mktemp -d "${TMPDIR:-/tmp}/die-ci.XXXXXX")"
export TMPDIR="$run_tmp"
trap 'rm -rf "$run_tmp"' EXIT

mkdir -p artifacts/ci
log_dir="$root/artifacts/ci"
run_step() {
  local label="$1" log="$2" directory="$3"
  shift 3
  echo "==> $label"
  (cd "$directory" && "$@") 2>&1 | tee "$log_dir/$log"
}

run_step 'Install locked dependencies' install.log "$root" bun install --frozen-lockfile

if [[ "$lane" == macos ]]; then
  # This is the separate device-free macOS lane, not the Linux gate.
  # Main-Live integration runs the real execute child; build the production CLI
  # instead of skipping those tests or substituting a fixture binary.
  run_step 'Build compiled Live test binary' macos-build.log "$root" bun run build
  run_step 'Offline OpenAI source probe' macos-openai-transport.log "$root" bun scripts/offline-openai-default-transport.ts --source-only
  run_step 'Deterministic Live tests' macos-live-tests.log "$root" bun test tests/live-*.test.ts
  exit 0
fi

# Keep this in sync with the pinned revision used by build-web.ts.
source_pin="$(bun -e 'console.log(require("./integrations/t3/upstream/source.json").revision)')"
web_source="${DIE_T3_SOURCE:-$root/.cache/die-t3code-$source_pin}"

run_step 'Format check' format.log "$root" bun run format:check
run_step 'Lint' lint.log "$root" bun run lint
run_step 'Typecheck' typecheck.log "$root" bun run check
run_step 'Build' build.log "$root" bun run build
run_step 'Offline default OpenAI transport' openai-transport.log "$root" bun scripts/offline-openai-default-transport.ts
# The pinned source may live outside this checkout. Test the binary built above,
# not a dist path inferred from the upstream source location.
export T3_V2_DIE_BINARY="${T3_V2_DIE_BINARY:-$root/dist/die}"
run_step 'Validate web backend' web-tests.log "$web_source/apps/server" ../../node_modules/.bin/vp test run \
  src/provider/Layers/PiProvider.test.ts src/auth/EnvironmentAuth.test.ts src/serverRuntimeStartup.test.ts \
  src/terminal/NodePtyAdapter.test.ts src/terminal/BunPtyAdapter.test.ts src/terminal/Manager.test.ts \
  src/terminal/SubscriberStream.test.ts src/mcp/DieTaskService.test.ts src/mcp/OrchestratorMcpService.test.ts \
  src/orchestration-v2/NativeDieIntegration.production.test.ts src/orchestration-v2/ProjectionStore.test.ts \
  src/orchestration-v2/ProviderContinuationService.test.ts src/orchestration-v2/LocalJobNotification.test.ts \
  src/orchestration-v2/NativeUsageAccounting.test.ts src/orchestration-v2/Adapters/PiAdapterV2.test.ts \
  src/resourceTelemetry/ResourceTelemetry.test.ts
run_step 'Validate focused web model behavior' web-model-tests.log "$web_source/apps/web" \
  ../../node_modules/.bin/vp test run --project unit src/composerDraftStore.test.ts src/lib/chatThreadActions.test.ts
run_step 'Validate web contracts' web-contract-tests.log "$web_source/packages/contracts" \
  ../../node_modules/.bin/vp test run src/browserProfile.test.ts src/orchestratorMcp.test.ts src/providerRuntime.test.ts
run_step 'Validate client projection' web-client-runtime-tests.log "$web_source/packages/client-runtime" \
  ../../node_modules/.bin/vp test run src/state/orchestrationV2Projection.test.ts
run_step 'Deterministic tests' tests.log "$root" env DIE_RUN_LLM_TESTS=0 bun test ./tests
run_step 'Standalone smoke test' smoke.log "$root" bun run smoke -- --reuse-build
