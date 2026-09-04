# Design: Local Package Developer Hook Trace Default

## Current State

`scripts/pack-local-runtime.mjs` stages backend-capable local release packages. The existing product path already writes `config/plugins/developer-hook-trace/plugin.json` and `index.js` through `createDeveloperHookTracePluginArtifact(...)`, then stages the default Agent from `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` into the package resource root.

The generated plugin artifact is loader-compatible, but the package sample config does not declare it in `nextAgent.system.plugins[]`, and the packaged default Agent does not activate `developer-hook-trace.loop-raw-boundary`.

## Target Path

`packLocalRuntime(...)` remains the only entrypoint for this default. Frontend-only packaging returns before backend staging and is unchanged.

For backend-capable local release packages:

1. `createReleaseConfigSample(...)` adds a package-scoped `nextAgent.system.plugins[]` entry for `developer-hook-trace` with `path: "plugins/developer-hook-trace"` and `required: true`.
2. `stagePackagedDeveloperHookTracePlugin(...)` continues to write the plugin artifact under `config/plugins/developer-hook-trace/`.
3. `stagePackagedDefaultAgent(...)` parses the built-in default Agent definition and writes only the packaged copy with a `developer-hook-trace.loop-raw-boundary` hook activation for the supported raw loop boundary stages.

The source built-in Agent file is only read. Packaging does not write back to `packages/agent-core/src/builtin-agents/default-agent/agent.yaml`, does not change non-packaged development startup defaults, and does not enable `context-monitor`.

## Failure Behavior

If the source default Agent cannot parse to an object, packaging fails closed before writing the packaged Agent definition. Existing plugin artifact generation failures still fail packaging through `createDeveloperHookTracePluginArtifact(...)`.

## Verification

- `tests/fullstack-packaging-boundary.test.ts` asserts the packaged default Agent hook activation and the release config sample plugin declaration.
- `openspec validate refine-local-package-developer-hook-trace-default --strict`
- `openspec validate --all --strict`

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-7.4-追踪请求链路` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/developer-hook-trace-logging/spec.md`、`openspec/specs/local-runtime-package/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `developer-hook-trace-logging` 中找不到 `Local runtime packaging includes developer hook trace artifact with local release default activation` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
