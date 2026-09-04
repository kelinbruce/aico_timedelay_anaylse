## 背景与问题（Why）

当前会话列表只支持创建、列出、打开、重命名和搜索会话。用户在电信网络诊断、割接排障或客户系统集成验证过程中会产生大量临时会话、误建会话或已完成的低价值会话；如果列表不能删除这些会话，历史入口会持续堆积噪声，影响运维人员定位有效诊断上下文，也会让本地持久化数据长期保留不再需要的用户可见历史。

删除会话属于会话生命周期控制能力，必须在 OpenSpec 中先定义安全边界、运行中请求处理、持久化语义和前端列表行为。该能力不能由前端隐藏列表项替代，也不能绕过 runtime/session owner+agent scope 校验直接操作 gateway-local 表。

## 变更范围（What Changes）

- 新增受控会话删除能力：用户可从会话列表项发起删除，并通过 Web API 删除当前 owner scope 和 Agent scope 下的指定会话。
- 新增 `DELETE /api/v1/sessions/:id` Web API，由 `agent-channel-web` 只负责 schema validation、identity 注入和 DTO 投影，业务语义委托给 runtime-facing session port。
- 扩展 runtime/session contract，新增删除会话命令；命令必须携带 trusted `IdentityContext`、runtime resolved `agentId` 和 `sessionId`，不得接受客户端提供 owner 或 agent 字段。
- 定义删除语义为物理删除当前会话及其主路径会话事实：session、visible/hidden messages、active context、timeline、request runs、checkpoint 以及会话关联的 annotation/share/favorite 等会话从属 read model 或索引事实。删除必须由 gateway-local 在单一事务内完成。
- 删除请求遇到非 terminal active/in-flight run 时必须失败关闭，返回 safe conflict outcome；本 change 不新增“删除并取消运行中请求”能力。
- 前端会话列表、搜索 dialog 和 collaborative PIU History Popover 复用原列表项动作入口提供删除交互；删除成功后刷新当前列表窗口，并在被删除会话为当前打开会话时进入安全的未选中或新会话状态。
- 不改变 request submit、cancel、retry、terminal commit、stream replay、history consistency、session search 查询语义或长期记忆清理策略。
- 不新增批量删除、恢复、回收站、软删除保留态、跨用户管理删除或审计检索 API。

## Capability 影响（Capabilities）

### 新增 Capability
- `session-delete`: 定义会话删除的 Web/API、runtime/session、gateway-local 持久化、安全隔离、运行中请求防护和前端列表交互边界。

### 修改的 Capability
- `session-history-search`: 搜索态和普通会话列表项需要复用同一个删除动作入口；搜索过滤语义不变。
- `conversation-annotation`: 会话删除需要清理会话从属 annotation 事实或保证删除后不可被会话列表/详情路径访问。
- `conversation-share`: 会话删除需要清理创建者 scope 下的会话分享事实或保证删除后 share 不再暴露已删除会话内容。
- `ts-minimal-agent-kernel`: RuntimeSessionPort 和会话主路径持久化边界新增删除命令，但不改变 submit/terminal/history 主流程。

## 影响范围（Impact）

- Web API：新增 `DELETE /api/v1/sessions/:id` route、请求校验、safe error/conflict/not-found 投影和前端 service 调用。
- Contract：扩展 `agent-contracts/runtime`、`agent-contracts/session` 和必要的 gateway contract，保持 DO/DTO/Record 边界清晰。
- Runtime/session：runtime 解析 trusted Agent scope 后委托 `agent-session`；`agent-session` 拥有会话删除领域语义和 active run 防护。
- Gateway-local：新增 owner+agent scoped composite delete，一次事务删除或清理会话主路径及从属事实，禁止 JS 层跨 scope 拉取后过滤。
- Frontend：Sidebar、search dialog、PIU History Popover 的会话行动作增加删除入口、确认交互、loading/error 状态、删除后刷新与当前会话安全导航。
- 测试：新增 Web route/schema、runtime/session contract、gateway-local 事务/隔离/active run negative case、前端列表删除交互和 OpenSpec strict validation。
- 运维/数据：删除是用户主动发起的数据移除动作；本 change 不定义后台保留策略、审计导出或恢复能力。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- openspec/specs/session-delete/spec.md：新增会话删除 capability 的稳定行为契约。
- openspec/specs/session-history-search/spec.md：提炼列表项动作复用和删除后搜索窗口刷新行为；搜索匹配、排序、分页和过滤语义保持不变。
- openspec/specs/conversation-annotation/spec.md：提炼会话删除后的 annotation 从属清理或不可达语义。
- openspec/specs/conversation-share/spec.md：提炼会话删除后的 share 清理或不可达语义。
- openspec/specs/ts-minimal-agent-kernel/spec.md：提炼 RuntimeSessionPort 删除命令和主路径 scope/persistence 边界。

长期背景：
- openspec/overview.md：补充会话生命周期治理目标，说明用户主动删除用于降低会话列表噪声和本地历史保留压力。

设计视图：
- openspec/designs/architecture/web-channel-api-surface.md：新增 `DELETE /api/v1/sessions/:id` API surface 和 port 依赖。
- openspec/designs/architecture/runtime-boundaries.md：补充 runtime-facing session delete 命令的 owner+agent scope、active run 防护和非 terminal run 冲突语义。
- openspec/designs/architecture/core-contracts.md：补充 RuntimeSessionPort/UserSessionPort/gateway composite delete contract。
- openspec/designs/modules/agent-channel-web.md：补充删除 route 的职责和非职责。
- openspec/designs/modules/agent-runtime.md：补充 runtime session facade 的 Agent scope 解析和委托责任。
- openspec/designs/modules/agent-session.md：补充会话删除领域语义。
- openspec/designs/modules/agent-platform-gateway-local.md：补充单事务 composite delete 和表 ownership。
- openspec/designs/adr/session-delete-lifecycle.md：如归档时仍需要保留“物理删除、无回收站、active run conflict”的取舍理由，则新增 ADR；否则无。
- openspec/designs/spec-to-design-map.md：新增 `session-delete` 到 Web API、runtime/session、gateway-local 和前端验证入口的导航。

验证入口：
- `openspec validate add-ts-session-delete --strict`
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
