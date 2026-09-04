# complete-ts-lifecycle-hook-capabilities

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
OpenSpec 归档：[`2026-06-29-complete-ts-lifecycle-hook-capabilities`](../../openspec/changes/archive/2026-06-29-complete-ts-lifecycle-hook-capabilities)
所属分组：Lifecycle Hook

状态：complete
类型：implementation
主要 owner：`agent-runtime`
协作 owner：`agent-contracts`、`agent-capability`、`agent-app`
依赖：`add-ts-lifecycle-hook-execution`、`refine-ts-pending-input-contracts`

目标：
- 在首版 lifecycle hook 基线上补齐完整 hook 能力。
- 明确 stage、effect、ordering、outcome、mutation、pending input 和 fail-closed 行为，使 hook execution 可验证且不破坏 runtime lifecycle ownership。

规格输入：
- Lifecycle hook MUST support the defined stage set consistently across observe, transform and control effects.
- Startup-only `configure(config)` MUST run before runtime accepts requests and must fail closed on invalid system hook configuration.
- `maxHooksPerStage` limits total hooks per stage.
- SYSTEM hooks are grouped and ordered before custom hooks; system order is explicit, custom default order follows declaration order unless absolute or relative order is declared.
- Outcomes include `PASS`, `SKIP`, `DENY`, `BLOCK` and `PEND`; pending outcomes depend on the frozen pending input contract.
- Observe-only hooks may run with bounded parallelism; impact hooks must run as a deterministic serial reduction.
- Stage-specific mutation must be explicit and schema-validated.
- SYSTEM hook failures must fail closed with safe diagnostics.

契约输入：
- Reuse lifecycle hook execution baseline and pending input shared contract.
- Public hook outcome and mutation contracts must remain owned by the appropriate lifecycle/runtime contract boundary.
- Hook implementation must not redefine request lifecycle, terminal commit or stream projection contracts.

实现约束：
- `agent-runtime` owns lifecycle stage execution and outcome reduction.
- `agent-app` only wires configured hooks at startup and injects validated dependencies.
- Hook capability execution must pass cancellation context where hook work can be long-running.
- Diagnostics must not expose prompt, model output, stream delta, credential, local path or raw provider error.

非目标：
- 不引入 runtime plugin hot reload。
- 不让 hook 拥有 request lifecycle、scheduler、terminal commit 或 persistence owner。
- 不让 custom hook bypass owner scope, agent scope or capability governance。

验收要点：
- Unit/contract tests cover ordering, max hooks per stage, effect/outcome combinations, stage mutation validation and pending outcome integration。
- Negative tests cover invalid SYSTEM configuration, SYSTEM failure fail-closed and unsafe diagnostic redaction。
- Architecture tests confirm runtime remains lifecycle owner and app remains composition root。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict` pass。

并行边界：
- Depends on frozen pending input contracts; later pending lifecycle changes consume this hook outcome model rather than redefining it。
- Capability and app composition changes may wire hook providers but must not take lifecycle ownership from runtime。
