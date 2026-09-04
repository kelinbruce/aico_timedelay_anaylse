## 背景和现状（Context）

`establish-ts-core-contracts` 已冻结 `SessionRecord`（`agent-contracts/src/gateway/index.ts:154-161`，含 `tenantId`、`subjectId`、`agentId`、`sessionId`、`title?: string`、`createdAt`、`updatedAt`）、`SessionStoreGateway`（loadSession/listSessions/saveSession）和 `SessionMessageStoreGateway`。`add-ts-local-session-store` 已实现 session 与 message 的本地持久化（`SqliteGatewayStores`）。

当前 `SessionRecord.title` 在会话创建时为空，`SessionHistoryEntry.displayTitle` 取空值或默认占位符，导致用户无法在多会话历史列表中区分不同会话。`agent-session` 作为会话领域语义 owner（Owner 5），负责定义从会话内容中自动生成可读标题的行为。

当前基线缺口：
- `SessionRecord` 缺少 `titleSource?: "automatic" | "manual"` 字段——没有区分自动/手动标题的机制
- 当前代码库不存在 runtime→session 的跨模块事件通知机制。Runtime 通过 `RuntimeEventStreamPort.stream()` 向 channel 暴露 timeline 事件流，但 `agent-session` 没有订阅能力
- `agent-session` 的 `UserSessionService` 没有任何 title 相关方法

相关方：Owner 5 Session（主 owner）、Owner 2 Runtime（terminal 事件源）、Owner 6 Local Gateway（`saveSession` 持久化 `titleSource`）、Owner 11 Governance（redaction、audit）、Owner 1 Channel（历史列表展示消费 displayTitle）。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 会话首个用户请求终端提交后，异步从首条用户消息中确定性提取 4-40 字符标题
- 标题持久化到 `SessionRecord.title`，`titleSource` 设为 `"automatic"`
- `SessionRecord` 新增 `titleSource` 字段，精确标记标题来源
- 提取过程使用确定性规则，不调用模型 provider
- 成功时写入 `session.title.generated` audit event；失败时静默降级，不阻塞终端提交

**非目标：**
- 不实现模型驱动的标题生成
- 不实现标题重新生成或恢复为自动标题
- 不实现用户手动修改标题（由 `add-ts-session-title-update` 承接）
- 不在启动时或后台定时批量生成标题

## 设计决策（Decisions）

### D1：触发机制 — Runtime terminal commit 后自行提取标题，调用 `updateTitle`

Runtime 在 terminal commit 成功后，使用已有的 `firstUserText` 和 `isFirstRequest` 信息，自行调用确定性提取管线，然后通过 `UserSessionPort.updateTitle` 持久化标题（`titleSource="automatic"`）。fire-and-forget，不阻塞 terminal commit。

Runtime 内部流程（terminal commit 路径中）：
```ts
// agent-runtime
await this.terminalCommit(...);

if (isFirstRequest && firstUserText) {
  const title = extractTitle(firstUserText);   // 纯函数，runtime 内部
  if (title.length >= 4) {
    void this.sessionPort.updateTitle({
      identityContext, agentId, sessionId, title,
      titleSource: "automatic",
      idempotencyKey: `title-gen-${sessionId}`
    });
  }
}
// 不 await，继续发布 terminal stream event
```

**agent-session 不变**——`updateTitle` 是已有的统一方法（见 `add-ts-session-title-update`），接收 `titleSource` 参数。Runtime 传 `"automatic"`，用户端点传 `"manual"`。agent-session 内部逻辑：redaction → loadSession 检查 titleSource=manual 则跳过 → saveSession → audit。

选取理由：
- agent-session 不包含任何标题提取逻辑，只负责持久化
- Runtime 已有 firstUserText 和 isFirstRequest，不增加额外查询
- 和手动修改走同一条 `updateTitle` 路径，消除冗余方法
- 纯函数的 extractTitle 放在 runtime 内部，可独立单元测试

放弃方案：
- agent-session 内部含提取逻辑 → 违反单一职责（session 不应知道"如何从文本提取标题"）
- 后台定时任务 / event bus → 过度设计

### D2：生成策略 — 三级确定性规则管线（Runtime 内部）

