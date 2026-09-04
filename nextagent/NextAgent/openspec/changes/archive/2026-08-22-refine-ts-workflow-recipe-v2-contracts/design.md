## 设计决策

### D1 Runtime Profile 字段裁剪

Recipe v2 spec 定义 runtime.profile/runtime.resourcePolicy。本 change 暂不引入这两个字段，原因：

- profile 用于选择执行器（如 taskflow/lightweight），当前仅有内存态 InMemoryWorkflowExecutionService，无多执行器路由消费者。
- resourcePolicy.class 无对应 runtime 资源调度实现。

保留字段：timeout（整体超时）、incremental（增量执行标志）、persistence.checkpoint（断点续跑）、defaultRetry（全局重试默认）、controlPolicy（退出策略）。待执行器分层落地后再补 profile/resourcePolicy。

### D2 时间单位统一为秒

1.0 DSL 所有时间字段（delay_time/timeout/join_timeout 等）均以秒为单位。为与 1.0 DSL 保持一致，本 change 的 retry.delay/runtime.timeout/node.timeout/user-check timeout 统一为秒（整数），不支持小数。loader 对 v1 timeoutMs 不再透传（已删除 deprecated 字段），engine 在调用 setTimeout/Date.now 时将秒转换为毫秒（×1000）。所有新增时间字段同样以秒为单位。

### D3 controlPolicy 流程级，onError 节点级废弃

controlPolicy 定义在 runtime 下，是流程级暂停/恢复/取消/重启策略。节点级 onError（SKIP/JUMP）语义被 exception 分支（与 next 同级）覆盖，onError 保留为 deprecated 字段，loader 不再消费，engine 不读取。exception 不废弃，作为节点级异常转移的一等机制。

### D4 历史字段兼容映射

| v1 字段 | v2 字段 | 映射策略 |
|---------|---------|----------|
| retryPolicy (opaque) | retry (RetryPolicySchema) | loader 透传 retryPolicy，同时尝试结构化为 retry |
| onError | deprecated | loader 保留，engine 不消费 |
| expandFields | metadata | loader 合并到 metadata |
| outputParser (node级) | presentation.outputParser | loader 映射到 presentation.outputParser |

### D5 节点 type 别名兼容

loader normalizeNodeType 接受别名并归一化到内部 enum：
- tool-invoke 到 TOOL
- api-invoke 到 RESTFUL
- suspend 到 INTERRUPT

别名仅用于 loader 兼容，contract WorkflowNodeType enum 不新增别名值。

### D7 废弃节点 deprecation warning

以下节点类型标记为 deprecated：AGENT、TOOL_CHOICE、DATA_ANALYSIS、TOOL（原 tool-invoke）。loader 在 normalizeNodeType 归一化后，若节点 type 属于废弃集合，MUST 产出 structured warning log（不阻断执行）。handler 保持现有执行能力不变，后续可能继续提供能力。

warning log 结构：event=workflow.recipe.deprecated-node, reasonCode=WORKFLOW_NODE_DEPRECATED, nodeType, recipeName。使用既有 runtimeLogger.warn。

### D8 user-check 增强设计

user-check 节点增强输入契约，新增 action_type 字段（必填），支持三种交互模式：

- choice：选策略。options[] 必填且非空，每项含 label（展示文本）+ value（用于 next 条件判断）。输出 user_check_result = 用户选择的 value。
- input：补信息。用户输入文本。输出 user_check_input = 用户输入文本。
- confirm：确认继续。输出 user_check_result = "true"/"false"（字符串）。

超时处理：timeout（秒，可选）。超时后 user_check_result 取 timeout_result 值（可选，缺省为空字符串）。

输出绑定：
- user_check_result：用户选择的 value（choice）、"true"/"false"（confirm）、超时 fallback 值。
- user_check_input：用户输入文本（仅 input 模式产出）。

handler 实现复用既有 pendingInput 机制（requestPendingInput），action_type 通过 pendingInput 的 kind 和 questions 结构传递。choice/confirm 使用 QUESTION kind + options；input 使用 QUESTION kind + 无 options（允许自由输入）。

### D9 restful batch 配置设计（节点级 batchConfig）

restful(api-invoke) 节点新增节点级 `batchConfig` 子配置，承载分批 API 调用能力。`batchConfig` 是 `WorkflowNodeDef` 的顶层可选字段，与 `loopConfig` 平行；batch 配置字段 MUST NOT 放在 `inputs` 中。

设计决策（从 inputs 扁平迁到节点级）：
- **编排配置与 API 调用参数分离**：原设计将 7 个 batch 字段塞进 inputs，与真正的 API 调用参数（api_name/api_group/...）混在同一对象，handler 需 omitKeys 抠键才能拼出干净的调用 args。迁到节点级后 inputs 纯粹是 API 调用参数。
- **与 loopConfig 同形同策**：loopConfig 已是节点级编排子配置，batchConfig 与之平行，loader 各自一个 normalizeXxxConfig，snake_case→camelCase 归一化方式一致。
- **门控语义明确**：batchConfig 字段存在 = batch 模式，不存在 = 单次调用。比靠 batchInputDataItem 是否非空数组判门更明确。

