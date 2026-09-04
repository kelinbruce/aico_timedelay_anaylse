## 1. 契约层

- [x] 1.1 在 `packages/agent-contracts/src/channel/index.ts` 的 `StreamEventType` 新增 `"OUTPUT_GUARD_BLOCKED"`。验证：类型导出单测 + `tsc -b`。来源：spec `ts-core-contracts` "Guard-forward relay output-guard terminal event"。
- [x] 1.2 contract 测试断言 `StreamEventType` 含 `OUTPUT_GUARD_BLOCKED` 且为 terminal 语义。验证：`npm run test:contract`。来源：spec `ts-core-contracts` "OUTPUT_GUARD_BLOCKED is a terminal stream event"。

## 2. 归档前更新基线检查（非实施任务）

归档前依据 proposal/design 的"归档前更新基线"执行：合并 `specs/ts-core-contracts`、`specs/ts-web-sse-ws-transports` 的例外 requirement；`designs/architecture/core-contracts.md` 的 `StreamEventType` 清单 + stream-derivation 不变量补例外；`overview.md`、`designs/spec-to-design-map.md` 导航更新。本节不作为普通 checkbox 实现任务，由归档前流程执行。

## 3. 下游协同

- [x] 3.1 `add-ts-safety-guardrails` 输出护栏改回简单模型：guard-forward relay 注入 terminal `OUTPUT_GUARD_BLOCKED` → 前端清空本轮；撤掉 `failRun` 链路（若 failRun 无其他用途则移除）。验证：guardrail change 自身测试。来源：本 refinement 决策 1、`add-ts-safety-guardrails` 输出护栏 requirement。