`extractTitle(text: string): string` 是 runtime 内部的纯函数。输入长度决定分支：
- 短输入（< 30 字符）：直接使用
- 中长输入（30–100 字符）：启发式提取（去礼貌前缀 / 取首句）
- 长输入（> 100 字符）：取首句、最多前 100 字符

所有步骤纯同步、无模型调用、无 IO。结果规范化到 4-40 字符。

选取理由：KISS 原则；不引入模型调用延迟和成本；确定性输出便于测试和审计。

放弃方案：
- 模型驱动生成 → 引入模型延迟、成本、provider 依赖，超出首版 KISS 范围
- 全截断 40 字符 → 长问句中包含的关键术语可能被截断

### D3：覆盖保护 — titleSource 字段

`SessionRecord` 扩展 `titleSource?: "automatic" | "manual"` 字段。自动生成前检查：若 `titleSource === "manual"` 则跳过；若 `title` 非空且 `titleSource` 不是 `"manual"`，也跳过（已有自动标题或 V1 兼容）。

类型定义：
```ts
// agent-contracts/gateway
export type SessionTitleSource = "automatic" | "manual";
```

选取理由：语义精确，无 corner case；为 `add-ts-session-title-update` 和 V2 标题重新生成预留扩展点；改动面仅 `SessionRecord` 一个可选字段。

### D4：agent-session 侧 — 复用 `updateTitle`

agent-session 的 `updateTitle`（定义在 `add-ts-session-title-update`）是统一的标题写入方法，接收 `titleSource` 参数。Runtime 调用时传 `"automatic"`，用户端点调用时传 `"manual"`。

agent-session 内部逻辑：
1. 若 `titleSource === "automatic"` → loadSession 检查当前 `titleSource`，若已是 `"manual"` 或 title 非空 → 跳过（不覆盖手动标题）
2. redaction policy 检查 → 拒绝则跳过
3. saveSession({ ...record, title, titleSource }) → 失败则跳过
4. 成功 → audit event（`session.title.generated` 或 `session.title.updated`）

选取理由：一条路径两种来源，消除冗余代码。

### D5：失败策略 — 全部静默

所有失败路径（消息不可读、session 不可读、生成候选太短、redaction 拒绝、gateway 不可用）统一处理：
- 输出结构化 `warn` 级别日志（含 `sessionId` + 失败原因码）
- 会话保留空标题
- 不抛出异常，不写入 audit event（失败不产生 audit event）

选取理由：标题生成是 UX 增强，不是请求终端提交的前置条件。宁可缺标题也不能拖垮主流程。

## 实现路径和依赖关系

### 阶段 1：契约补齐

| 序号 | 改动 | 文件 | 依赖 |
|------|------|------|------|
| 1.1 | `SessionRecord` 加 `titleSource?: SessionTitleSource` | `agent-contracts/src/gateway/index.ts` | 无 |
| 1.2 | `UpdateSessionTitleCommand` 加 `titleSource: SessionTitleSource` 字段（与 title-update 共享此 DTO） | `agent-contracts/src/session/index.ts` | 无 |

### 阶段 2：Runtime 标题提取

| 序号 | 改动 | 文件 | 依赖 |
|------|------|------|------|
| 2.1 | 实现 `extractTitle(text: string): string` 纯函数（三级管线） | `agent-runtime` 内部 | 无 |
| 2.2 | Runtime terminal commit 后调用 `extractTitle` + `sessionPort.updateTitle(...)` fire-and-forget | `agent-runtime` terminal commit 路径 | 2.1 |

### 阶段 3：agent-session 适配

| 序号 | 改动 | 文件 | 依赖 |
|------|------|------|------|
| 3.1 | `updateTitle` 中 `titleSource="automatic"` 分支：loadSession 检查已有 manual title → 跳过 | `agent-session` | 1.2 |
| 3.2 | audit event 区分 `session.title.generated`（automatic）和 `session.title.updated`（manual） | 同上 | 3.1 |

## 流程接入

标题生成接入 **请求主链路** 的末端：

