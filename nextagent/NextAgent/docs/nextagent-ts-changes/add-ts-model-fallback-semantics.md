# add-ts-model-fallback-semantics

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Model Invocation

状态：active
类型：实施 change
主要 owner：`agent-core`
依赖：`add-ts-model-invocation-contract`、`add-ts-routing-evidence-and-fallback`

目标：
- 澄清模型失败后的 fallback 边界：`agent-model` 不得隐式 cross-profile fallback，fallback 评估归 `agent-core` orchestration，且已有用户可见输出时不得 silent replay。

能力组共享输入：

整理状态：本分组当前仅此一个共享输入起点，详细输入由本文件维护

能力组目标：
- 固化 model 层与 orchestration 层的 fallback 边界，并让真正的 decision/evidence 归口到上层 routing/orchestration。

共享规格输入：
- `agent-model` 不得在 invocation 内部做隐式 cross-profile fallback。
- fallback 候选必须来自稳定输入和已解析配置，不得在失败后临时扫描 provider 或 profile。
- fallback 评估和是否继续尝试其他 profile 的决策归 `agent-core` orchestration，不归 provider adapter 或 normalization 层。
- 已产生用户可见输出时不得 silent replay；需要降级、失败或显式回退说明时，必须经过 routing/orchestration 的可审计路径。
- routing evidence、fallback reason 和审计语义由 `add-ts-routing-evidence-and-fallback` 承接；本 change 只定义边界约束，不定义新的 routing 协议。

并行边界：
- 不得在 `agent-model` 内部引入隐藏的自动重试、自动切换 profile 或自动吞错逻辑。
- 不得绕过既有 request lifecycle、timeline、audit 和 safe error 边界。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
