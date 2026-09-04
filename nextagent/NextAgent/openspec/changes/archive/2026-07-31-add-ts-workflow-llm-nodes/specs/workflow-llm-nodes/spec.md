## ADDED Requirements

### Requirement: Shared LLM Node Execution

Workflow engine MUST 在不调整 Recipe YAML DSL 的前提下，以统一方式执行 `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract`。

LLM 节点的 node-specific schema MUST 由本 change owner 定义；`agent-contracts/core` 中的 `WorkflowNodeDef.inputs`、`outputs`、`outputParser` 和 `RecipeDefinition.llmDefaults` 只作为 opaque 容器，不得在 core contracts 中枚举 LLM 私有字段。

**触发机制：**
- 当任一 LLM 节点 ready 且前置依赖满足时触发
- 位于 workflow execution 阶段，在 graph 调度中同步启动、异步等待模型返回
- 受 recipe timeout、request cancel、模型预算检查和 runtime scheduler 共同约束

**输入与前置条件：**
- 节点 `inputs`、可选 `outputSchema`
- 已注册的 model profile、prompt template、context assembly policy
- 当前 `contextVariables`、owner scope、agent scope、trusted `AbortSignal`

**输出与副作用：**
- 产出 safe `WorkflowNodeResult.output`
- 产出 lifecycle event、budget diagnostic、validation diagnostic
- 不写 raw prompt、raw model output、provider raw error

**核心判断逻辑：**
1. 从节点 `inputs` 和上下文构造 prompt intent
2. 通过 `agent-context-engine` 组装 prompt 和上下文窗口
3. 检查预算；超限时先压缩
4. 通过 `ModelInvocationService` 调用模型
5. 将返回结果解析为预期结构
6. 通过 schema validation 后写入 safe output

**状态 / 产物契约：**
- `WorkflowNodeResult.output` 与原始模型输出保持可追溯但不等价；只保留安全后的结果
- `budget diagnostic` 和 `validation diagnostic` 的生命周期与 execution 相同；消费方为 observability / recovery diagnostic，不对用户直接暴露

**流程接入：**
- 上游：任意提供变量输入的节点
- 下游：消费 safe output 的 gateway / capability / interaction 节点

**失败与降级：**
- 模型超时 / 中断 -> 节点 MUST 返回明确失败或中断
- budget 仍超限 -> 节点 MUST 失败或走 `onError`
- validation 失败 -> 节点 MUST NOT 将非法结果传递给下游

#### Scenario: Safe Output Only
- **WHEN** 任一 LLM 节点执行完成
- **THEN** `WorkflowNodeResult.output` MUST 只包含 safe 结果
- **AND** MUST NOT 包含 raw prompt 或 raw model output

#### Scenario: Over Budget Compression
- **WHEN** prompt + context 超出模型预算阈值
- **THEN** system MUST 先尝试 compression
- **AND** compression 仍无法满足预算时 MUST 明确失败或按 `onError` 降级

### Requirement: LLM Family Boundary

workflow LLM 节点 MUST 只 owner通用模型转换、分类、重写、翻译、分析和提取语义，不得与其他 workflow node families 的 owner 冲突。

#### Scenario: No Retrieval Or Side Effect Ownership
- **GIVEN** knowledge、capability、interaction families 分别 owner 检索/选择、外部 side effect、用户交互
- **WHEN** 实现 `llm-router`、`intent-recognition`、`question-rewriting`、`translation`、`data-analysis`、`param-extract`
- **THEN** LLM 节点 MUST NOT 直接执行知识检索、tool/API/python/agent side effect、pending input 或 display projection
- **AND** 需要这些能力时 MUST 通过上游/下游节点协作，而不是在 LLM family 内重建 owner

### Requirement: LLM Router

`llm-router` MUST 作为通用 LLM completion 节点工作，可用于路由判断、生成答案或生成结构化中间结果。

**触发机制：**
- 当 `llm-router` ready 时触发

