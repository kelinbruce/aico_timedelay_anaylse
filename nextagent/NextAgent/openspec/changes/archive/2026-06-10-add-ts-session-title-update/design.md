## 背景和现状（Context）

`add-ts-session-title-generation` 提供了自动从首条用户消息提取标题的能力。但用户应能手动修改会话标题（例如将自动生成的"基站告警查询"改为"XX片区基站2026-06-10告警分析"）。标题修改能力是会话管理的基本 UX 需求。

当前基线：
- `SessionRecord` 已有 `title?: string` 字段，`SessionStoreGateway.saveSession` 已支持读写
- `add-ts-session-title-generation`（本 change 的前置依赖）引入了 `titleSource?: "automatic" | "manual"` 字段，自动生成写 `"automatic"`，手动修改写 `"manual"`
- 当前 `agent-channel-web` route 白名单（`ts-minimal-agent-kernel` spec）明确禁止 title routes
- `UserSessionPort` 无 `updateTitle` 方法
- `agent-session` 无 title 修改行为

相关方：Owner 5 Session（主 owner）、Owner 1 Channel（Web entry）、Owner 6 Local Gateway（`saveSession` 持久化）、Owner 11 Governance（redaction、audit）。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 会话 owner 通过 Web Channel 手动修改会话标题（≤100 字符）
- 修改成功后 `SessionRecord.titleSource` 设为 `"manual"`，永久阻止自动生成覆盖
- 标题内容经过 redaction policy 检查
- 同步操作：Channel → Session 领域校验 → Gateway 持久化 → 返回结果
- 写入 `session.title.updated` audit event

**非目标：**
- 不实现标题删除或恢复为自动标题
- 不实现批量标题修改
- 不实现标题历史版本

## 设计决策（Decisions）

### D1：执行模型 — 同步校验 + 持久化

标题修改是用户发起的同步操作。校验顺序：长度校验 → 非空校验 → redaction → owner+agent scope 校验 → 持久化。

选取理由：标题修改是低频、轻量操作，同步语义简单且用户期待即时反馈。与 feedback 提交采用不同的校验策略（标题允许任意内容只要能过 redaction，不涉及 message/run 状态校验）。

### D2：覆盖保护 — titleSource = "manual"

修改标题时强制设置 `titleSource = "manual"`。此后 `add-ts-session-title-generation` 的 `generateTitle` 检测到 `titleSource === "manual"` 即跳过自动生成。

选取理由：与 title-generation 的 design D3 形成闭环。`"manual"` 是单向状态（一旦手动设置永不恢复为自动），符合电信运维场景中"用户明确命名后不应被系统覆盖"的预期。

### D3：标题长度限制 — ≤100 字符

手动标题最多 100 字符。这是用户可见的可读标题，100 字符足以表达会话主题，且防止滥用。

选取理由：自动生成标题限制 40 字符（确定性规则局限），手动标题放宽到 100 字符给用户更大自由度。两者上限差异不影响 displayTitle 投影逻辑——channel 始终从 `SessionRecord.title` 读取。

### D4：title 为空时 titleSource 行为

当用户将标题设为空字符串（清空标题），titleSource 保持 `"manual"`，title 字段可设为空或 undefined。此时 `add-ts-session-title-generation` 检测到 `titleSource === "manual"` 仍跳过自动生成。

选取理由：用户清空标题是显式行为，不应被系统覆盖。会话以空标题显示在历史列表中（channel 投影为默认占位符）。

### D5：无需新增 Gateway Port

标题修改复用已有的 `SessionStoreGateway.saveSession`，不需要新增 `updateTitle` 专用 port。`saveSession` 已支持幂等写入（`idempotentWrite`），可直接使用。

选取理由：KISS。标题修改本质是 `SessionRecord` 的部分字段更新，`saveSession` 已足够。

## 实现路径和依赖关系

### 前置依赖

| 依赖 | 提供者 | 说明 |
|------|------|------|
| `SessionRecord.titleSource` | `add-ts-session-title-generation`（阶段1） | 本 change 写入 `"manual"`；无此字段则无法阻止自动覆盖 |
| `UserSessionPort` 实例 | `agent-app` composition | 需要新增 `updateTitle` 方法 |

### 阶段 1：契约层

