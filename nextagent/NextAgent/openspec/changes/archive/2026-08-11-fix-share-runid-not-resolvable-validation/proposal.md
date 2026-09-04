## Why

创建对话分享接口 `POST /api/v1/sessions/:sessionId/shares` 在请求体的 `runIds` 指向不存在或不可读的 run 时仍然返回 `200` + `shareUrl`，提示分享生成成功。但使用返回的 `shareId` 调用查看接口 `GET /api/v1/shares/:shareId/conversation` 时，系统因找不到对应 run 的可读 messages 而返回 `SHARE_CONTENT_DELETED`，即产生了一个"创建成功却无法查看"的死链。

根因在于 `ConversationShareService.createShare` 只把 `runIds` 冻结进持久化记录并立即返回分享链接，未在落库前校验每个 `runId` 是否能 resolve 为一个完整问答对。路由层也只验证 session 存在，不校验 run 存在性。这破坏了"能创建就能读"的语义一致性，并误导用户认为分享已成功。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 创建分享在持久化前校验每个 `runId` 都能 resolve 出完整问答对（canonical USER 问题 + final assistant answer）；任一不可 resolve 时返回显式 `SafeError { code: "SHARE_RUN_NOT_RESOLVABLE", category: NOT_FOUND }`，对应 HTTP `404`，且 MUST NOT 落库、MUST NOT 返回 `shareUrl`。
- 校验逻辑复用 `loadSharedConversation` 已有的 resolve 路径，保证"创建时可 resolve"与"查看时可读"判定一致。
- fork 生成的 copied run anchor（无 `RequestRunRecord` 但有可读 messages 且能唯一补齐 canonical USER 与 assistant answer）MUST 通过校验，不被误杀。

**非目标：**

- 不改变 `CreateShareCommand` 公共契约、`ShareResult` DTO、`ConversationShareRecord` 持久化结构或 `ConversationShareStoreGateway` port。
- 不改变路由层 transport/projection 职责；校验只在 service 层执行，`agent-channel-web` 不直接做 run 存在性校验。
- 不改变 `loadSharedConversation` 的查看期 fail-closed 安全投影行为（tool-use 不当 answer、unknown hidden reason 等仍按既有规则 fail closed）。
- 不改变 retry / edit replacement、freeze snapshot、ops 权限校验、过期校验或 session 删除级联清理语义。
- 不引入新的 gateway port、不扩大到跨 session / parent / ancestor 回源读取。

## What Changes

- `ConversationShareService.createShare` 在 `shareStore.createShare` 之前增加 runId 可 resolve 校验：拉取 session 全量 readable messages，对每个 `runId` 复用与 `loadSharedConversation` 相同的 resolve 逻辑判定能否形成完整问答对，任一失败即 throw `AgentError(SHARE_RUN_NOT_RESOLVABLE, NOT_FOUND)`。
- 将 `loadSharedConversation` 中"拉取 readable messages"与"单个 run resolve 为问答对"两段逻辑提取为私有方法 `loadReadableMessages` 与 `resolveShareUnit`，供创建校验与查看投影共用，消除重复实现。

本 change 不包含破坏性公共契约变更。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.14 创建分享链接` → `specs/conversation-share/spec.md`
  - 功能边界：补充创建分享前的 runId 可 resolve 校验，确保只有能 resolve 出完整问答对的 runId 才能创建分享，避免生成死链。
  - 系统质量属性：可靠性、可维护性、可测试性。
  - 映射说明：`conversation-share` 是 canonical spec；本 change 不触及其他 spec。

## 影响范围（Impact）

- 最终用户：传入不存在或不完整的 `runIds` 创建分享时，立即得到 `404 SHARE_RUN_NOT_RESOLVABLE`，不再收到误导性的成功链接。
- Agent 开发者与平台集成方：无需修改公共 API、请求/响应 schema、Gateway 或 contract；`CreateShareCommand` 字段不变。
- 运维人员：失败路径产生显式 `SafeError` 和 structured log，不暴露 raw 异常或对话内容；既有分享记录的查看行为不受影响。
- 主要受影响范围为 `ConversationShareService` 的创建路径及其与查看路径共享的 resolve 逻辑。
