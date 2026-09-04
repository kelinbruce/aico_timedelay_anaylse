## 背景与问题（Why）

NextAgent TS 后端在多会话并行使用场景中（电信运维人员同时诊断多个基站告警、分析多个网络拓扑变更），用户依赖会话历史列表中的可读标题快速定位目标会话。当前 `SessionRecord` 已有 `title` 可选字段，`add-ts-local-session-store` 已实现 session 持久化读写，`establish-ts-core-contracts` 已冻结 `SessionStoreGateway` 和 `SessionMessageStoreGateway` 接口——但没有自动生成标题的逻辑。每个会话均以空标题或默认占位符显示在历史列表中，用户无法区分会话内容。

当前基线缺口：
- `SessionRecord` 缺少 `titleSource?: "automatic" | "manual"` 字段——无法区分自动/手动标题，无法实现"手动设置后永不覆盖"的语义
- 当前代码库不存在 runtime→session 的事件通知机制——Runtime 的 timeline event stream 仅暴露给 channel，不暴露给 session domain
- `agent-session` 的 `UserSessionService` 无任何 title 相关方法

标题自动生成是本地多会话使用的基础体验需求，必须在 session 领域层（`agent-session`）由 Owner 5 定义并实现，不依赖模型调用或外部服务。

## 变更范围（What Changes）

### 契约层
- `SessionRecord` 新增 `titleSource?: "automatic" | "manual"` 字段（`agent-contracts/gateway`）
- 新增 `SessionTitleSource` 类型（`"automatic" | "manual"`）
- `UpdateSessionTitleCommand` 新增 `titleSource: SessionTitleSource` 字段（与 `add-ts-session-title-update` 共享此 DTO）

### Runtime 层（agent-runtime）
- 实现 `extractTitle(text: string): string` 纯函数（三级规则管线：短/中/长）
- terminal commit 后调用 `extractTitle` + `sessionPort.updateTitle({ ..., titleSource: "automatic" })`，fire-and-forget

### 领域层（agent-session）
- `updateTitle` 中 `titleSource="automatic"` 分支：loadSession 检查已有 manual title → 跳过；否则 saveSession + audit
- 与 Owner 11 协作：标题经 redaction policy 检查

### Runtime 集成
- Runtime terminal commit 成功后调用 `extractTitle(firstUserText)` → `userSessionPort.updateTitle(...)`，fire-and-forget
- `agent-app` composition 确保 `UserSessionPort` 已注入 runtime（当前已注入）

### 审计
- 成功生成时写入 `session.title.generated` audit event
- 失败时静默降级，不写 audit event，仅输出 warn 日志

### 覆盖保护
- `titleSource === "manual"` 时跳过自动生成
- title 非空且 titleSource 不是 manual 时也跳过（已有自动标题）
- 非首个请求的 terminal commit 跳过（仅首次请求触发）

**不在范围：**
- 模型驱动的标题生成
- 标题重新生成或恢复自动标题
- 用户手动修改标题（由 `add-ts-session-title-update` 承接）
- 批量标题生成或后台维护任务

## Capability 影响（Capabilities）

### 新增 Capability

- `session-title-generation`：自动会话标题生成——首个用户请求终端完成后，从首条用户消息中确定性提取可读标题，持久化到会话记录；不阻塞终端提交，不调用模型。

### 修改的 Capability

- `ts-core-contracts`：`SessionRecord.titleSource` 字段、`UserSessionPort.onRequestTerminal` 方法

## 影响范围（Impact）

| Package | 改动 | Owner |
|---|---|---|
| `agent-contracts/gateway` | `SessionRecord.titleSource` 字段 + `SessionTitleSource` 类型 | Owner 5 |
| `agent-contracts/session` | `UpdateSessionTitleCommand.titleSource` 字段 | Owner 5 |
| `agent-runtime` | `extractTitle` 纯函数 + terminal commit 后调用 `updateTitle` | Owner 5（协作 Owner 2） |
| `agent-session` | `updateTitle` 中 `titleSource="automatic"` 分支逻辑 | Owner 5 |
| `agent-app` | composition 已注入 `UserSessionPort` 到 runtime（无需改动） | 无 |
| `agent-platform-gateway-local` | `saveSession` 自动保留 `titleSource` 字段（无需代码改动） | 无 |
| `agent-observability` | title redaction；`session.title.generated` audit event | Owner 11（协作） |

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/session-title-generation/spec.md`：新增自动标题生成行为契约
- `openspec/specs/ts-core-contracts/spec.md`：提升 `SessionRecord.titleSource`、`UserSessionPort.onRequestTerminal`

长期背景：
- `openspec/overview.md`：补充会话标题生成对多会话并行使用体验的意义

设计视图：
- `openspec/designs/architecture/core-contracts.md`：补充 `SessionRecord.titleSource` 字段语义和生命周期
- `openspec/designs/modules/agent-session.md`：补充 `onRequestTerminal` 和标题提取规则管线的模块职责
- `openspec/designs/architecture/runtime-boundaries.md`：补充 Runtime terminal commit 后回调 Session domain 的协作模式
- 暂无独立 ADR；选择确定性规则而非模型驱动的取舍记录在 change design 的 Decisions 章节
- `openspec/designs/spec-to-design-map.md`：新增 `session-title-generation` 导航

验证入口：
- `openspec/specs/session-title-generation/spec.md` 中的 scenario
- title generation contract tests
- redaction policy 与标题内容交互测试
- 失败 / 降级路径验证测试
