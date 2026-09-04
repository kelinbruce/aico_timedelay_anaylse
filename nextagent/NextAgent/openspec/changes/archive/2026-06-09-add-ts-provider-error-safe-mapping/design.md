## 背景和现状（Context）

本 change 关注 provider/model failure 如何被统一映射进标准 error code/category/retryable 语义和 `SafeError` 输出，并在跨边界前完成脱敏。

## 黑盒目标（Blackbox Goal）

无论 failure 发生在同步调用、流式调用还是 normalization 阶段，系统都输出稳定、安全、可消费的失败终态，而不是 raw provider exception。

## 边界（Boundary）

- 负责：provider/model failure 分类、脱敏、安全映射、统一失败收口
- 不负责：定义新的 public error DTO、定义 fallback policy、定义 routing evidence 或用户侧降级编排
- 不负责：重新定义 `ModelInvocationRequest`、模型调用触发时机、`complete()` / `stream()` 生命周期或 `ModelFinalResult` 的整体终态契约
- owner：`agent-model` 主责，但必须服从全局错误契约

## 相邻 Change 关系（Adjacent Change Relationship）

`add-ts-model-invocation-contract` 定义模型调用失败出口：provider/model failure 最终通过 `ModelFinalResult.safeError` 形成失败终态，并且 raw provider failure 不得直接暴露给上层。它只说明 failure 会进入 safe mapping boundary，不定义分类、脱敏、unknown error normalization 或跨边界安全输出规则。

本 change 定义 safe mapping boundary：provider invocation failure、stream failure、normalization failure 和 unknown exception 如何归入标准 error code/category/retryable 语义，再通过 `ErrorNormalizer.normalize(error)` 或等价安全路径生成 `SafeError`。它规定 raw provider body、raw credential、stack trace、local path 和 transport internals 不得进入 `SafeError`，并规定 fallback / observability 只能消费安全错误字段。

因此，本 change 可以依赖 invocation contract 提供的失败终态出口，但不得修改调用生命周期、请求字段、`complete()` / `stream()` 方法语义、fallback policy 或 observability pipeline 实现。

## 输入输出（Inputs / Outputs）

输入：

- provider invocation failure
- stream failure
- normalization failure
- malformed provider response

输出：

- 标准 error code/category/retryable 语义
- 跨边界 `SafeError`
- 最终挂到失败 `ModelFinalResult`

## 核心实现策略（Core Implementation Strategy）

- 在 `agent-model` 内部先把 provider/model failure 归入标准 error code/category/retryable 语义。
- 在跨边界前统一执行脱敏与敏感裁剪。
- 对外只暴露 `SafeError`，并以失败终态挂到统一结果上。
- sync、stream、normalization 三类失败共用同一条安全失败链路。

## 关键约束（Key Constraints）

- 所有 failure 必须先归入标准 error code/category/retryable 语义，再离开边界时输出 `SafeError`
- unknown error 必须先走 `ErrorNormalizer.normalize(error)`
- `SafeError` 中不得包含 raw provider body、credential、stack trace、transport internals
- sync / stream / normalization 失败必须共用同一条安全失败链路
- fallback 和 observability 只能消费 `SafeError`，不能依赖 raw exception 文本

## 关键业务流程（Key Flow）

1. 捕获 provider/model failure
2. 归类为标准 error code/category/retryable 语义
3. 映射标准 category
4. 执行脱敏与敏感细节裁剪
5. 生成 `SafeError`
6. 形成失败 `ModelFinalResult`
7. 上层基于 `SafeError` 做 fallback/observability/用户提示

## 典型用例（Typical Use Cases）

- provider 返回 429 限流。系统将其归类为可重试的 `UNAVAILABLE` 或等价安全错误，而不是把原始 HTTP body 直接返回给上层。
- 网络抖动导致 stream 中断。失败先归入标准错误语义，再映射为 `SafeError`，最终形成失败 `ModelFinalResult`。
- provider 错误体包含账号或 endpoint 细节。脱敏后用户侧只看到 safe message，observability 侧记录脱敏后的标准错误事实。
