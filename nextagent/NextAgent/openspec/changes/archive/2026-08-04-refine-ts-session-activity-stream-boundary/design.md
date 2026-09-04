# Design: refine-ts-session-activity-stream-boundary

## 设计范围

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| FN-1.1 查看会话消息流 | 冻结 Request Execution Stream，并为 cross-session activity 授权唯一、封闭的 Session Activity Projection Stream 例外 | `ts-core-contracts`（REMOVED legacy Requirement）、`ts-web-sse-ws-transports`（MODIFIED canonical Requirement） | 见下 |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 迁移结果 |
|---|---|---|
| `ts-core-contracts` / `Canonical Timeline And Stream Projection` | FN-1.1 / `ts-web-sse-ws-transports` | 来源 Requirement 整体 REMOVED；两类流分类、SSE/WS 等价和失败隔离由 MODIFIED `等价 Web Stream Transport` 承载；未变化的 owner-scope、timeline consumption、live-tail、optional cursor、resume 和 cleanup 语义已由 stable `Stream 输入前置条件`、`Timeline 消费和 Projection Service 复用`、`No-Cursor Session Stream Uses Live Tail`、`Optional Cursor Semantics Are Transport Equivalent` 等 Requirements 承载，不制造重复 delta；public contract 字段、facade 与 owner 细节留在本 design。 |
| 同一 legacy Requirement 的 `Timeline 记录 canonical 执行事实` 场景 | FN-2.4 / 既有 `ts-run-status-visibility` | 行为未变化，已由 stable `Run status visibility 的事实源` 和 `Status visibility 触发条件和前置条件` 覆盖，因此不制造重复 delta；来源 Requirement 仍整体移除。 |

迁移后不退役 `ts-core-contracts` spec；该 spec 的其他 Requirements 完全未触及并继续原位保留。

## FN-1.1 查看会话消息流

### 目标与规范依据

系统继续为单个会话、请求或 run 提供受 canonical facts 约束的 Request Execution Stream，同时只为 `cross-session-activity-awareness` 授权一个 scope-level Session Activity Projection Stream；SSE 与 WebSocket 在各自流类型内等价，两类连接互不驱动，未知第三类流必须先经过独立契约审查。

本 Function 的目标 Requirements：

- canonical spec：`ts-web-sse-ws-transports`
- MODIFIED：`等价 Web Stream Transport`
- legacy source：`ts-core-contracts` / `Canonical Timeline And Stream Projection`（REMOVED）

### 当前实现

- `openspec/specs/ts-core-contracts/spec.md` 的 `Canonical Timeline And Stream Projection` requirement 把用户可见 stream 统一绑定到 canonical timeline、runtime status、`StreamEnvelope`、session-scoped sequence 与 `RuntimeSessionPort.streamEvents(...)`。
- `openspec/specs/ts-web-sse-ws-transports/spec.md` 的 `等价 Web Stream Transport` requirement 只描述 RequestRun 执行流，要求 SSE 与 WebSocket 复用同一 `StreamEnvelope`、`StreamEventType` 和 projection service。
- `openspec/designs/architecture/ts-backend-architecture.md` 当前写明 SSE 与 WebSocket delivery 都只投影 runtime event stream；`openspec/designs/architecture/core-contracts.md` 也要求 Web/channel stream 通过 `RuntimeSessionPort.streamEvents(...)` 进入 runtime session-facing stream path。
- `packages/agent-channel-web` 当前只实现 Request Execution Stream。session SSE/WS 消费 `RuntimeSessionPort.streamEvents(...)` 并经共享 projection service 输出 `StreamEnvelope`；现有 contract 与 architecture tests 保护这条路径。
- 当前代码不存在 Session Activity message、scope-level activity stream、activity consume route 或相关 frontend controller。本 refinement 不修复代码 gap；它只冻结后续实现必须遵守的两类流边界。
- `add-ts-cross-session-activity-awareness` 已定义 Owner + Agent scope 的 snapshot/delta 需求，但在本 refinement 建立前，其独立 activity stream 与上述稳定契约存在语义冲突。

### GAP 分析

1. stable core 与 Web transport 文档把所有 Web stream 统一描述为 Request Execution Stream，无法容纳跨会话 scope projection。
2. 若直接复用 execution envelope、sequence 或 facade，会伪造 request/run 语义并让 derived activity 污染 canonical execution truth。
3. 若无封闭例外，channel 可能把本 change 误解为任意私有 stream 的扩展点。