**输入与前置条件：**
- 标准 Recipe YAML `inputs.prompt_template` 或 `inputs.prompt_template_name`
- 可选 `inputs.model` / `inputs.modelGroup` / `inputs.capability`
- 当前 `contextVariables`

**输出与副作用：**
- 根据 `outputs` 映射生成 safe output

**核心判断逻辑：**
1. 解析 prompt template 或 prompt template name
2. 选择模型 profile
3. 调用模型并解析结果
4. 将结果映射到声明的 output key

**失败与降级：**
- 缺失模板或模型配置 -> 明确失败

#### Scenario: Structured Mapping
- **WHEN** `llm-router` 配置了 output 映射
- **THEN** system MUST 将 safe 结果映射到声明的 output key

### Requirement: Intent Recognition

`intent-recognition` MUST 识别输入意图并输出安全的分类结果。

**触发机制：**
- 由调度器在节点 ready 时触发

**输入与前置条件：**
- 查询文本、候选意图集合、可选多轮上下文

**输出与副作用：**
- `intent`
- `confidence`

**核心判断逻辑：**
1. 组装分类 prompt
2. 调用模型
3. 校验 `confidence` 在 `0..1` 区间

**失败与降级：**
- confidence 不合法 -> validation 失败

#### Scenario: Confidence Validation
- **WHEN** 模型返回 `confidence`
- **THEN** 系统 MUST 校验其位于 `0..1`

### Requirement: Question Rewriting

`question-rewriting` MUST 将用户问题改写为更适合检索或后续推理的查询，同时保持关键电信术语不丢失。

**触发机制：**
- 在节点 ready 后触发

**输入与前置条件：**
- 原始问题
- 可选历史摘要、领域上下文

**输出与副作用：**
- `rewrittenQuery`

**核心判断逻辑：**
1. 读取原始问题和可选上下文
2. 执行改写
3. 检查关键术语保留约束

**失败与降级：**
- 无法生成安全改写 -> 返回明确失败或走 `onError`

#### Scenario: Preserve Telecom Terms
- **WHEN** 原始问题包含电信网元、告警码或专业术语
- **THEN** 改写结果 MUST 保留这些关键术语或其等价安全表达

### Requirement: Translation

`translation` MUST 按指定源语言和目标语言输出翻译结果。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- `text`
- `sourceLang`
- `targetLang`

**输出与副作用：**
- `translatedText`

**核心判断逻辑：**
1. 校验输入文本非空
2. 组装翻译 prompt
3. 调用模型并输出 safe 文本

**失败与降级：**
- 不支持的语言对 -> 明确失败

#### Scenario: Translation Output
- **WHEN** 提供合法语言对
- **THEN** 系统 MUST 返回 `translatedText`

### Requirement: Data Analysis

`data-analysis` MUST 基于结构化数据和分析提示输出可消费的分析结果。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 结构化 `data`
- `analysisPrompt`

**输出与副作用：**
- `analysisResult`

**核心判断逻辑：**
1. 校验输入数据可序列化
2. 组装分析 prompt
3. 调用模型并返回 safe 分析结果

#### Scenario: Structured Data Analysis
- **WHEN** 输入结构化数据和分析提示
- **THEN** 系统 MUST 产出 `analysisResult`

### Requirement: Param Extract

`param-extract` MUST 从输入文本中提取符合 schema 的结构化参数。

**触发机制：**
- 节点 ready 时触发

**输入与前置条件：**
- 源文本
- `paramSchema`

**输出与副作用：**
- `extractedParams`

**核心判断逻辑：**
1. 组装参数提取 prompt
2. 调用模型
3. 将结果解析为 JSON
4. 依据 `paramSchema` 做 runtime validation

**状态 / 产物契约：**
- `extractedParams` 与原始文本保持可追溯关系，但只落地验证通过的结构

**失败与降级：**
- JSON 解析失败 / schema 校验失败 -> MUST 失败或重试，不得透传原始字符串

#### Scenario: Reject Invalid Structured Output
- **WHEN** 模型返回不符合 `paramSchema` 的结果
- **THEN** 系统 MUST 拒绝该结果，不得直接传给下游节点
