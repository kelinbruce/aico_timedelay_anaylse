## 背景与问题（Why）

stream replay、local runtime recovery 和副作用幂等保护涉及真实连接状态、真实进程生命周期和真实持久化状态。单进程 integration test 无法证明断连、终止和重启后仍满足 canonical timeline、terminal correctness 与非幂等能力不重复执行的不变量。

## 变更范围（What Changes）

- 新增 resilience E2E gate，为 e2e-P0-05、27、28 建立唯一主要维护归属。
- 使用真实 SSE/WebSocket 断连重连、真实 process kill/restart 和真实 local persistence 验证恢复。
- 将结果作为既有 resilience hard gate 的 E2E evidence；正常 cancel/retry/edit 旅程归 `add-ts-e2e-product-journey-gate`。
- 不新增 recovery 状态、checkpoint contract、timeline event 或 capability replay policy。

BREAKING：无。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-e2e-resilience-gate`: 定义首版本地 release 必须通过的真实断连和进程恢复 E2E。

### 修改的 Capability
无。

## 影响范围（Impact）

- 主要影响 `tests/e2e/` resilience Playwright project、process controller、故障注入 fixture 和恢复 evidence。
- 消费 stream replay、local recovery、checkpoint、terminal commit、gateway persistence 和 idempotency guard 既有行为。
- 不修改 `agent-contracts`。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-e2e-resilience-gate/spec.md`：新增真实恢复 E2E gate。

长期背景：
- `openspec/overview.md`：记录首版本地 release 需要断连/重启恢复 E2E evidence。

设计视图：
- `openspec/designs/architecture/e2e-quality-gates.md`：承载 resilience E2E 故障边界和 evidence 规则。
- `openspec/designs/architecture/request-run.md`：只增加恢复 E2E 验证入口导航。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加导航。

验证入口：
- `npm run test:e2e:resilience`
- `openspec validate add-ts-e2e-resilience-gate --strict`
