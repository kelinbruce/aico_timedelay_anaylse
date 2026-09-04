## 背景与问题（Why）

NextAgent TS 后端通过 `add-ts-session-title-generation` 提供了自动从首条用户消息提取会话标题的能力。但用户需要手动修改标题以更准确描述会话内容（例如将自动生成的"基站告警查询"改为"XX片区基站2026-06-10告警分析"）。

当前基线：
- `SessionRecord` 已有 `title?: string` 字段
- `add-ts-session-title-generation` 引入了 `titleSource?: "automatic" | "manual"` 字段和 `UserSessionPort.updateTitle`（统一方法，通过 `titleSource` 参数区分来源）
- 当前 `agent-channel-web` route 白名单禁止 title routes
- `UserSessionPort` 无 `updateTitle` 方法

## 变更范围（What Changes）

### 契约层（agent-contracts/session）
- `UpdateSessionTitleCommand` 新增 `titleSource: SessionTitleSource` 字段（`"automatic" | "manual"`）
- `UserSessionPort` 新增 `updateTitle(command: UpdateSessionTitleCommand): Promise<UserSession>` 方法

### 领域层（agent-session）
- `UserSessionService` 实现 `updateTitle`：按 `titleSource` 分支——`"automatic"` 时先检查已有 manual title 则跳过，`"manual"` 时直接通过 → 长度校验（≤100 字符）→ redaction → requireSession → saveSession → audit
- 用户端点传 `titleSource="manual"`；Runtime 自动生成传 `titleSource="automatic"`（见 `add-ts-session-title-generation`）

### Web 入口（agent-channel-web）
- 新增 `PUT /api/v1/sessions/{sessionId}/title` endpoint
- 注入可信 IdentityContext（由 channel/auth-local 提供）

### 审计
- 修改成功写入 `session.title.updated` audit event

### 最小内核约束放开
- `ts-minimal-agent-kernel` spec 提 MODIFIED requirement，route 白名单新增 title update route

**不在范围：**
- 标题删除后恢复自动标题
- 批量标题修改
- 标题历史版本

## Capability 影响（Capabilities）

### 新增 Capability

- `session-title-update`：会话 owner 手动修改会话标题，titleSource 设为 "manual" 后永久阻止自动生成覆盖；无历史版本。

### 修改的 Capability

- `ts-minimal-agent-kernel`：route 白名单新增 `PUT /api/v1/sessions/{sessionId}/title`

## 影响范围（Impact）

| Package | 改动 | Owner |
|---|---|---|
| `agent-contracts/session` | 新增 `UpdateSessionTitleCommand`；`UserSessionPort.updateTitle` | Owner 5 |
| `agent-session` | `UserSessionService.updateTitle` 实现 | Owner 5 |
| `agent-channel-web` | `PUT /api/v1/sessions/{sessionId}/title` route | Owner 1 |
| `agent-observability` | title redaction；`session.title.updated` audit event | Owner 11 |

## 前置依赖

本 change 依赖 `add-ts-session-title-generation` 的以下交付物：
1. `SessionRecord.titleSource` 字段（`agent-contracts/gateway`）
2. `UserSessionPort.updateTitle` 方法——本 change 的 `titleSource="manual"` 语义需要被 title-generation 的自动生成分支正确识别并跳过

实施顺序上，title-generation 和 title-update 的契约层可并行交付，但领域行为必须在 title-generation 的契约就绪后实施。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/session-title-update/spec.md`：新增标题修改行为契约
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：MODIFIED route 白名单

长期背景：
- `openspec/overview.md`：补充手动标题修改对多会话并行使用的意义

设计视图：
- `openspec/designs/architecture/core-contracts.md`：补充 `SessionRecord.titleSource` 字段语义和 `titleSource="manual"` 单向语义
- `openspec/designs/modules/agent-session.md`：补充 `updateTitle` 模块职责
- `openspec/designs/spec-to-design-map.md`：新增 `session-title-update` 导航
