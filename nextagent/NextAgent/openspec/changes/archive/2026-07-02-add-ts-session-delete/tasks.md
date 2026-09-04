## 1. Contract 和边界定义

- [x] 1.1 扩展 `agent-contracts/runtime`，新增 `RuntimeDeleteSessionCommand` 和 `RuntimeSessionPort.deleteSession(command): Promise<void>`。
  验证：`npm run build`；新增或更新 runtime contract type tests。
  来源：`session-delete` Requirement「会话删除命令受 runtime 和 session 边界控制」；design D2。
- [x] 1.2 扩展 `agent-contracts/session`，新增 `DeleteUserSessionCommand` 和 `UserSessionPort.deleteSession(command): Promise<void>`，输入只包含 trusted `IdentityContext`、trusted `agentId` 和 `sessionId`。
  验证：`npm run build`；session public contract tests 断言不暴露 Web DTO、gateway Record 或客户端 owner/agent 字段。
  来源：`ts-minimal-agent-kernel` Requirement「Runtime session port supports scoped session deletion」；design D2。
- [x] 1.3 扩展 gateway contract，新增 owner+agent scoped session composite delete 输入和结果，禁止使用 `*Record + idempotencyKey` 形态表达删除控制信息。
  验证：`npm run test:contract`；gateway contract tests 覆盖输入 scope 和 active run conflict 结果。
  来源：`session-delete` Requirement「会话删除使用单事务物理删除主路径事实」；design D4。

## 2. Runtime 和 Session 领域实现

- [x] 2.1 在 runtime session facade 中实现 `deleteSession`，解析 trusted Agent Scope 后委托 `UserSessionPort.deleteSession`。
  验证：runtime unit/characterization tests 覆盖 `agentId` 来自 resolver 且客户端字段不能覆盖；`npm test`。
  来源：`ts-minimal-agent-kernel` Requirement「Runtime session port supports scoped session deletion」；design D2。
- [x] 2.2 在 `agent-session` 中实现会话删除领域服务，按 owner+agent scope 调用 gateway composite delete，并将 not-found、conflict 和 storage failure 映射为 safe outcome。
  验证：session service tests 覆盖成功、not-found、conflict、storage failure；`npm test`。
  来源：`session-delete` Requirements「会话删除保持 owner scope 和 Agent scope 隔离」「运行中会话删除失败关闭」；design D3。
- [x] 2.3 增加 negative characterization tests，断言删除运行中 session 返回 conflict，且不会调用 cancel、不会修改 run terminal state、不会删除 session facts。
  验证：新增 runtime/session characterization tests 实际构造非 terminal run 并断言失败；`npm test`。
  来源：`session-delete` Requirement「运行中会话删除失败关闭」；design D3。

## 3. Gateway-local 持久化

- [x] 3.1 在 `agent-platform-gateway-local` 实现 session composite delete transaction，删除 session、messages、active context、request runs、timeline events、checkpoints 及当前实现中的会话从属 projection facts。
  验证：gateway-local tests 断言删除后 list/require/conversation/timeline/active context/checkpoint 均不可见；`npm test`。
  来源：`session-delete` Requirement「会话删除使用单事务物理删除主路径事实」；design D4。
- [x] 3.2 为 gateway-local 添加跨 owner 和跨 Agent negative tests，断言相同 `sessionId` 字符串在其他 scope 下不被删除。
  验证：gateway-local tests 实际创建两个 scope 的同名 session 并断言只删除当前 scope；`npm test`。
  来源：`session-delete` Requirement「会话删除保持 owner scope 和 Agent scope 隔离」。
- [x] 3.3 为 gateway-local 添加 active run conflict tests，断言非 terminal run 存在时 composite delete 不删除任何会话事实。
  验证：gateway-local transaction tests；`npm test`。
  来源：`session-delete` Requirement「运行中会话删除失败关闭」；design D3/D4。
- [x] 3.4 为 gateway-local 添加事务回滚测试，注入删除中途失败并断言 session、messages、timeline、annotation/share facts 均保持删除前状态。
  验证：gateway-local rollback test；`npm test`。
  来源：`session-delete` Requirement「会话删除使用单事务物理删除主路径事实」；design D4。