### 修改方案

本 refinement 只改变稳定契约对“Web stream”的分类方式，不改变任何现有代码或公共类型。唯一设计是保留既有 Request Execution Stream 全部语义，并为 Session Activity Projection Stream 增加一个具名、封闭、不可泛化的例外。

#### 两类流的唯一边界

Request Execution Stream 继续由 runtime canonical timeline 和 runtime status 提供事实，通过 `RuntimeSessionPort.streamEvents(...)` 进入 channel，使用 `StreamEnvelope`、`StreamEventType`、session-scoped sequence、可选 resume cursor 和既有 terminal delivery 语义。当前代码、测试和 public wire shape全部保留。

Session Activity Projection Stream 只在 `cross-session-activity-awareness` capability 下成立。它按可信 Owner Scope + Agent Scope 投影多个 session 的当前派生活动，使用该 capability 定义的完整 snapshot 与 session-keyed delta。它不进入 `RuntimeSessionPort.streamEvents(...)`，不复用 `StreamEnvelope`，不携带 timeline sequence、request/run filter 或 execution resume cursor。

任何后续需求若需要第三种 Web stream family，必须先建立独立 OpenSpec contract refinement；不得把本例外解释为 channel 私有 stream 扩展机制。

#### 适用规则

判断一个 Web stream 属于哪一类时使用以下顺序：

1. 如果 payload 表达一个 session、request 或 run 的 canonical timeline/runtime status 投影，它属于 Request Execution Stream，必须遵守既有核心契约。
2. 如果 payload 精确属于 `cross-session-activity-awareness` 定义的 scope-level session activity snapshot/delta，它属于 Session Activity Projection Stream，必须遵守该 capability 的派生、scope、恢复和消费契约。
3. 其他用户可见 SSE/WS payload 不属于任何已授权流类型，不能新增 stream endpoint 或绕过 `StreamEnvelope`。

该分类由规范语义而不是 endpoint 路径、SSE/WS framing、模块名称或实现命名决定，避免通过改名逃逸核心契约。

#### Owner 与依赖边界

- `agent-runtime` 继续只拥有 Request Execution Stream 的 canonical timeline、status、sequence、replay 与 lifecycle。
- `agent-contracts/channel` 继续只拥有 Request Execution Stream 的 `StreamEventType` 与 `StreamEnvelope`；本 refinement 不修改其 TypeScript shape。
- `agent-session` 在后续实现 change 中拥有 Session Activity 派生语义；本 refinement 不新增 service 或 port。
- `agent-app` 在后续实现 change 中提供可信 Agent Scope facade；`agent-channel-web` 只拥有 Activity wire schema 和 SSE/WS framing。
- Request Execution Stream 与 Session Activity Projection Stream 可在同一浏览器 app instance 并存，但连接、payload、恢复状态和失败处理互相独立。

#### 失败路径

Request Execution Stream 继续按既有 timeline read、projection、serialization 和 resume failure 契约处理。Session Activity Projection Stream 的 bootstrap、snapshot、delta、serialization 或 protocol failure 由 `cross-session-activity-awareness` 定义；失败只能关闭或重建 activity connection，不能产生 execution terminal、清空 detail stream 或伪造 activity `NONE`。

如果实现把 Activity message 包装为 `StreamEnvelope`、通过 `RuntimeSessionPort.streamEvents(...)` 读取、加入 IR route，或让 Activity 失败改变 RequestRun/pending input/terminal commit，该实现违反本 refinement，architecture/contract test 必须失败。

#### 备选方案

- 在 `add-ts-cross-session-activity-awareness` 内同时修改冻结核心契约：OpenSpec 机制上可行，但会把 core contract owner 与 `agent-session` 纵向实现 owner 合并到一个 change，不符合冻结核心契约先独立 refinement 的治理规则，因此未采用。
- 把 Activity 包装为 `StreamEnvelope`：会为 scope-level snapshot/delta伪造 request/run、sequence 与 replay 语义，破坏 execution truth，因此未采用。
- 把所有 derived projection 泛化成新的通用 Web stream abstraction：当前只有 Session Activity 一个真实需求，会形成未被产品行为驱动的扩展点，因此未采用。

#### 质量属性影响

##### 安全

两类流继续分别执行可信 scope 和 safe projection。Session Activity 例外不允许客户端自报 Owner/Agent Scope，也不扩大 Request Execution Stream 对 raw timeline、prompt、model output、capability result、credential 或路径的暴露范围。验证重点是跨 scope 和 IR route negative cases。

