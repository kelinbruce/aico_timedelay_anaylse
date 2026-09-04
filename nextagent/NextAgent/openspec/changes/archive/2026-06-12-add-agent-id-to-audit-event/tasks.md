## 0. Review

- [x] 0.1 对照 archived core-contract baseline 和最小内核 audit writer 设计，确认本 change 只修复 audit envelope，不新增 durable audit sink。
  验证：code review 检查 proposal、design、spec 不包含 `AuditEventCollector`、`saveAuditEvent`、不存在的前置 change 或隐式 gateway persistence。
  来源：proposal 边界；design 边界

## 1. Contract

- [x] 1.1 在 `agent-contracts/observability/index.ts` 的 `AuditEvent` 增加 `readonly agentId?: AgentId`，并从 `agent-common` 导入 `AgentId`。
  验证：`npm run build`；contract test 构造包含 `agentId` 的 `AuditEvent`。
  来源：spec requirement "AuditEvent carries trusted Agent Scope when a run is available"；design 关键设计判断

## 2. Existing Run-Bound Call Sites

- [x] 2.1 在 `agent-runtime/src/audit/audit-calls.ts` 的 `writeRuntimeAudit()` 中传递 `agentId: run.agentId`。
  验证：runtime test 断言 acceptance 和 terminal audit event 携带当前 `run.agentId`。
  来源：spec requirement scenario "Runtime lifecycle audit carries agentId"；design D2

- [x] 2.2 在 `agent-core/src/agent/default-agent.ts` 的 capability audit call site 中传递 `agentId: run.agentId`。
  验证：tool-loop test 断言 `capability.completed` 和 `security.rejected` audit event 携带当前 `run.agentId`。
  来源：spec requirement scenario "Capability audit carries agentId"；design D2

## 3. Negative Contract Checks

- [x] 3.1 增加 source/architecture check，确认本 change 未引入 durable audit persistence。
  验证：`rg "AuditEventCollector|saveAuditEvent|AuditEventRecord|AuditEventStoreGateway|audit_events" packages` 无命中。
  来源：spec requirement "Agent Scope contract change does not introduce durable audit persistence"；design D4

- [x] 3.2 检查已有 run-bound audit event 均显式传递 `run.agentId`，不存在默认 Agent、全局配置或不可信输入补值。
  验证：code review 检查 runtime lifecycle 和 capability audit call site；测试断言 event 的 `agentId` 等于当前 run 固化值。
  来源：spec requirement scenario "Untrusted input cannot override Agent Scope"；design D3

## 4. Verification

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-agent-id-to-audit-event --strict` 和 `openspec validate --all --strict`。
  验证：记录每条命令结果；若存在既有失败，明确区分本 change 新增问题与既有债务。
  来源：AGENTS.md 验证门禁
