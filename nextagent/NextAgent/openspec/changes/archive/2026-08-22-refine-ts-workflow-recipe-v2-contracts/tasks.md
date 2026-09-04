## 1. Schema 定义

- [x] 1.1 新增 RetryPolicySchema/ControlPolicySchema/RuntimeConfigSchema
  验证：`npm run test:contract`
- [x] 1.2 新增 InputDefSchema/NodePresentationSchema/RecipePresentationSchema
  验证：`npm run test:contract`
- [x] 1.3 扩展 WorkflowNodeDefSchema：dependsOn/retry/timeout/presentation，保留 deprecated 字段
  验证：`npm run test:contract`
- [x] 1.4 扩展 RecipeDefinitionSchema：runtime/inputs/metadata/presentation
  验证：`npm run test:contract`
- [x] 1.5 所有新增 schema 保持 additionalProperties: false
  验证：`npm run test:contract`

## 2. Loader 兼容

- [x] 2.1 normalizeRetry：retryPolicy 到 retry 归一映射
  验证：`npm run test:contract`
- [x] 2.2 normalizeException：exception 透传
  验证：`npm run test:contract`
- [x] 2.3 normalizeNodePresentation：outputParser 到 presentation.outputParser 映射
  验证：`npm run test:contract`
- [x] 2.4 normalizeNodeType：tool-invoke/api-invoke/suspend 别名归一
  验证：`npm run test:contract`
- [x] 2.5 normalizeRecipeDefinition：expandFields 到 metadata 合并
  验证：`npm run test:contract`

## 3. 测试

- [x] 3.1 runtime + controlPolicy schema 校验测试
  验证：tests/contract/workflow-contracts.test.ts
- [x] 3.2 inputs + metadata 测试
  验证：tests/contract/workflow-contracts.test.ts
- [x] 3.3 dependsOn + retry + timeout + presentation 测试
  验证：tests/contract/workflow-contracts.test.ts
- [x] 3.4 exception 同级测试
  验证：tests/contract/workflow-contracts.test.ts
- [x] 3.5 独立 schema 校验测试
  验证：tests/contract/workflow-contracts.test.ts
- [x] 3.6 v1 deprecated 字段兼容测试
  验证：tests/contract/workflow-contracts.test.ts

## 4. 废弃节点 deprecation warning

- [x] 4.1 loader 对 AGENT/TOOL_CHOICE/DATA_ANALYSIS/TOOL 节点产出 structured warning log
  验证：tests/contract/workflow-package-composition.test.ts

## 5. user-check 增强

- [x] 5.1 action_type 字段（choice/input/confirm，必填）
  验证：packages/agent-workflow/tests/workflow-interaction-nodes.test.ts
- [x] 5.2 timeout + timeout_result 超时回退
  验证：packages/agent-workflow/tests/workflow-interaction-nodes.test.ts
- [x] 5.3 options[] 含 label+value（choice 时必填校验）
  验证：packages/agent-workflow/tests/workflow-interaction-nodes.test.ts
- [x] 5.4 输出 user_check_result + user_check_input
  验证：packages/agent-workflow/tests/workflow-interaction-nodes.test.ts

## 6. restful batch 配置（节点级 batchConfig）

- [x] 6.1 batchConfig 节点级契约定义：WorkflowNodeDefSchema 新增 batchConfig: Type.Optional(WorkflowBatchConfigSchema)，additionalProperties: false 保持；spec.md RestfulBatchConfig 更新为节点级
  验证：tests/contract/workflow-contracts.test.ts + spec.md
  验证记录（2026-07-28）：群内已确认 `WorkflowBatchConfigSchema` 与 `WorkflowNodeDefSchema.batchConfig` public contract，且 loopConfig/batchConfig 互斥边界保持。
  注：batch 配置从 inputs 扁平迁到节点级 batchConfig（与 loopConfig 平行）；新增 api_response 在 batch 模式输出最后元素结果；batch_results 统一命名（不新增 batch_summary）。保留既有 spec delta：continue/append/is_long_api 正交声明/parallelism clamp scenario + 可追溯与 secret 约束；batch 优先于 is_long_api。修正：batchConfig 存在但 batchInputDataItem 缺失或非数组时报 WORKFLOW_BATCH_INPUT_INVALID（不再静默降级为单次调用）。
- [x] 6.2 executeRestfulBatch handler 修订：readBatchConfig 从 context.node.batchConfig 读取（非 inputs）；bindings 补 api_response: results[items.length-1]；移除 omitKeys 抠 batch 键；移除 restfulBatchConfigKeys 常量；测试用例从 inputs 扁平写法迁到节点级 batchConfig；新增 api_response 绑定测试与 batchInputDataItem 非数组报错测试
  验证：packages/agent-workflow/tests/workflow-capability-nodes.test.ts
- [x] 6.3 loader 修订：normalizeRestfulBatchInputs 改为 normalizeBatchConfig（节点级 batch_config→batchConfig），与 normalizeLoopConfig 同形
  验证：tests/contract/workflow-package-composition.test.ts
- [x] 6.4 loopConfig 与 batchConfig 互斥：loader normalizeNodeDefinition 检测同节点同时声明，拒绝 reason code WORKFLOW_BATCH_LOOP_CONFLICT；spec.md LoopBatchMutex
  验证：tests/contract/workflow-package-composition.test.ts + spec.md LoopBatchMutex

## 7. 延期

- [x] 8.1 RecipeName 约束修正：从 WorkflowSafeIdSchema 解绑为独立 Type.String maxLength 255（与 1.0 DSL 规范一致）
  验证：tests/contract/workflow-contracts.test.ts
- [x] 8.2 RecipeName 自由形式值（含空格、中文）被 loader 接受
  验证：tests/contract/workflow-contracts.test.ts
- [x] 8.3 RecipeName 长度超过 255 被 loader 拒绝
  验证：tests/contract/workflow-contracts.test.ts

- [ ] 7.1 global_vars.xxx 到 ${input.xxx} 迁移（代码库无使用，延期）
  验证：N/A
- [ ] 7.2 onError deprecation warn 机制（warn 未实现，延期）
  验证：N/A
- [ ] 7.3 DAG 并行调度（保持串行 fork-join，延期到分布式执行 change）
  验证：N/A
- [ ] 7.4 静态 recipe 校验器（延期）
  验证：N/A
- [x] 7.5 Code review
  验证：`$nextagent-code-review` PASS