| 序号 | 改动 | 文件 | 依赖 |
|------|------|------|------|
| 1.1 | `UserSessionPort` 新增 `updateTitle(command: UpdateSessionTitleCommand): Promise<UserSession>` | `agent-contracts/src/session/index.ts` | `SessionRecord.titleSource` 已存在 |
| 1.2 | 新增 `UpdateSessionTitleCommand` DTO（`identityContext`、`agentId`、`sessionId`、`title`、`idempotencyKey`） | 同上 | 无 |

### 阶段 2：领域实现

| 序号 | 改动 | 文件 | 依赖 |
|------|------|------|------|
| 2.1 | `UserSessionService` 实现 `updateTitle`：长度校验 → 非空校验 → redaction → requireSession → saveSession → audit | `agent-session/src/services/session-preparation.ts` | 1.1, 1.2 |
| 2.2 | title 经 redaction policy 检查 | 同上 | Owner 11 |

### 阶段 3：Web 入口

| 序号 | 改动 | 文件 | 依赖 |
|------|------|------|------|
| 3.1 | `agent-channel-web` 新增 `PUT /api/v1/sessions/{sessionId}/title` endpoint | `agent-channel-web/src/routes/` | 2.1 |
| 3.2 | 提 MODIFIED requirement 放开 `ts-minimal-agent-kernel` route 白名单 | `openspec/specs/ts-minimal-agent-kernel/spec.md` | 3.1 |

## 流程接入

```
agent-channel-web
  │  PUT /api/v1/sessions/{sessionId}/title
  │  Body: { title: "XX片区告警分析" }
  │  注入可信 IdentityContext（由 channel/auth-local 提供）
  ▼
agent-session (updateTitle)
  │
  │  1. title 长度校验：≤100 字符？
  │     └─ 失败 → SafeError "title exceeds maximum length"
  │
  │  2. title 非空校验（可选：允许清空标题）
  │     └─ 空字符串 → 清空 title，titleSource 仍设为 "manual"
  │
  │  3. redaction policy 检查 title
  │     └─ 拒绝 → SafeError "title contains unsafe content"（不含 title 原文）
  │
  │  4. requireSession(sessionId) → owner+agent scope 校验
  │     └─ 不存在/owner不匹配/agent不匹配 → SafeError "session not found"
  │
  │  5. saveSession({ ...record, title, titleSource: "manual" })
  │     └─ gateway error → SafeError(UNAVAILABLE)
  │
  │  6. AuditEventWriter.write({ eventName: "session.title.updated", ... })
  │
  ▼
agent-platform-gateway-local (SqliteGatewayStores)
  │  saveSession 持久化 title + titleSource
```

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | title 经 redaction 检查；SafeError 不含 title 原文；owner+agent scope 校验 | redaction test、safe error test |
| 性能/容量 | 同步单次操作（2 次 gateway 调用：loadSession + saveSession）；title ≤100 字符 | 单元测试 |
| 可靠性/恢复 | `saveSession` 已支持 idempotentWrite；并发修改用 last-write-wins | idempotency test |
| 可维护性 | 校验集中 agent-session；复用 `saveSession` 不新增 port | 架构边界检查 |
| 可测试性 | 管线可 fake gateway 隔离测试；redaction 通过 policy fixture 注入 | unit + integration test |
| 审计/可追溯性 | `session.title.updated` audit event（含 old title 长度、new title 长度，不含原文） | audit contract test |

## 风险与取舍（Risks / Trade-offs）

- [风险] 用户将标题设为空字符串后无法恢复自动标题 → 接受：`titleSource="manual"` 是单向语义。未来可新增"恢复自动标题"功能（新增独立 change）
- [风险] 并发修改（两个客户端同时修改同一 session 标题）→ `saveSession` 用 last-write-wins 策略，与现有 session 更新语义一致
- [依赖] 本 change 的 `titleSource="manual"` 语义依赖 `add-ts-session-title-generation` 的 `titleSource` 字段已就绪 → 实施顺序上 title-generation 必须先于或与本 change 同步交付

## 文档承载决策

- 行为契约：`openspec/specs/session-title-update/spec.md`
- 领域模型：`openspec/designs/architecture/core-contracts.md`（`SessionRecord.titleSource` 字段语义和 `titleSource="manual"` 单向语义）
- 模块职责：`openspec/designs/modules/agent-session.md`（`updateTitle`）
- 导航：`openspec/designs/spec-to-design-map.md`