```
Runtime.terminalCommit()
  │  terminal commit 成功
  │  Runtime 已知：firstUserText、isFirstRequest
  │
  ├─► isFirstRequest && firstUserText？
  │     │  title = extractTitle(firstUserText)   // Runtime 内部纯函数
  │     │  title.length >= 4？
  │     │
  │     └─► UserSessionPort.updateTitle({
  │           identityContext, agentId, sessionId,
  │           title, titleSource: "automatic",
  │           idempotencyKey: `title-gen-${sessionId}`
  │         })
  │           │  fire-and-forget（void，不 await）
  │           ▼
  │         agent-session (updateTitle)
  │           │
  │           │  titleSource="automatic"？
  │           │    → loadSession → titleSource 已是 "manual" 或 title 非空？→ 跳过
  │           │  redaction → 拒绝 → warn + 跳过
  │           │  saveSession({ ...record, title, titleSource: "automatic" })
  │           │    → gateway 失败 → warn + 跳过
  │           │  audit event（session.title.generated）
  │
  └─► 继续 terminal commit 后续流程（不等待 updateTitle）

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | title 经 redaction policy 检查后方可持久化；拒绝携带 secret/path/token 模式的标题；audit event 不包含首条消息原文 | redaction contract test、secret-scan |
| 性能/容量 | 纯内存字符串操作 + 1 次 gateway 调用（loadSession 查 titleSource）+ 1 次 saveSession；fire-and-forget 不占用终端提交路径资源 | 单元测试中验证执行时间 |
| 可靠性/恢复 | fire-and-forget + read-before-write + idempotencyKey；gateway 不可用时日志记录并跳过；不产生孤儿数据 | 失败场景 characterization test |
| 可维护性 | 规则管线固定三步；新增语言只需追加前缀表；titleSource 语义独立于 title 内容 | 架构边界检查、代码 review |
| 可测试性 | 确定性规则可纯函数单元测试；整个管线可通过 fake gateway 隔离测试；redaction 可通过 policy fixture 注入 | unit test + integration test |
| 审计/可追溯性 | `session.title.generated` audit event（含 sessionId、tenantId、subjectId、agentId、requestRunId 和安全摘要）；失败不产生 audit event；结构化 warn 日志补充失败诊断 | audit event contract test、log assertion test |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/session-title-generation/spec.md`
- 核心契约：`openspec/specs/ts-core-contracts/spec.md`（`SessionRecord.titleSource` 字段）
- 跨模块架构：`openspec/designs/architecture/runtime-boundaries.md`（Runtime terminal commit 后回调 Session domain）
- 领域模型：`openspec/designs/architecture/core-contracts.md`（`SessionRecord.titleSource` 字段语义和生命周期）
- 模块职责：`openspec/designs/modules/agent-session.md`（`generateTitle` 和标题提取管线）
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 确定性规则生成的标题可能不如 LLM 生成的自然 → 规则管线可独立升级，后续 change 可叠加 LLM 路径，不影响现有确定性路径
- [风险] 电信运维场景中用户首条消息可能是很长的网络拓扑描述 → 长输入分支取首句截断，在 40 字符约束下已是最优策略
- [风险] `onRequestTerminal` 在 `UserSessionPort` 上新增方法——虽然不破坏现有实现（TypeScript interface 扩展），但所有 `UserSessionPort` 实现者（当前仅 `UserSessionService`）都需要实现。当前只有一个实现者，风险可控
- [取舍] `UserSessionPort.onRequestTerminal` 的 void 返回意味着 title generation 的所有失败都只能通过日志感知 → 接受：这是 UX 增强功能，不应有任何失败传播到主链路
- [取舍] 在 `SessionRecord` 上扩展 `titleSource` 而非创建独立表 → 字段语义干净，代价是 titleSource 与 title 绑定在同一个持久化记录中。当前无独立并发写入需求

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `SessionRecord.titleSource` 类型定义 | T1 | contract schema test |
| `UserSessionPort.onRequestTerminal` 签名 | T2 | contract schema test |
| 提取管线：短/中/长三级分支 | T3 | extractTitle pure function unit test |
| titleSource 写入 "automatic" | T4 | integration test |
| 已有 title 时跳过 | T5 | integration test |
| titleSource=manual 时永不覆盖 | T6 | integration test |
| redaction 拒绝时跳过 | T7 | integration test + redaction fixture |
| Gateway 不可用时静默 | T8 | integration test + fake gateway |
| Audit event 写入 | T9 | audit contract test |
| Runtime terminal commit 后触发 | T10 | characterization test |
| 并发幂等（idempotencyKey 防重） | T11 | concurrent test |
| 不阻塞 terminal commit | T12 | timing assertion test |
