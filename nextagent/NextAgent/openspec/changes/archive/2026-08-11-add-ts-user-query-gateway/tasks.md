## 0. 公共契约确认

- [x] 0.1 完成 `UserQueryGateway`、`user-query` adapter、`GatewayBindings.userQuery` 和共享知识 optional `ownerUserName` 的群内确认，并把确认结论记录到 change references；完成后公共契约实现范围与 specs 一致。
  来源：`FN-10.5 集成外部系统`、`FN-8.15 管理长期记忆` + design“待确认问题”。
  验证：人工检查确认记录明确接受 `agent-contracts/gateway` 与 `agent-contracts/channel` 的新增内容；`rg -n "确认|approved|同意" openspec/changes/add-ts-user-query-gateway/references` 至少命中一条有效确认结论。
  记录：2026-08-08 用户反馈“已群内确认”；执行上述 `rg` 命中确认日期、确认结论和确认范围，公共契约实现门禁解除。

## 1. `FN-10.5 集成外部系统`

- [x] 1.1 先为用户查询公共 schema、`user-query` 配置识别、LOCAL 默认 selection、binding 缺失/未选择/冲突、取消和 `${subjectId}-name` 映射补充失败测试；变更前目标用例必须因 contract 或实现缺失失败。
  来源：`FN-10.5 集成外部系统` + Requirement“用户查询 Gateway 提供稳定公共契约”“用户查询 Gateway 通过正式 adapter 注册” + Scenarios“批量查询返回有序用户结果”“拒绝越界或重复目标集合”“查询被取消”“省略 Gateway 配置时获得 LOCAL 用户查询”“LOCAL 用户名是确定性映射”“REMOTE selection 缺少 provider”“Provider 返回未选择或冲突 binding”。
  验证：运行 `npx vitest run --config vitest.config.contract.ts tests/contract/gateway-configuration-contracts.test.ts tests/contract/user-query-gateway-contract.test.ts` 和 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/gateway-composition.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts packages/agent-platform-gateway-local/tests/local-user-query-gateway.test.ts`；预期新增目标用例在实现前失败，既有用例保持通过，并记录失败原因。

- [x] 1.2 在 `agent-contracts/gateway` 实现用户查询 types、runtime schemas、异步 `UserQueryGateway`、`GatewayAdapterKind='user-query'` 和顶层 optional `GatewayBindings.userQuery`；完成后 schema 可拒绝未知、空、超量和重复输入并接受合法结果。
  来源：`FN-10.5 集成外部系统` + Requirement“用户查询 Gateway 提供稳定公共契约” + Scenarios“批量查询返回有序用户结果”“缺失用户不泄漏存在性”“拒绝越界或重复目标集合”“查询被取消”；design“FN-10.5 集成外部系统 / 修改方案”1。
  验证：运行 `npx vitest run --config vitest.config.contract.ts tests/contract/user-query-gateway-contract.test.ts` 和 `npm run build --workspace @nextagent/agent-contracts`；预期 contract tests 与 strict TypeScript build 全部通过。

- [x] 1.3 把 `user-query` 接入 app 配置稳定集合、runtime schema、默认 LOCAL entry 以及 Gateway binding merge/readiness/conflict 唯一路径；完成后 selected entry 必须获得唯一 `userQuery` binding，REMOTE 缺失不回退。
  来源：`FN-10.5 集成外部系统` + Requirement“用户查询 Gateway 通过正式 adapter 注册” + Scenarios“省略 Gateway 配置时获得 LOCAL 用户查询”“REMOTE selection 缺少 provider”“Provider 返回未选择或冲突 binding”；design“FN-10.5 集成外部系统 / 修改方案”2-3。
  验证：运行 `npx vitest run --config vitest.config.contract.ts tests/contract/gateway-configuration-contracts.test.ts` 和 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/gateway-composition.test.ts packages/agent-app/tests/configuration-composition.test.ts`；预期合法配置、missing、unselected、conflict 和 REMOTE no-fallback 用例全部通过。