batchConfig 字段（camelCase，loader 做 snake_case batch_config 到 camelCase batchConfig 映射）：
- batchInputDataItem（List，启用 batch 时必填）：待分批处理的参数列表，引用上游节点输出。
- batchElementVariable（string，可选，默认 "element"）：循环时临时变量名，API 参数模板中通过 `${<batchElementVariable>}` 引用当前批次的参数。不存在固定别名 `${batch_item}`；引用名由 batchElementVariable 的值决定。
- batchSize（int，可选，默认 10）：每批参数量上限。
- batchMode（string，可选，默认 "serial"）："serial"（串行逐批调用）或 "parallel"（多批并行调用）。
- batchFailStrategy（string，可选，默认 "continue"）："continue"（部分批次失败时继续）或 "abort"（任一批次失败立即终止）。
- batchParallelism（int，可选，默认 5，上限 20）：并行模式下最大并发批次数，仅 batchMode=parallel 时生效。
- batchResultMerge（string，可选，默认 "append"）："append"（所有批次结果追加为 List）或 "map"（按批次元素 key 合并为 Map）。

handler 实现复用既有 capabilityInvocation.invoke()。未提供 batchConfig 时为单次调用（现有行为不变）。提供时启用 batch 模式：
1. 校验 batchInputDataItem 为非空数组；否则报 WORKFLOW_BATCH_INPUT_INVALID（声明 batchConfig 即表达 batch 意图，输入不满足是配置错误）。
2. 将 batchInputDataItem 按 batchSize 分批。
3. 每批构造 invocation args：baseArgs（inputs 去除 api_name）+ `{ [batchElementVariable]: 当前批次元素 }`。
4. 按 batchMode（serial/parallel）执行调用。
5. 按 batchFailStrategy 处理失败。
6. 按 batchResultMerge 合并结果。
7. 输出 batch_results（合并后结果数组）、failed_items（失败项）、api_response（最后一个元素的结果）。

api_response 在 batch 模式下的语义：绑定 `results[items.length - 1]`（按下标不按完成时序，parallel 模式也确定）。abort 模式下若最后元素未执行到，api_response 为 undefined（静默跳过）；continue 模式下若最后元素本身失败，api_response 为 undefined，该元素错误在 failed_items 中。batch_results 与 batch_summary 语义相同（汇聚 List/Map 结果），统一使用 batch_results，不新增 batch_summary。

### D10 loopConfig 与 batchConfig 互斥

loopConfig 和 batchConfig 是两个独立的编排能力，语义重叠（均对一组输入做迭代/分批），同节点同时声明会导致 engine 循环体执行与 handler batch 执行交织歧义。当前 engine 实现 loop 检测在 handler 调用之前，同节点同时声明时行为未定义。

设计决策（互斥而非共存）：
- **简单优先**：loop（串行迭代，可跨多节点）和 batch（单节点分批并发）都是对一组输入做迭代/分批，同节点同时声明几乎没有不可替代的真实场景。要串行逐个调用用 loop，要并发分批用 batch，二选一。
- **避免歧义**：当前实现是 loop 先跑循环体、batch 后跑一次的串接，但用户合理预期可能是每次 loop 迭代里对一批参数并发（嵌套），两者行为不同，不定义就是埋雷。
- **与 loop-control change 对齐**：loop-control 已明确首版仅支持 restful 节点的 loop，loop 和 batch 都作用在 RESTFUL 节点上，语义高度重叠。互斥把用户导到正确选择。

同一 recipe 可以在不同节点分别使用 loop 和 batch。同一节点 MUST NOT 同时声明 loopConfig 和 batchConfig。loader 在 normalizeNodeDefinition 阶段检测，同时声明时拒绝，reason code WORKFLOW_BATCH_LOOP_CONFLICT。若将来确有外层串行循环 + 内层并发分批的场景，再提受控嵌套 change，届时明确两层迭代的变量绑定和结果聚合规则。

## 架构影响

- agent-contracts/core：新增 schema 导出，additionalProperties: false 约束保持。
- agent-app/composition/workflow-recipe-loader：新增 normalizeRetry/normalizeException/normalizeNodePresentation/normalizeBatchConfig helper，扩展 normalizeRecipeDefinition/normalizeNodeDefinition（含 loopConfig/batchConfig 互斥校验），新增废弃节点 warning。
- agent-workflow/nodes：增强 executeUserCheckNode 和 executeRestfulNode handler（restful handler 从 context.node.batchConfig 读取，不再从 inputs 抠 batch 键）。
- 跨 package 边界不变，loader 通过 public export 消费 contract schema。
### D11 recipeName 约束修正

v1 RecipeDefinition.recipeName 复用 WorkflowSafeIdSchema（Type.String minLength 1, maxLength 128, pattern ^[A-Za-z0-9._:-]+$），该 schema 同时服务 node-id 等结构化标识符。recipeName 是面向业务的自由形式标识符（可含空格、中文等），pattern 约束不合理。

本 change 将 recipeName 从 WorkflowSafeIdSchema 解绑为独立约束 Type.String maxLength 255：
- 移除 pattern 约束——recipeName 不限于 [A-Za-z0-9._:-] 字符集
- 移除 minLength 约束——允许空字符串（业务可能使用默认 recipe）
- maxLength 从 128 调整为 255——与 1.0 DSL 规范一致（1.0: Recipe 名称最长 255），recipeName 是业务标识符
- WorkflowSafeIdSchema 继续用于 node-id、capabilityId 等结构化标识符，不受影响

loader 的 extractRecipeName 不做 pattern 校验，仅 Ajv schema 层做 maxLength 校验。
