## 背景与问题（Why）

当前 `RequestRunStoreGateway.listRecoverableRuns(SystemListRecoverableRunsRequest)` 被定义为无 Agent Scope、无 Owner Scope 的系统级全局扫描。该模型假设一个 runtime 进程拥有整个 request run 数据集的恢复职责，但实际部署中一个 NextAgent 应用只承载一个 Agent，并且可能同时存在多个承载不同 Agent 的 NextAgent 应用。全局扫描会使实例发现并尝试恢复不属于当前 Agent 的 run，可能使用错误的 Agent assembly、model profile、capability binding 和 context policy。

此外，当前 runtime 对 `ACCEPTED`、`QUEUED`、`PLANNING` run 在恢复时直接重建并入队，没有先取得原子 claim。同一 Agent 在滚动发布、故障切换或短暂双副本期间，多个实例可能重复恢复并执行同一个 run。恢复发现必须按可信 Agent Scope 隔离，恢复执行必须由带 lease 和 version CAS 的 claim 串行化。

## 变更范围（What Changes）

- **BREAKING**：将系统级 `SystemListRecoverableRunsRequest` 调整为 Agent-scoped recovery discovery request，强制携带可信 `agentId`、`now` 和 `limit`。
- `listRecoverableRuns` 只返回指定 `agentId` 下符合状态、terminal commit state 和 lease 条件的候选 run；不要求 tenant/user 过滤，因为一个 Agent 实例负责该 Agent 下所有 Owner Scope 的恢复发现。
- `agentId` 只能来自 `agent-app` 的可信 composition/hosted-agent selection，不得来自 Web 请求、客户端 metadata、模型输出或 capability 参数。
- runtime 对会重新执行的 `ACCEPTED`、`QUEUED`、`PLANNING`、`EXECUTING` run 必须先通过现有 `claimRun` 的 scoped version CAS 和 lease 取得所有权，只有 claim 成功的实例可以重建或入队。
- 有效 lease 的 run 不得被恢复发现或接管；lease 到期后允许其他同 Agent 实例重新 claim。`now` 必须参与该判定。
- discovery 返回的 `RequestRunRecord` 继续显式携带 `tenantId`、`subjectId` 和 `agentId`；后续 session、message、timeline、checkpoint、claim 和 terminal commit 操作继续使用完整 Agent Scope 与 Owner Scope。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `local-run-timeline-store`：把 recoverable run 发现从无 scope 的系统级扫描改为可信 Agent Scope 扫描，并补充 lease 可见性与所有可执行状态的原子 claim 要求。
- `local-runtime-recovery`：定义单 Agent 应用的恢复所有权来源、同 Agent 多实例竞争规则和 claim-before-rebuild 行为。

## 影响范围（Impact）

- Contract：`packages/agent-contracts` 中 `RequestRunStoreGateway` 的 recoverable discovery request；属于 frozen core contract 敏感变更，必须由本 change 明确定义并通过 contract review。
- Runtime：`packages/agent-runtime` 的 local recovery scan、queued rebuild、executing takeover 和恢复报告路径。
- Composition：`packages/agent-app` 向恢复入口提供当前应用可信 `agentId`。
- Gateway local：`packages/agent-platform-gateway-local` 的 SQLite 查询条件、lease 判断、`locked_by`/`lock_expires_at` 私有 row 映射和必要索引。
- 测试：gateway contract、runtime characterization、同 Agent 多实例竞争、跨 Agent negative case、lease expiry 和 minimal kernel non-regression。
- 运维：不同 Agent 的 NextAgent 应用共享 persistence backend 时，恢复任务不再跨 Agent 竞争；同 Agent 多副本仍由 claim lease 协调。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/local-run-timeline-store/spec.md`：更新 Agent-scoped recovery discovery、lease 过滤和 claim 语义。
- `openspec/specs/local-runtime-recovery/spec.md`：更新恢复所有权、可信 Agent Scope 和多实例 claim-before-rebuild 行为。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：更新 `RequestRunStoreGateway` recoverable discovery contract 和恢复 scope 不变量。
- `openspec/designs/architecture/runtime-recovery.md`：如现有文档存在则更新 Agent-scoped discovery 与 claim/lease 流程；否则把长期流程归并到最接近的 runtime lifecycle/recovery architecture 文档，不新增平行主题。
- `openspec/designs/modules/agent-runtime.md`：更新 runtime recovery owner、claim-before-rebuild 和非职责边界。
- `openspec/designs/modules/agent-platform-gateway-local.md`：更新 Agent-scoped SQLite discovery、lease 私有 row 映射与 query 责任。
- `openspec/designs/modules/agent-app.md`：更新可信 recovery Agent Scope 的 composition 来源。
- `openspec/designs/adr/<id>.md`：无；本次选择是现有 Agent Scope 和 claim/lease 原则的直接应用，不新增独立技术路线。
- `openspec/designs/spec-to-design-map.md`：更新 `local-run-timeline-store`、`local-runtime-recovery` 到相关 architecture/module 文档的导航。

验证入口：
- gateway contract tests 验证跨 Agent negative case、Owner Scope 聚合、lease 可见性和 limit/order。
- runtime characterization tests 验证所有可执行状态 claim-before-rebuild、同 Agent 双实例只有一个实例恢复成功。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
