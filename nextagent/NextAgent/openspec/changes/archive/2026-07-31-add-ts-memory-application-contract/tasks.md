## 0. 冻结契约确认与 active change 协调

- [x] 0.1 记录长期记忆 Gateway 公开接口调整的群内确认结论。
  验证：`references/frozen-long-term-memory-management-contract-confirmation.md` 记录“Gateway 公开接口调整无问题”。
  来源：proposal「冻结契约确认门禁」、design 7。
- [x] 0.2 记录长期记忆管理边界的群内评审结论和唯一调用链。
  验证：确认记录包含 `web-channel -> agent-contracts/channel.LongTermMemoryManagementPort -> agent-memory application service -> gateway`，并明确 `agent-app` 仅 composition/wiring。
  来源：long-term-memory-management-contract「长期记忆管理提供唯一 Channel 端口」、design 1/7。
- [x] 0.3 按评审结论取消 `agent-contracts/memory` 方案，确认本 change 只扩展已有 `agent-contracts/channel` subpath。
  验证：`rg -n "agent-contracts/memory|LongTermMemoryApplicationPort" openspec/changes/add-ts-memory-application-contract` 除禁止方案说明外无命中。
  来源：proposal「变更范围」、design 1/7。
- [x] 0.4 将 active `add-ts-long-memory-manage` 的目标规范改为 Channel 只消费 `LongTermMemoryManagementPort`，删除 Gateway 直连的规范性陈述。
  验证：`openspec validate add-ts-long-memory-manage --strict` 通过；目标 spec 不要求 Channel 接收或调用 Gateway bindings。
  来源：proposal「影响范围」、design「增量实施路径」。
- [x] 0.5 在 `docs/nextagent-ts-change-roadmap-v2.md` 的长期记忆规划中登记本 change 的 owner、依赖、目标和并行边界，且登记内容与群评审通过的唯一调用链一致。
  验证：roadmap 可检索到 `add-ts-memory-application-contract`，并明确 `agent-contracts/channel`、`agent-memory`、Gateway 和 `agent-app` 的职责。
  来源：`nextagent-skill-review` roadmap change 规则。

## 1. `agent-contracts/channel` 公开契约

- [x] 1.1 在 `packages/agent-contracts/src/channel/index.ts` 和既有 `./channel` export 中增加长期记忆 management DTO 和 port，不新增 contract subpath。
  验证：`npm run build -w @nextagent/agent-contracts`；package export contract test 能从 `@nextagent/agent-contracts/channel` 导入公开契约。
  来源：ts-core-contracts「Core Contract Namespace」、design 1-2。
- [x] 1.2 定义 `LongTermMemoryManagementScope`、management command/query/view/page/result 和单一 `LongTermMemoryManagementPort`；method 精确覆盖 12 个 operation并接收可选 `AbortSignal`。
  验证：新增 `tests/contract/long-term-memory-management-contract.test.ts`，断言 12-method surface、scope 使用完整 `IdentityContext` 加独立 `agentId`、无 count/batch/兼容别名。
  来源：long-term-memory-management-contract「长期记忆管理提供唯一 Channel 端口」「Management 调用使用可信 scope 和取消上下文」、design 2-3。
- [x] 1.3 阻止 management contract 复用或泄漏 Gateway Record、Request、Query、Result、write options 和 bindings。
  验证：type-level/architecture test 实际导入 forbidden Gateway 类型并断言规则失败；合法 channel contract 编译通过。
  来源：long-term-memory-management-contract「Management DTO 与 Gateway Record 保持分层」、design 3。

## 2. `agent-memory` Application Service

- [x] 2.1 新增 `createLongTermMemoryManagementService({ store, retriever, sharing })`，实现 6 个 Store operation 的一一委托和 DTO/Record 映射。
  验证：agent-memory unit tests 覆盖 save/list/manual/get/delete/mutate 的单次调用、mapper、SafeError、write options 和 CAS 透传。
  来源：long-term-memory-management-contract「Application service 统一委托和安全错误」、design 4。
- [x] 2.2 实现 2 个 Retriever operation 委托，保持 search/detail page、score 和 telemetry 语义。
  验证：agent-memory unit tests 覆盖 search/detail mapper、offset/filter、SafeError 和一次调用；现有 Retriever contract tests 通过。
  来源：long-term-memory-management-contract「Application service 统一委托和安全错误」、design 4。
- [x] 2.3 实现 4 个 Sharing operation 委托，保持 publish/unpublish/list/copy 的事务和 provenance 语义。
  验证：agent-memory unit tests 覆盖四个 sharing method、partial-failure result、SafeError 和一次调用；现有 Sharing contract tests 通过。
  来源：long-term-memory-management-contract「Application service 统一委托和安全错误」、design 4。
- [x] 2.4 将 trusted management scope 映射为 Gateway scope，在调用前检查 `AbortSignal`，并把意外异常归一为固定 safe unavailable error。
  验证：unit tests 断言 pre-aborted 时 Gateway 未调用、完整 `IdentityContext` 到达 application boundary、Gateway 只接收 `tenantId/subjectId/agentId`、`displayName`/raw error/content/scope id 不进入 Gateway、返回值或诊断。
  来源：long-term-memory-management-contract「Management 调用使用可信 scope 和取消上下文」「Application service 统一委托和安全错误」、design 3-4。

