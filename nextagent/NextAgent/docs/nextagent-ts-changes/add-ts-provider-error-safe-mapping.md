# add-ts-provider-error-safe-mapping

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Model Invocation

状态：active
类型：实施 change
主要 owner：`agent-model`
依赖：`establish-ts-core-contracts`、`add-ts-model-invocation-contract`

目标：
- 定义 provider/model failure 到 `AgentError` / `SafeError` 的安全映射规则，统一 sync、stream 和 normalization failure 的安全错误边界。

能力组共享输入：

整理状态：本分组当前仅此一个共享输入起点，详细输入由本文件维护

能力组目标：
- 固化模型访问失败的安全归一化边界，避免 raw provider detail 越过产品边界。

共享规格输入：
- provider invocation failure、stream failure、normalization failure 和 unknown exception 必须先归入标准 `AgentError` 语义，再通过 `ErrorNormalizer` 或等价安全路径生成 `SafeError`。
- sync、stream 和 normalization failure 必须共享同一安全错误出口，不得形成多套 failure contract。
- `SafeError` 不得包含 raw provider body、raw credential、stack trace、local path、transport internals 或 provider SDK 私有错误对象。
- fallback、observability、audit 和上层 orchestration 只能消费安全错误和稳定错误分类，不得依赖 raw provider exception。
- 本 change 不重新定义 `ModelInvocationRequest`、模型调用触发时机、`complete()` / `stream()` 生命周期或 `ModelFinalResult` 的整体终态契约。

并行边界：
- 不得在本 change 中扩展或泄漏未经脱敏的 provider/model 输出、prompt、tool args/result 或 secret。
- 不得让 `agent-core`、`agent-runtime` 或 channel 直接承担 provider 私有错误分类职责。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
