## 设计范围

本 change 修改 `FN-8.2 检索和写入记忆` 与 `FN-10.1 生命周期 Hook`：为用户 Query 主动召回提供可定位的安全诊断码。其唯一实现路径是由 `agent-app` 的 trusted Hook 映射前置和运行态结果、由 `agent-memory` 映射 L1/L2 读取结果，并沿用既有 `diagnosticCode` 日志投影。

主动召回的 operational 日志已投影 trusted Hook 的 `diagnosticCode`。现有日志字段白名单允许该字段，因此仅增加有限的新码即可满足定位需求；既有聚合码保持不变，无需新增字段或改动 runtime、observability、gateway 或 remote 实现。

## FN-8.2 检索和写入记忆

### 目标与规格依据

目标 Requirement 是 `主动召回的 L2 读取有界、响应取消且全有或全无`：L1 与 L2 的无上下文结果必须可区分，同时保持有界、无重试和全有或全无。

### 修改方案

诊断码按执行阶段分类：

- 已有聚合码继续表示最终模型输入、Agent binding、RequestRun、根消息、幂等和 L1 未命中。
- `SKIPPED_COORDINATES_INCOMPLETE` 与三个 `*_LOAD_FAILED` 码区分调用坐标缺失和 Assembly、RequestRun、根消息读取失败。
- `L1_*`：L1 搜索的取消或失败；L1 未命中继续使用既有 `NO_MATCH`，且不得调用 L2。
- `L2_*`：L2 详情读取的取消或失败；任一失败仍保持全有或全无，不注入部分详情。
- `NO_CONTEXT_*`：L1/L2 已成功但上下文预算或注入失败。
- `L1_CONTEXT_ADMITTED`、`L2_CONTEXT_ADMITTED`：最终成功准入的上下文层级。

各码只表达阶段和受控原因，禁止包含 Query、记忆 ID、记忆正文、Owner Scope、原始异常或模型消息。既有 `candidateCount`、`detailCount`、`contextDisposition` 仅在当前路径已有适用值时保留。

## FN-10.1 生命周期 Hook

### 目标与规格依据

目标 Requirement 是 `Every hook invocation produces a timeline-only observability fact`：主动召回的诊断码必须区分前置条件、L1、L2、准入和幂等跳过，且不得泄露业务内容。

### 修改方案

Hook 保留既有的最终模型输入、Agent binding、RequestRun 和根消息聚合码；仅将坐标缺失和依赖读取异常映射为新码。在通过这些前置校验后才 claim 本次 RequestRun，避免不完整外层调用阻塞后续完整调用。

## 备选方案

新增 `hasContextWindowTokens` 等日志字段可以提供更多细节，但会扩大 trusted Hook 诊断字段白名单和观测投影面。本 change 仅通过已有的 `diagnosticCode` 达成定位目的，保持 KISS。

## 验证

- Hook 单元测试覆盖各类前置跳过、运行态拒绝和上下文准入码。
- 召回服务单元测试覆盖 L1 未命中、L1 失败/取消、L2 失败/取消。
- `openspec validate --all --strict`。
