## 背景与问题（Why）

Recipe v1 contract 已落地 workflow 节点体系，但随着场景扩展暴露三类结构问题：

- **结构收敛不足**：schema_version/expandFields 与业务建模混杂；节点私有执行控制（retryPolicy/timeoutMs/onError）散落各节点且形态不一；变量引用 ${...} 与 {{...}} 双语法并存。
- **编排能力不足**：DAG 依赖、流程级控制策略（暂停/恢复/取消/重启）缺少一等字段，运行时细节泄漏到节点定义。
- **执行器耦合**：retry/timeout/persistence/resource 策略直接进入节点定义，同一 Recipe 难以适配不同执行器。

本 change 对 agent-contracts/core 做最小结构收敛：引入 runtime profile、inputs 输入契约、节点通用 dependsOn/retry/timeout/presentation、流程级 controlPolicy，并对历史字段做兼容映射。本 change 仅触及 contract 与 loader 兼容层，不改变 engine 执行语义。

## 变更范围（What Changes）

- **新增** RuntimeConfigSchema（timeout/incremental/persistence.checkpoint/defaultRetry/controlPolicy），承载执行器策略，单位统一秒（整数）。
- **新增** ControlPolicySchema（resume/modify/cancel/restart，每项 strategy + rollbackNode），流程级退出策略。
- **新增** RetryPolicySchema（maxAttempts/backoff/delay），结构化重试。
- **新增** InputDefSchema（type/required/default/description），显式输入契约。
- **新增** NodePresentationSchema/RecipePresentationSchema，展示配置。
- **扩展** WorkflowNodeDefSchema：dependsOn/retry/timeout/presentation，保留 retryPolicy/onError/outputParser 为 deprecated 兼容字段。
- **扩展** RecipeDefinitionSchema：runtime/inputs/metadata/presentation。
- **兼容** loader 对 retryPolicy 到 retry、expandFields 到 metadata 做归一映射；节点 type 别名（tool-invoke 到 TOOL、api-invoke 到 RESTFUL、suspend 到 INTERRUPT）兼容。
- **明确** domain/scene/lang 顶层字段由已归档 change  add-ts-workflow-recipe-classification-fields 承接，本 change 不重复定义。
- **新增** 废弃节点 deprecation warning：loader 对 agent/tool-choice/data-analysis/tool-invoke 节点产出 structured warning log，不阻断执行。
- **增强** user-check 节点输入契约：action_type（choice/input/confirm，必填）、options[] 含 label+value（choice 时必填）、timeout（秒）、timeout_result（超时 fallback 值）、输出 user_check_result + user_check_input。
- **新增** restful(api-invoke) 节点节点级 batchConfig 配置契约：batchInputDataItem/batchElementVariable/batchSize/batchMode/batchFailStrategy/batchParallelism/batchResultMerge，承载分批 API 调用能力。batchConfig 是 WorkflowNodeDef 顶层可选字段（与 loopConfig 平行），不在 inputs 中；batch 模式输出 batch_results/failed_items/api_response。
- **明确** loopConfig 与 batchConfig 互斥语义：loop 用于单节点或多节点间串行循环编排，batch 仅 restful 节点支持的批量 API 调用配置，同一节点 MUST NOT 同时声明，loader 拒绝（reason code WORKFLOW_BATCH_LOOP_CONFLICT）；不同节点可各自使用。
- **明确** suspend（原 interrupt-gateway）当前不实现，不在本 change 范围。
- **修正** `recipeName` 约束：从复用 `WorkflowSafeIdSchema`（pattern + maxLength 128）改为独立 `Type.String({ maxLength: 255 })`，不施加 pattern 或 minLength 约束。recipeName 是自由形式标识符，maxLength 255 与 1.0 DSL 规范一致，与 node-id 用的 `WorkflowSafeId` 语义不同。

## 不在范围内（Explicit Non-Goals）

- 不实现 engine 对 runtime/controlPolicy/dependsOn 的执行语义（由 refine-ts-workflow-execution-engine-v2 承接）。
- 不引入 runtime.profile/runtime.resourcePolicy（暂无消费者，延期）。
- 不引入 suspend 节点恢复语义（INTERRUPT 维持现状）。
- 不实现 global_vars.xxx 到 input.xxx 全局变量迁移（代码库无使用）。
- 不实现 outputParser 子 schema 冻结（保持 opaque，display_title/display_content/type:FILE 等增强暂不引入）。
- 不实现 DAG 并行调度（保持串行 fork-join，延期到分布式执行 change）。
- 不实现静态 recipe 校验器（延期）。

## Capability 影响（Capabilities）

### 修改的 Capability

- workflow-contracts：扩展 RecipeDefinition/WorkflowNodeDef，新增 runtime/controlPolicy/inputs/presentation vocabulary。
- workflow-node-handlers：增强 user-check 节点（action_type/timeout_result）、restful 节点节点级 batchConfig 配置、废弃节点 deprecation warning。

## 影响范围（Impact）

- agent-contracts/core：新增 schema 导出，additionalProperties: false 约束保持。
- agent-app/composition/workflow-recipe-loader：扩展 normalizeRecipeDefinition/normalizeNodeDefinition，新增废弃节点 warning。
- agent-workflow/nodes：增强 executeUserCheckNode 和 executeRestfulNode handler。
- 跨 package 边界不变，loader 通过 public export 消费 contract schema。
- 时间单位统一为秒（s，整数），不支持毫秒（ms）和小数。所有 timeout/delay/batch 相关超时字段均以秒为单位。

## 需群内确认

- **已确认（2026-07-28）：**群内已确认 `agent-contracts/core` 新增 `WorkflowBatchConfigSchema`，并由 `WorkflowNodeDefSchema.batchConfig` 作为节点级可选配置引用；`loopConfig` 与 `batchConfig` 保持互斥。
