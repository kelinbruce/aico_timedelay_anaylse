## 背景与问题（Why）

当前稳定契约把 Web stream 统一描述为 RequestRun 执行流：SSE 与 WebSocket 通过 `RuntimeSessionPort.streamEvents(...)` 消费 canonical timeline 或 runtime status，并投影为共享的 `StreamEnvelope`。该约束保护 request lifecycle、timeline sequence、replay 和 terminal delivery 不被 channel 私有语义取代。

`add-ts-cross-session-activity-awareness` 需要另一种观察范围：浏览器按可信 Owner Scope + Agent Scope 订阅多个 session 的当前注意力状态。该状态从 durable session、run 与 pending-input facts 重新派生，使用完整 snapshot 加 session-keyed delta 收敛；它不属于某个 RequestRun 的执行历史，也没有 timeline sequence 或 replay 语义。

如果不先区分这两类流，Activity SSE/WebSocket 要么违反当前“Web stream 必须使用 `StreamEnvelope`”的冻结规则，要么被错误塞入 canonical timeline，导致派生注意力状态与执行事实混为一体。因此需要先收窄稳定 Stream 契约的适用范围，并为 Session Activity 定义唯一的窄化例外。

## 术语

- **Request Execution Stream**：面向一个 session、request 或 run 的用户可见执行流。它通过 `RuntimeSessionPort.streamEvents(...)` 消费 canonical timeline 或 runtime status，并使用 `StreamEnvelope`、`StreamEventType` 与 session-scoped sequence。
- **Session Activity Projection Stream**：面向一个可信 Owner Scope + Agent Scope 的派生会话活动流。它只投影各 session 当前需要用户注意的状态，不属于 canonical timeline，不使用 `StreamEnvelope`、timeline sequence 或 execution replay，也不驱动 request lifecycle。

## 规范上下文

- 本 refinement 只授权 `add-ts-cross-session-activity-awareness` 定义的 Session Activity Projection Stream，不建立任意模块新增私有 Web stream 的通用扩展点。
- Session Activity 只属于浏览器 ER surface；IR surface 不获得该例外。
- `SSE` 与 `WebSocket` 仍是等价 transport，transport 选择不得改变同一类流的 payload、scope、失败或恢复语义。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 冻结 Request Execution Stream 继续使用 `StreamEnvelope`、canonical timeline/runtime status 与 `RuntimeSessionPort.streamEvents(...)`。
- 明确 Session Activity Projection Stream 是 scope-level derived projection，而不是 Request Execution Stream、timeline event 或 runtime status。
- 允许 Session Activity 使用自身严格判别联合和 snapshot-to-live 协议，同时禁止它拥有 request lifecycle、terminal truth、timeline replay 或 execution progress。
- 保持 SSE 与 WebSocket 在 Request Execution Stream 内部等价，并在 Session Activity Projection Stream 内部等价；不得跨两类流错误复用 payload 或 resume 契约。
- 为 `add-ts-cross-session-activity-awareness` 提供可审查、可测试且不泛化的前置契约。

**非目标：**

- 不在本 refinement 中新增 Activity endpoint、Activity DTO、`SessionActivityPort`、`RuntimeSessionActivityPort`、service、store 或浏览器交互。
- 不修改现有 `StreamEnvelope`、`StreamEventType`、timeline sequence、session detail stream、resume 或 terminal delivery 语义。
- 不允许 channel 或其他业务模块自行定义新的 scope-level stream family。
- 不把 Session Activity 写入 canonical timeline、checkpoint、message、audit、memory 或持久化 activity table。
- 不修改 Runtime request lifecycle、scheduler、same-session lane、pending input 或 terminal commit owner。

## 变更范围（What Changes）

- **修改** `ts-core-contracts` 的 canonical timeline 与 stream projection requirement：将 `StreamEnvelope`、`StreamEventType` 和 `RuntimeSessionPort.streamEvents(...)` 的强制适用范围明确为 Request Execution Stream，并为 Session Activity Projection Stream增加唯一窄化例外。
- **修改** `ts-web-sse-ws-transports` 的等价 Web transport requirement：要求 SSE 与 WebSocket 在各自所属流类型内保持等价；Session Activity 不得复用 Request Execution Stream 的 envelope、timeline sequence 或 resume cursor，也不得影响其连接和恢复行为。
- **移除**无。

本 refinement 不改变现有公共 TypeScript 或 wire shape，不构成 breaking API change。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-1.1 查看会话消息流` → canonical spec `ts-web-sse-ws-transports`
  - 功能边界：修改 `等价 Web Stream Transport`，使 SSE 与 WebSocket 的等价性在 Request Execution Stream 和唯一授权的 Session Activity Projection Stream 内分别成立；两类流的 payload、scope、恢复和失败互相隔离，未知第三类私有 stream 不获得例外。
  - 系统质量属性：安全（ER-only 与可信 scope）、可靠性/恢复（两类连接失败隔离）、可测试性（正向等价、并存和禁止第三类流的负向契约）。
  - 映射说明：canonical spec 为 `ts-web-sse-ws-transports`；`ts-core-contracts` 的 legacy `Canonical Timeline And Stream Projection` Requirement 作为来源整体 REMOVED。其执行流黑盒行为由本 change 的主规格承载，未变化的 canonical timeline 事实语义继续由 `ts-run-status-visibility` 承载，TypeScript facade 与 owner 细节迁入 design，不增加多对多映射。

## 影响范围（Impact）

- OpenSpec：新增两个稳定 capability 的 delta requirement，并成为 `add-ts-cross-session-activity-awareness` 的前置依赖。
- 架构设计：影响 `ts-backend-architecture.md`、`core-contracts.md` 与 `web-stream-transports.md` 对 Web stream family 的长期说明。
- 模块边界：确认 `agent-runtime` 与既有 `RuntimeSessionPort` 只拥有 Request Execution Stream；Session Activity 的 domain owner、runtime-facing facade 与 Web DTO 仍由后续实现 change 定义。
- 测试：后续实现 change 必须通过 architecture/contract negative test 证明 Activity 不进入 `StreamEnvelope`、`RuntimeSessionPort.streamEvents(...)` 或 IR route。
- 运维：无部署、配置、数据库或迁移影响。


## 需群内确认

已确认（2026-07-28，当前会话用户同意按本方案开始修改）：

- `StreamEnvelope`、`StreamEventType` 与 `RuntimeSessionPort.streamEvents(...)` 的冻结约束只适用于 Request Execution Stream。
- 只为 `add-ts-cross-session-activity-awareness` 授权一个 Session Activity Projection Stream 窄化例外，且不形成任意模块可扩展的通用私有 stream 机制。
- 本 refinement 不修改任何 `agent-contracts` TypeScript 类型；后续 Activity 类型与 port 仍由 `add-ts-cross-session-activity-awareness` 中已确认的 additive contract delta 承担。
