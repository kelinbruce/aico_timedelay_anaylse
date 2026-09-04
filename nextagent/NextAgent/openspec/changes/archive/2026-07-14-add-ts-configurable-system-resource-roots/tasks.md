## 1. App Config Source Contract

- [x] 1.1 Extend app-private system config schema to accept `paths.agentRoot` and `paths.skillRoot`, defaulting to `agents` and `skills` when omitted.
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-skill-source-config.test.ts --maxWorkers=4`，覆盖 configured resource roots 与 runtime data/execution/shared-data 的 fail-closed negative case。

- [x] 1.2 Resolve `rag.indexes: env:RAG_INDEXES` at the `agent-app/config` source boundary before schema validation, normalizing comma-separated or JSON string-array env values into the existing frozen string array; if the env var is unset or empty in an overlay, keep the existing default indexes.
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=4`

## 2. Defaults And Boundary Preservation

- [x] 2.1 Declare `paths.agentRoot: "agents"` and `paths.skillRoot: "skills"` in `packages/agent-app/config/default-system.yaml`; omitted fields in overlays/tests continue to derive `agents` and `skills` without requiring `RAG_INDEXES` for built-in default startup.
  验证：diff review；`npx vitest run --config vitest.config.release.ts tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/local-skill-source-config.test.ts --maxWorkers=4`

- [x] 2.2 Keep env/config parsing inside `agent-app/config`; downstream packages continue consuming frozen `DefaultSystemConfig` paths and `rag.indexes`.
  验证：code review；existing architecture guard in `tests/agent-kernel/config-assembly.test.ts` still checks lower packages do not import app config or read `process.env`.

- [x] 2.3 Include the default Agent package under `agents/default-agent/agent.yaml` in local runtime packages so the default `paths.agentRoot` points at an existing packaged Agent tree.
  验证：`npx vitest run --config vitest.config.release.ts tests/local-runtime-package.test.ts --maxWorkers=4`；`npm run pack:release -- skip`

## 3. OpenSpec Validation

- [x] 3.1 Validate the change strictly.
  验证：`openspec validate add-ts-configurable-system-resource-roots --strict`
