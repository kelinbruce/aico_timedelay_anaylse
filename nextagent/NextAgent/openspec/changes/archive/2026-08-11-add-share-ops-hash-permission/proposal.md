## 背景与问题（Why）

对话分享能力（`openspec/specs/conversation-share/spec.md`）的 `allowedOps` 权限白名单当前以完整 ops 字符串数组形式在创建分享 API body 和查看分享 `X-Viewer-Ops` header 中传输，并完整持久化到 `ConversationShareRecord.allowedOps`。远端（immersive）模式下的后台存储接口对数组传入有 200 元素的安全强约束，而电信管理员用户通常拥有约 400 个 ops，完整数组无法通过该接口传入/存储，导致带权限分享创建失败或查看失败。

此前 commit `f757b03f` 将 `allowedOps` 的 schema `maxItems` 从 100 提升到 1000 并设置了 512KB `maxHeaderSize`，缓解了 schema 校验和 HTTP header size 限制，但未解决远端后台存储接口本身的 200 元素数组传入约束。

## 变更范围（What Changes）

- `allowedOps` 不再传输或存储完整 ops 数组。前端在 `shareService.ts` 中对 ops 数组执行确定性变换：去重 + 字典序排序 + `JSON.stringify` + SHA-256，取 hex 摘要。变换后 `allowedOps` 始终为长度 1 的 string 数组 `[hash]` 或 `null`（公开分享）。
- 创建分享 API body 的 `allowedOps` 和查看分享 `X-Viewer-Ops` header 均只携带 `[hash]`（长度 1），绕过远端后台存储接口的 200 元素数组约束。
- 后端 `ConversationShareRecord.allowedOps` 持久化 `[hash]`（长度 1）或 `null`，不再存储完整 ops 明文。
- 权限校验语义从子集判断（`allowedOps ⊆ viewerOps`）变为 hash 相等判断（`storedHash === viewerHash`）：只有 ops 集合完全相同的用户才能查看带权限的分享。在电信运维场景中，ops 按角色分配，同角色用户 ops 相同、不同角色 ops 不同，完全相等判断满足"同角色可查看"的业务需求。
- 后端 `ConversationShareService.isOpsSubset` 替换为 hash 字符串比对，不再执行子集计算。后端不感知 hash 算法细节，只做存储和字符串相等比对。
- 前端 `ShareSettingsModal` 和 `SharedConversationPage` 不直接调用 hash 函数；hash 变换集中在 `shareService.ts` 的 `createShare` 和 `loadSharedConversation` 内部完成，对调用方透明。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `conversation-share`: `allowedOps` 存储语义从完整 ops 数组变为 ops hash；权限校验从子集判断变为 hash 相等判断；`X-Viewer-Ops` header 从完整 ops 数组变为 ops hash 数组；前端 hash 变换规则。

## 影响范围（Impact）

- 代码：`frontend/agent-web`（`shareService.ts` 新增 `hashOps` 函数及调用）、`packages/agent-session`（`conversation-share-service.ts` 权限校验逻辑）。
- API：`POST /api/v1/sessions/:sessionId/shares` body 的 `allowedOps` 从完整 ops 数组变为 `[hash]`；`GET /api/v1/shares/:shareId/conversation` 的 `X-Viewer-Ops` header 从完整 ops 数组变为 `[hash]`。schema `maxItems` 不需修改（1000 已足够容纳长度 1 的数组）。
- 测试：`agent-session` unit test（hash 比对逻辑）、`agent-channel-web` route test（hash 透传）、`frontend/agent-web` shareService test（hash 变换）、e2e share test（创建者和查看者使用相同 ops）。
- 兼容性：已有分享记录中 `allowedOps` 存储的是完整 ops 明文数组，在新的 hash 相等校验下自然不匹配（除非 ops 数组恰好只有 1 个元素且值等于 hash），将返回 `SHARE_FORBIDDEN`。分享是临时性的（24h/7d/30d），旧记录自然过期，不需要数据迁移。
- 配置/运维：无新增配置。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/conversation-share/spec.md`：合并 ops hash 权限语义变更（`allowedOps` 定义、权限校验语义、`X-Viewer-Ops` 定义、hash 变换规则）。

**长期背景：**
- `openspec/overview.md`：在分享能力描述中补充"ops 以 SHA-256 hash 形式存储和校验"一句。

**设计视图：**
- `openspec/designs/modules/agent-session.md`：补充分享权限 hash 比对语义。
- `openspec/designs/modules/frontend-agent-web.md`：补充 `shareService` hash 变换职责。
- `openspec/designs/spec-to-design-map.md`：无（conversation-share 导航已存在）。

**验证入口：**
- `agent-session` unit test：hash 比对通过/失败、null viewerOps 拒绝、空 viewerOps 拒绝。
- `agent-channel-web` route test：hash 数组透传、长度 1。
- `frontend/agent-web` test：`hashOps` 确定性、去重+排序、createShare/loadSharedConversation 传 hash。
- e2e share test：同 ops 创建+查看通过、不同 ops 拒绝。