##### 性能与容量

本 refinement 不增加连接、消息或存储。后续 Activity Stream 的 snapshot 与 subscriber 容量由 `cross-session-activity-awareness` 定义，不进入 Request Execution Stream 的 replay buffer 或 sequence retention。

##### 可靠性与恢复

连接失败域被显式隔离：Activity 重连不重建 detail stream，detail resume不重建 Activity connection。两类流都不得因 transport failure 改变 runtime/session canonical facts。

##### 可维护性

使用两个具名流类型替代一个模糊的“所有 Web stream”概念；只允许一个具名例外，不引入 registry、plugin 或泛型 stream framework。实现者可从 payload语义直接判断适用契约。

##### 可测试性

稳定 requirement 提供正向、并存和禁止第三类私有 stream 的场景。后续实现通过 contract、integration 和 architecture tests 证明两类流的 payload、port、route、连接和失败隔离。

##### 审计与可追溯性

Request Execution Stream 继续可追溯到 canonical timeline。Session Activity 是当前状态派生，不冒充 execution audit；本 refinement 不新增 audit fact或 observation record。

## 验证策略（Verification Strategy）

- OpenSpec strict validation 检查两个 MODIFIED requirement 与基线名称、delta 结构和引用关系。
- 人工语义审查确认 Request Execution Stream 的现有 scenarios 被完整保留，Activity 例外没有改变 `StreamEnvelope`、timeline sequence、resume 或 terminal delivery。
- 后续 implementation change 的 contract tests 分别验证 execution SSE/WS 继续输出 `StreamEnvelope`，Activity SSE/WS 输出严格 snapshot/delta。
- architecture tests 验证 Activity 不进入 `RuntimeSessionPort.streamEvents(...)`、`agent-contracts/channel` 或 IR route。
- integration tests 验证同一 app instance 两条连接并存，任一连接的失败、重连、切换或 terminal 不改变另一条连接。
- negative tests 验证未知第三类 stream、Activity 包装 `StreamEnvelope`、Activity 使用 execution cursor 和跨 scope Activity 投影均被拒绝。

## 长期基线刷新计划

- stable specs：从 `ts-core-contracts` 移除 legacy `Canonical Timeline And Stream Projection`；把两类流的目标态合并到 `ts-web-sse-ws-transports` 的 `等价 Web Stream Transport`；`ts-run-status-visibility` 的 canonical timeline 事实语义不变。
- Function：刷新 `FN-1.1 查看会话消息流` 的描述、输出、处理过程、结果、接口、主规格与遗留规格导航；FN-2.4 无行为变化，不刷新正文。
- architecture：刷新 `ts-backend-architecture.md`、`core-contracts.md` 与 `web-stream-transports.md`，区分两类流并保留执行流 public contract owner。
- modules：刷新 `agent-contracts.md`、`agent-runtime.md` 与 `agent-channel-web.md` 各自拥有和不拥有的流语义。
- overview、Feature、ADR：无。
- spec-to-design-map：移除 legacy Requirement 导航并把 FN-1.1 的主规格导航收敛到 `ts-web-sse-ws-transports`。

## 风险与取舍（Risks / Trade-offs）

- 稳定文档未来可能重新使用宽泛的“Web stream”措辞，造成例外边界漂移。缓解方式是在归档时同时更新 architecture、core contracts、web transport design 和 spec-to-design map，并由后续 architecture test 固定两类流。
- 两类流在同一 channel package 中共存，容易因复用 transport primitive 而误复用协议状态。缓解方式是只复用 SSE/WS framing 与连接清理 primitive，不复用 payload decoder、cursor、subscriber 或 store。
- 当前只允许一个例外会要求未来新 derived stream 再做 refinement。这是刻意选择，用额外审查成本换取冻结核心契约不被逐步掏空。

## 需群内确认

已确认（2026-07-28，当前会话用户同意按本方案开始修改）：

- `StreamEnvelope`、`StreamEventType` 与 `RuntimeSessionPort.streamEvents(...)` 的冻结约束只适用于 Request Execution Stream。
- `cross-session-activity-awareness` 获得唯一 Session Activity Projection Stream 窄化例外，不形成通用私有 stream 扩展点。
- 本 refinement 不修改任何 `agent-contracts` TypeScript 类型；Activity 类型与 port 由后续实现 change 的已确认 additive delta 承担。

## 待确认问题（Open Questions）

无。