- [x] 1.4 在 `agent-platform-gateway-local` 实现并导出无状态 LOCAL 用户查询 Gateway，由现有 LOCAL provider 按 selection 返回 binding；完成后合法目标按顺序映射为 `${subjectId}-name`，已取消请求返回安全取消错误且不创建外部资源。
  来源：`FN-10.5 集成外部系统` + Requirement“用户查询 Gateway 通过正式 adapter 注册” + Scenarios“LOCAL 用户名是确定性映射”“查询被取消”；design“FN-10.5 集成外部系统 / 修改方案”4-5。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/local-user-query-gateway.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts` 和 `npm run build --workspace @nextagent/agent-platform-gateway-local`；预期映射、顺序、取消、selected-only binding 和 build 全部通过。

- [x] 1.5 完成 `FN-10.5` 的 contract、配置、composition 和 architecture 验证，确认没有新增第二套 app-option 注册入口、单成员聚合 binding、Working Memory 归属或仓内 REMOTE transport。
  来源：design“FN-10.5 集成外部系统 / 修改方案”1-6。
  验证：运行 `npx vitest run --config vitest.config.contract.ts tests/contract/user-query-gateway-contract.test.ts tests/contract/gateway-configuration-contracts.test.ts`、`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/gateway-composition.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts packages/agent-platform-gateway-local/tests/local-user-query-gateway.test.ts` 和 `npm run lint:architecture`；预期全部通过。

## 2. `FN-8.15 管理长期记忆`

- [x] 2.1 先为 management 用户名投影、页面 owner 去重、部分缺失、普通失败回退、取消、空页和 Web/frontend 用户名优先补充失败测试；变更前目标用例必须因字段或调用缺失失败。
  来源：`FN-8.15 管理长期记忆` + Requirement“共享知识展示发布者用户名” + Scenarios“LOCAL 共享知识显示默认用户名”“同一页面批量解析发布者”“单个发布者未解析时回退标识”“用户查询普通失败不阻断共享知识”“用户查询取消终止管理请求”“空共享知识页面不查询用户”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-channel-web/tests/memory-routes.test.ts` 和在 `frontend/agent-web` 运行 `npm test -- MemoryManagePage.test.tsx memoryService.test.ts`；预期新增目标用例在实现前失败，既有用例保持通过，并记录失败原因。

- [x] 2.2 在 channel contract 增加 optional `ownerUserName`，在 `agent-memory` 使用可信 scope、去重目标和同一 signal 调用 `UserQueryGateway`，并实现成功、普通失败回退和取消分支；完成后 management page 保留 required `ownerSubjectId` 且只对命中项增加用户名。
  来源：`FN-8.15 管理长期记忆` + Requirement“共享知识展示发布者用户名” + Scenarios“同一页面批量解析发布者”“单个发布者未解析时回退标识”“用户查询普通失败不阻断共享知识”“用户查询取消终止管理请求”“空共享知识页面不查询用户”；design“FN-8.15 管理长期记忆 / 修改方案”1-4。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts`、`npm run test:contract -- tests/contract/long-term-memory-management-contract.test.ts`、`npm run build --workspace @nextagent/agent-contracts` 和 `npm run build --workspace @nextagent/agent-memory`；预期 scope、去重、投影、回退、取消、空页、contract 分层和 builds 全部通过。

- [x] 2.3 在 app channel composition 注入冻结的 `GatewayBindings.userQuery`，在 Web DTO 与前端 contract 增加 optional `ownerUserName`，并让列表和详情统一使用 `ownerUserName ?? ownerUserId`；完成后 LOCAL 默认页面显示 `${ownerUserId}-name`，缺失时显示 ID。
  来源：`FN-8.15 管理长期记忆` + Requirement“共享知识展示发布者用户名” + Scenarios“LOCAL 共享知识显示默认用户名”“单个发布者未解析时回退标识”；design“FN-8.15 管理长期记忆 / 修改方案”2、5。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-channel-web/tests/memory-routes.test.ts`；在 `frontend/agent-web` 运行 `npm test -- MemoryManagePage.test.tsx memoryService.test.ts` 和 `npm run build`；预期 composition、REST DTO、用户名优先、ID 回退和前端 build 全部通过。

