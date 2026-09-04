## agent-contracts 破坏性变更确认

- [x] 0.1 独立确认 `AgentListUnresolvedPendingInputTimeoutFactsRequest` 与 `listUnresolvedPendingInputTimeoutFacts(...)` 完整替换旧全局 due query，不保留 alias；确认只补齐治理记录，不新增代码修改。
  来源：design `需群内确认`。
  验证：人工审查确认记录包含日期、确认范围、breaking symbols、原子迁移边界和“不授权新增代码修改”。
  完成证据：2026-07-31 当前会话用户回复“OK，先修正OpenSpec文档，先不动代码，修正完做review”。

## FN-6.5 请求用户确认或授权

- [x] 1.1 Update contract and local-gateway regression tests for future `PENDING` facts, incomplete `TIMED_OUT` recovery, cross-Agent exclusion, cross-Owner retention, stable keyset pagination, invalid bounds and removal of both superseded query names.
  来源：FN-6.5 + Requirements `系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`。
  验证：`npx vitest run --config vitest.config.contract.ts tests/contract/core-contracts.test.ts`、`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-gateway-contract.test.ts`、`npx vitest run --config vitest.config.architecture.ts tests/architecture/workspace.test.ts`。
  完成证据：contract 33/33、local gateway 59/59、target architecture 25/25通过；future `PENDING`、删除级联和旧symbol negative assertions均被实际覆盖。

- [x] 1.2 Replace the current unarchived candidate request/method with `PendingInputTimeoutFactCursor`、`AgentListUnresolvedPendingInputTimeoutFactsRequest` and `listUnresolvedPendingInputTimeoutFacts`, removing `now` and migrating all compile-time consumers/test doubles without aliases.
  来源：design `唯一公共契约` 与 `边界保持`。
  验证：`npm run build --workspace @nextagent/agent-contracts && npm run build --workspace @nextagent/agent-platform-gateway-local && npm run build --workspace @nextagent/agent-runtime`。
  完成证据：三个 package build通过；production source只保留新request/method，旧名称仅存在于negative assertion和change说明。

- [x] 1.3 Update the SQLite query to return all accepted future/due `PENDING` facts and incomplete `TIMED_OUT` facts in stable keyset order, retaining the Agent-leading partial index and strict `1..1000` validation.
  来源：FN-6.5 + Requirements `系统在可信 Agent Scope 内发现未完成 timeout facts`、`Timeout fact discovery 保持可信 scope 隔离`、`Timeout fact discovery 使用有界稳定遍历`；design `Fact 筛选与 SQLite 映射`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-gateway-contract.test.ts`。
  完成证据：local gateway 59/59通过；query移除`now`，使用`idx_pending_inputs_timeout_facts(agent_id, timeout_at, pending_input_id, status)`并保持bounded keyset。

## 整体验证

- [x] 2.1 Run contract, local gateway, architecture and strict OpenSpec validation, proving the gateway returns durable facts only and exposes no due/scheduling decision.
  验证：`npm run test:contract`、`npm run lint:architecture`、`openspec validate refine-ts-pending-input-timeout-contracts --strict`。
  完成证据：contract 324/324、architecture 243/243、NetAgent focused guard 9/9、local gateway 59/59与全库 OpenSpec strict 253/253通过；专项 OpenSpec 语义审查 PASS。