- [x] 3.5 将 conversation annotations、favorites 和 shares 纳入 composite delete，并验证删除后收藏列表、会话标注查询和 share 查看不再暴露已删除会话内容。
  验证：annotation/share gateway tests 和 Web/API tests；`npm test`、`npm run test:contract`。
  来源：`conversation-annotation` Requirement「会话删除级联清理对话标注」；`conversation-share` Requirement「Session lifecycle obligation for shares」；design D6。

## 4. Web API

- [x] 4.1 在 `agent-channel-web` 新增 `DELETE /api/v1/sessions/:sessionId` route，请求不接收 body，成功返回 204。
  验证：Web route tests 覆盖成功响应无内容；`npm test`。
  来源：`session-delete` Requirement「会话删除命令受 runtime 和 session 边界控制」；design D1。
- [x] 4.2 为删除 route 添加 safe error tests，覆盖跨 scope not-found、active run conflict 和 storage unavailable safe error。
  验证：Web route negative tests 实际触发 404/409/503 safe error；`npm test`。
  来源：`session-delete` Requirements「会话删除保持 owner scope 和 Agent scope 隔离」「运行中会话删除失败关闭」；design D1/D3。
- [x] 4.3 添加架构边界验证，确保 `agent-channel-web` 删除 route 不导入 gateway-local、session private path 或 SQLite row mapper。
  验证：`npm run lint:architecture`；若现有 lint 无法覆盖，新增 architecture test fixture 实际触发 forbidden import failure。
  来源：`session-delete` Requirement「会话删除命令受 runtime 和 session 边界控制」；design D2。

## 5. Frontend 会话列表交互

- [x] 5.1 在普通 Sidebar 会话行、local/immersive search dialog 和 collaborative PIU History Popover 的现有 row action 中加入删除入口、确认交互、loading/error 状态和 i18n 资源。
  验证：frontend component tests 覆盖删除入口、确认、取消、loading、error；`npm test`。
  来源：`session-delete` Requirement「前端会话列表提供删除交互」；design D7。
- [x] 5.2 删除成功后按当前窗口刷新：普通列表保持普通偏好，搜索态保留 `q/createdFrom/createdTo` 和已加载窗口，PIU 不写入新的 search storage key。
  验证：frontend session list/search/PIU tests 覆盖刷新请求参数和状态保持；`npm test`。
  来源：`session-history-search` Requirement「会话搜索结果复用删除动作并保持搜索窗口」；design D7。
- [x] 5.3 删除当前打开会话后清除 current session selection 或进入新会话安全状态，并确保旧 conversation cache 不再作为当前会话展示。
  验证：frontend route/state tests 覆盖删除 active session 后 UI 状态和 `nextagent:AIAgentPIU:activeSessionId` 清理；`npm test`。
  来源：`session-delete` Requirement「前端会话列表提供删除交互」；design D7。

## 6. 集成和回归验证

- [x] 6.1 补充端到端或集成测试：创建 session -> submit terminal -> list -> delete -> list/history/share/annotation 不再可见。
  验证：新增 integration/e2e test；`npm test` 或仓内对应 e2e 命令。
  来源：`session-delete` Requirements「会话删除使用单事务物理删除主路径事实」「前端会话列表提供删除交互」。
- [x] 6.2 运行常规质量门禁，确认非删除主路径不回退。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
  来源：AGENTS.md 验证门禁；design Verification Map。
- [x] 6.3 运行 OpenSpec 验证。
  验证：`openspec validate add-ts-session-delete --strict`、`openspec validate --all --strict`。
  来源：OpenSpec schema rules；proposal/design Baseline Promotion Plan。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/session-delete/spec.md`。
- 同步 `openspec/specs/session-history-search/spec.md`、`openspec/specs/conversation-annotation/spec.md`、`openspec/specs/conversation-share/spec.md`、`openspec/specs/ts-minimal-agent-kernel/spec.md` 中仍成立的行为。
- 按需更新 `openspec/overview.md`。
- 更新 `openspec/designs/architecture/web-channel-api-surface.md`、`runtime-boundaries.md`、`core-contracts.md`。
- 更新 `openspec/designs/modules/agent-channel-web.md`、`agent-runtime.md`、`agent-session.md`、`agent-platform-gateway-local.md`。
- 仅当归档评审确认需要长期保留取舍理由时，新增 `openspec/designs/adr/session-delete-lifecycle.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 API schema、数据 owner、状态机或接口语义。