- [x] 2.4 完成 `FN-8.15` 回归验证，确认 publish、unpublish、copy、分页、排序、计数、脱敏和 required `ownerUserId` 未被用户名投影改变。
  来源：`FN-8.15 管理长期记忆` + Requirement“共享知识展示发布者用户名” + design“FN-8.15 管理长期记忆 / 修改方案”6。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-channel-web/tests/memory-routes.test.ts` 和在 `frontend/agent-web` 运行 `npm test -- MemoryManagePage.test.tsx memoryService.test.ts memoryTransfer.test.ts`；预期新增与全部既有共享知识用例通过。

## 3. 跨 Function 集成

- [x] 3.1 验证 LOCAL 默认 selection → provider binding → app composition → management owner resolution → Web DTO → 前端展示的完整路径，并用 REMOTE fake provider 验证外部仓只需实现和注册同一 contract；完成后不存在 raw config 重解析、Channel 直连 Gateway 或运行期 adapter 回退。
  来源：`FN-10.5 集成外部系统`、`FN-8.15 管理长期记忆` + design“跨 Function 协作与端到端流程”。
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/gateway-composition.test.ts packages/agent-app/tests/composition.test.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-channel-web/tests/memory-routes.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts` 和 `npm run lint:architecture`；预期 LOCAL/REMOTE fake provider 路径与架构 negative cases 全部通过。

## 4. Change 整体验证

- [x] 4.1 完成 OpenSpec、后端、contract、architecture 和前端门禁，并记录任何与本 change 无关的既有失败；所有本 change 目标测试必须通过。
  来源：proposal“影响范围” + design“验证策略”。
  验证：运行 `openspec validate add-ts-user-query-gateway --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；在 `frontend/agent-web` 运行 `npm run build` 和相关 `npm test -- MemoryManagePage.test.tsx memoryService.test.ts memoryTransfer.test.ts`。预期本 change 严格校验和受影响测试全部通过；全仓无新增失败。

## 实施验证记录

- 1.1：实现前运行新增 contract 与 LOCAL 测试，`userQueryRequestSchema`/`userQueryResultSchema` 为 `undefined`，LOCAL factory 不存在，目标用例按预期 RED；同时记录当时缺失本地 npm 依赖导致的无关导入失败，随后按 lockfile 恢复依赖。
- 1.2–1.5：`tests/contract/user-query-gateway-contract.test.ts`、`gateway-configuration-contracts.test.ts`、`packages/agent-app/tests/gateway-composition.test.ts`、LOCAL provider/user-query tests 全部通过；`npm run build` 与 `npm run lint:architecture` 通过。
- 2.1：实现前 management 与前端用户名断言失败，证明既有路径只投影 `ownerUserId`；实现后的同一目标用例通过。
- 2.2–2.4：`packages/agent-memory/tests/long-term-memory-management.test.ts` 与 `packages/agent-channel-web/tests/memory-routes.test.ts` 共 23 项通过；前端用户名优先目标用例、`memoryService.test.ts` 12 项、`memoryTransfer.test.ts` 9 项及前端 TypeScript build 通过。
- 3.1：app composition 的 LOCAL 保存→发布→共享列表路径返回 `${ownerSubjectId}-name`；REMOTE fake provider 的成功、provider 缺失、binding 缺失和 unselected binding 用例通过；架构测试确认 Channel 不依赖 Gateway contract，且不存在单成员或 memory 聚合 binding。
- 4.1：`openspec validate add-ts-user-query-gateway --strict` 通过；`npm run build` 通过；`npm test` 为 154 files / 1891 tests 全部通过；`npm run test:contract` 为 46 files / 363 tests 全部通过；`npm run lint:architecture` 为 47 files / 293 tests 全部通过；`npm run lint:code` 为 0 errors、17 个既有 warnings。`openspec validate --all --strict` 为 300 项通过、2 个既有 change（`fix-conversation-preview-validation`、`fix-session-list-validation`）失败。前端完整目标套件中 3 个既有路径脱敏测试失败，已在本 change 生产实现前复现；本 change 新增/修改的用户名行为测试与前端 build 均通过，未新增失败。

## 归档前更新基线检查（非实施任务）

归档时先完成并归档 `add-ts-long-memory-manage`，再按照 design“长期基线刷新计划”归并本 change；检查用户查询 schema、Gateway binding、共享知识 publisher projection 和 Function 规格没有跨 stable spec、architecture、module 或 Function 文档重复定义。
