## Why

模型在输出 Token 耗尽时可能只产生内部推理，或者只产生被截断、无法解析为完整 Tool call 的输出。当前系统会把具有明确截断证据的空 Tool-call 终态直接判为不可恢复失败；对于预算提升后仍只有内部推理的结果，又会直接进入普通续写，不能促使模型收敛为可见回答或一次完整 Tool call。

这会把具备恢复条件的模型调用过早转成 request failure，并让推理模型在后续调用中重复消耗输出预算。系统需要只对证据充分的截断结果恢复，并保证恢复顺序和次数有界。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 具有精确 `incompleteOutputReason="truncated-tool-call"` 证据的空 Tool-call 终态进入既有输出 Token 恢复流程。
- 其他没有完整 Tool call 的 `finishReason="tool-calls"` 终态继续以 non-retryable `MODEL_TOOL_CALLS_MISSING` 安全失败。
- 同请求预算提升后仍返回 reasoning-only `length` 终态时，在普通续写前只注入一次收敛指令。
- 继续复用既有预算提升、最多三次续写、取消和不安全 Tool call 失败边界。

**非目标：**

- 不改变模型选择、cross-model fallback、provider retry 或 stream wait 失败策略。
- 不修改公共模型 contract shape、Web API、stream event 或 persistence。
- 不增加新的恢复计数器、配置项或模型专用分支。

## What Changes

- 模型终态只在空 Tool-call 结果具有精确 `truncated-tool-call` 证据时保留 incomplete 状态；语义不匹配的 `output-limit` 标记不得绕过安全失败。
- 首次 `length` 空产出仍先执行既有预算提升；提升后仍只有内部推理时，复用既有 reasoning-only correction 做一次收敛重试。
- 收敛后仍不完整的输出继续进入既有 request-local 续写，并在恢复预算耗尽时安全失败。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：模型不完整终态的证据判定、预算提升、reasoning-only 收敛和有界续写。
  - 系统质量属性：可靠性/恢复、安全、性能/容量。
  - 映射说明：`model-invocation-contract` 是 canonical spec。

## 影响范围（Impact）

- Agent 使用者可观察到原本会直接失败或重复空转的请求获得一次有界恢复机会。
- 模型调用仍使用当前请求已冻结的模型路由、消息、工具集合、timeout 和 cancellation signal。
- 本 change 只新增 OpenSpec artifact 目录；该目录由 OpenSpec workflow 管理，归档后迁入 archive，不进入产品构建、打包或运行时。
