## 1. `FN-8.1 持久化运行数据`

- [x] 1.1 为 LOCAL RequestRun 批量查询先增加失败测试，覆盖 `sessionIds`、`runIds`、交集、稳定分页、去重和 `hasMore`；实施前运行并确认因 `listRuns` 尚不存在而失败
  来源：`FN-8.1` + `RequestRun 批量分页查询` + `按多个 sessionId 查询`、`按多个 runId 查询`、`sessionId 与 runId 同时过滤`、`稳定分页并指示下一页`
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 在实现前包含新增用例失败；实现后同一命令通过且断言目标 page 结果
  证据：`npm test -w @nextagent/agent-platform-gateway-local -- sqlite-gateway-stores.test.ts` 实现前 10 个新增用例因 `listRuns is not a function` 失败；LOCAL 实现后 57/57 通过

- [x] 1.2 为非法过滤、非法 offset、`limit=0`、`limit=101` 和跨 scope 同值 ID 先增加 negative tests，确认非法输入产生 `REQUEST_RUN_QUERY_INVALID` 且不返回 records
  来源：`FN-8.1` + 系统质量属性“安全、性能/容量” + `RequestRun 批量查询有界且隔离 scope` + `单页达到最大值`、`limit 超过最大值`、`未提供有效过滤集合`、`相同 ID 存在于其他 scope`
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 在实现前包含新增用例失败；实现后同一命令通过且所有 negative assertions 成立
  证据：同一 LOCAL 定向命令验证 9 组非法 query 均返回 `REQUEST_RUN_QUERY_INVALID`，跨 scope 同值 runId 只返回当前 Owner/Agent scope record

- [x] 1.3 在 `agent-contracts` 和 LOCAL Working Memory adapter 中实现 `RequestRunListQuery`、`RequestRunRecordPage`、required `listRuns`、参数校验及参数化分页 SQL，保持 `loadRun` 不变
  来源：`FN-8.1` + `RequestRun 批量分页查询` 全部 Scenarios；design `FN-8.1 持久化运行数据 / 修改方案` 第 1-4 项
  验证：`npm run typecheck` 通过；`npx vitest run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 通过
  证据：`npm run typecheck` 通过；LOCAL 定向测试 57/57 通过，包含非数组过滤值的 runtime negative cases

- [x] 1.4 更新受 required `listRuns` 影响的测试替身和 wrapper，确保只做 contract 兼容补齐，不迁移任何现有业务调用方
  来源：proposal 非目标“单条 loadRun 行为不变”；design `FN-8.1 持久化运行数据 / 修改方案` 第 6 项
  验证：`npm run typecheck` 通过；code review 确认非分享产品调用点仍按其单记录语义使用 `loadRun`
  证据：`npm run typecheck` 通过；生产 wrapper 仅透传 `listRuns`，所有现有 `loadRun` 产品调用点均未迁移

## 2. Change 整体验证

- [x] 2.1 执行相关 package、contract、architecture 和 OpenSpec 门禁，确认 gateway contract、LOCAL provider、外部 REMOTE 适配责任及 scope 边界一致
  验证记录（2026-08-24）：`npm run build`、`npm test`（172 files / 2242 tests）、`npm run test:contract`（50 files / 388 tests）、`npm run lint:architecture`（54 files / 321 tests）全部通过；`openspec validate --all --strict` 通过。
  来源：proposal 影响范围 + design `验证策略`
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict` 全部通过
  证据：`npm run build`、`npm run typecheck`、LOCAL 定向测试、core contract 定向测试、observability wrapper 定向测试和 `openspec validate --all --strict` 通过；全量 `npm test`、`npm run test:contract`、`npm run lint:architecture` 仍受本 change 之外的既有失败阻断，详见实施总结

- [x] 2.2 检查 diff，确认没有新增未使用代码、provider-private AgentMemory DTO、逐 ID REMOTE fallback、schema/index 变更或与本 change 无关的重构
  来源：proposal 非目标 + design `修改方案`、`风险与取舍`
  验证：`git diff --check` 通过；人工检查 `git diff -- packages openspec/changes/add-request-run-batch-query` 满足上述边界
  证据：`git diff --check` 通过；conversation share 与 `agent-platform-gateway-remote` 均不在最终 diff，生产改动仅包含 gateway contract、LOCAL 实现和既有 wrapper 透传

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 stable spec、Function、overview、architecture、modules 和 spec-to-design-map；Feature 与 ADR 保持不变，并检查公共 contract schema、scope 规则和 provider owner 没有重复规范来源。