## 3. Web Channel 接入

- [x] 3.1 将 `registerMemoryRoutes` 和 Web registration dependency 改为 `LongTermMemoryManagementPort`，删除长期记忆 Gateway imports、Record projection 和 `longTermMemoryStores` passthrough。
  验证：Web route tests 使用 management port fake 覆盖 12 routes；`rg -n "LongTermMemoryGatewayBindings|LongTermMemory(Store|Retriever|Sharing)Gateway|LongTermMemoryRecord" packages/agent-channel-web/src` 无命中。
  来源：long-term-memory-management-contract「长期记忆管理提供唯一 Channel 端口」「Management DTO 与 Gateway Record 保持分层」、design 5。
- [x] 3.2 使用 trusted identity/Agent resolver 构造包含完整 `IdentityContext` 和独立 `agentId` 的 management scope，拒绝 body/query authority 字段；现有 REST identity alias 从可信 scope 投影。
  验证：Fastify inject tests 分别提交 `tenantId`、`subjectId`、`userId`、`agentId` 和未知字段，断言 4xx 且 fake port 未调用；合法调用把完整 `IdentityContext` 传给 port，响应保持 `tenantId/userId/agentId` 兼容且不穿透 Gateway Record 或 `displayName`。
  来源：long-term-memory-management-contract「Management 调用使用可信 scope 和取消上下文」、design 3/5。
- [x] 3.3 将 request abort/reply close 连接为 management invocation `AbortSignal`，并映射成功、SafeError 和 unexpected failure。
  验证：route characterization test 断开请求并断言 port signal aborted；HTTP schema/status tests 通过且不输出 raw error。
  来源：long-term-memory-management-contract「Management 调用使用可信 scope 和取消上下文」「Application service 统一委托和安全错误」、design 5。

## 4. Composition 和架构边界

- [x] 4.1 在 `agent-app` 使用 selected Gateway bindings 调用 `createLongTermMemoryManagementService`，只把 `LongTermMemoryManagementPort` 注入 Channel；依赖缺失时不注册 route且不回退。
  验证：composition tests 覆盖 available、missing、ambiguous/disabled provider，断言 Channel 收到 management port 而非 Gateway bindings。
  来源：long-term-memory-management-contract「Management boundary 由 composition 显式启用」、design 6。
- [x] 4.2 更新 dependency-cruiser/package architecture allowlist：允许 `agent-memory -> agent-contracts/channel`，继续允许 `agent-memory -> gateway`，禁止 `agent-channel-web -> gateway` 和 contract-to-implementation dependency。
  验证：`npm run lint:architecture`；negative fixtures 实际触发两种 forbidden import 并断言失败。
  来源：ts-backend-architecture「Package 边界强制」、design 1。
- [x] 4.3 验证 `agent-app` 只有 composition/wiring，没有 management DTO mapping、Record projection、记忆业务校验或直接 route delegation。
  验证：composition tests、dependency graph 和 `$nextagent-code-review` 检查 app 只调用 factory并传递 port；`longTermMemoryStores` 和 Channel Gateway projection 为零。
  来源：long-term-memory-management-contract「Management boundary 由 composition 显式启用」、design 6。

## 5. 完整验证和 Review

- [x] 5.1 运行 focused contract、service、route、composition 和 architecture tests，覆盖 12-method surface、scope、取消、错误、Record 防泄漏和 forbidden imports。
  验证：对应 Vitest 命令全部通过并记录测试文件和用例数。
  来源：design「验证映射」、AGENTS 验证门禁。
- [x] 5.2 运行 `openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`，确认 minimal kernel 无回归。
  验证：命令全部退出 0；任何无关失败必须记录命令、失败项和归属，不得把失败描述为通过。
  证据：OpenSpec 205/205、受影响 workspace TypeScript build、contract 275/275、architecture 190/190 均通过；`npm test` 唯一失败为缺少 Playwright Chromium 的 `agent-dev-workbench` browser smoke，经用户明确确认与本次提交无关后排除该文件重跑，其余 696/696 通过。
  来源：proposal「验证入口」、AGENTS 验证门禁。
- [x] 5.3 使用 `$nextagent-code-review` 审查 frozen contract、architecture boundary、minimal kernel、安全、OpenSpec consistency 和 Clean Code；P0/P1 修复后重新审查。
  验证：review 结论为 `PASS` 或 `PASS WITH FOLLOW-UP`，并引用本 change 的群内确认记录。
  证据：2026-07-17 push 前语义 review 结论为 `PASS WITH FOLLOW-UP`，未发现 P0/P1/P2；follow-up 仅为归档前补齐群消息原始追溯信息，Playwright browser smoke 按用户确认作为无关环境用例排除。
  来源：proposal「冻结契约确认门禁」、design 7、AGENTS Push 门禁。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，按 proposal/design 的 Baseline Promotion Plan 更新 stable specs、overview、memory/core-contracts/backend architecture、`agent-contracts`/`agent-memory`/`agent-channel-web`/`agent-app` modules 和 spec-to-design-map。长期文档不得保留 `agent-contracts/memory` 方案或 Channel 直连 Gateway 路径。归档前尽量补齐群平台、群名称、消息链接和确认人等原始追溯信息。
