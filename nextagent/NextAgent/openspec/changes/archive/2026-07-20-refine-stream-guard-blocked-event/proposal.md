## 背景与问题（Why）

`add-ts-safety-guardrails` 需要输出护栏在流式输出命中风控时向客户端发送一个"本轮被拦截"的 terminal 信号，前端收到后停止并清空已渲染内容。

当前基线有两处约束阻止了这一点的直接实现：

- `ts-core-contracts` 冻结 `StreamEventType` vocabulary，且规定"channel MUST 使用 `StreamEventType` 投影 canonical timeline 或 runtime status"；`ts-web-sse-ws-transports` 规定"projection service MUST NOT 发明 transport-private stream event names"。因此不能新增一个"被拦截"事件类型。
- `ts-core-contracts` 规定客户端流只从 canonical timeline 或 runtime status 派生，外部服务不得向客户端流注入事件。因此 guard proxy（RobotRouter）不能把它检测到的拦截信号直接作为客户端可见 stream event。

为绕开这两条，`add-ts-safety-guardrails` 当前把输出拦截映射到既有 `REQUEST_FAILED`（需 run 真的转为 FAILED），并为此新增了 `RuntimeCommandPort.failRun` 命令。这条链路（failRun → run FAILED → REQUEST_FAILED 投影）实现复杂、与"外部策略层拦截"的语义不直观。

本 refinement 放宽这两条约束的边界，使输出护栏回到直观模型：guard proxy 在 guard-forward relay 路径上注入一个受治理的 terminal `OUTPUT_GUARD_BLOCKED` 事件，前端收到即清空本轮。

## 变更范围（What Changes）

- `StreamEventType` vocabulary 新增 `OUTPUT_GUARD_BLOCKED`（terminal 事件）。
- 调整 stream-derivation 规则：允许**受治理的 guard-forward relay 路径**作为受控例外——guard 层（经 `GuardrailGatewayPort` 的 guard proxy）可在 relay 的流上注入 terminal `OUTPUT_GUARD_BLOCKED` 事件，其 payload 携带 guard reason 与 guard 服务返回的 `refusalMessage`。
- 约束（防止放宽被滥用）：
  - 仅 `OUTPUT_GUARD_BLOCKED` 这一个事件允许由 guard-forward relay 注入；其他 stream event 仍 MUST 从 canonical timeline 或 runtime status 派生。
  - `OUTPUT_GUARD_BLOCKED` MUST 是 terminal 事件，其后 MUST NOT 再出现增量内容事件。
  - guard-forward relay 仍 MUST 经 `GuardrailGatewayPort`（受治理出口），MUST NOT 绕过 gateway 直连 guard 服务；前端/客户端仍只与 NextAgent 自有端点交互。
  - `OUTPUT_GUARD_BLOCKED` 不替代 runtime 的 terminal commit 事实；run 的 canonical terminal 状态仍由 runtime 拥有（relay 注入的 `OUTPUT_GUARD_BLOCKED` 是 guard 层对客户端流的 terminal 信号，与 runtime terminal 状态各自独立）。

本 refinement 不规定 guard proxy 的回调拓扑（仍由 `add-ts-safety-guardrails` 决定），只放宽"加事件 + relay 注入"这两个契约边界。

## Capability 影响（Capabilities）

### 新增 Capability

（无）

### 修改的 Capability

- `ts-core-contracts`: "Canonical Timeline And Stream Projection" requirement——`StreamEventType` 新增 `OUTPUT_GUARD_BLOCKED`；stream-derivation 规则增加 guard-forward relay 受控例外。
- `ts-web-sse-ws-transports`: projection service 规则增加例外——guard-forward relay 路径允许注入 terminal `OUTPUT_GUARD_BLOCKED`，其他事件仍不得发明 transport-private 名。

## 影响范围（Impact）

- **契约**：`agent-contracts/src/channel/index.ts` 的 `StreamEventType` 加 `"OUTPUT_GUARD_BLOCKED"`。
- **设计基线**：`openspec/designs/architecture/core-contracts.md` 的 `StreamEventType` 冻结清单 + stream-derivation 不变量补充 guard-forward relay 例外。
- **下游依赖**：`add-ts-safety-guardrails` 的输出护栏依赖本 refinement（改回简单模型：relay 注入 `OUTPUT_GUARD_BLOCKED` → 前端清空，撤掉 `failRun` 链路）。
- **测试**：contract 测试断言 `StreamEventType` 含 `OUTPUT_GUARD_BLOCKED`；guard-forward relay 注入该事件后 terminal 语义 + 其后无增量。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-core-contracts/spec.md`：合并 `OUTPUT_GUARD_BLOCKED` 事件与 guard-forward relay 例外。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 projection service 例外。
- `openspec/designs/architecture/core-contracts.md`：`StreamEventType` 清单 + stream-derivation 不变量更新。
- `openspec/overview.md`、`openspec/designs/spec-to-design-map.md`：导航更新。
