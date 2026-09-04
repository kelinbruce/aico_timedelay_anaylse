# add-ts-workflow-loop-control

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 节点与控制流扩展

状态：candidate
类型：扩展候选 change
主要 owner：`agent-workflow`
依赖：`add-ts-workflow-engine-contracts`、`add-ts-workflow-execution-engine`

目标：
- 承接 workflow `loop` 控制流：engine 识别 `restful` 节点的 `loop` 子配置，按 `loop_cardinality` 或 `loop_input_data_item` 驱动迭代执行、上下文绑定、退出条件求值和结果聚合。当前 loop 仅用于 `restful` 节点的批量查询场景，其他节点类型暂不支持。

规格输入：

- `loop` 是节点级子配置，不是独立节点类型；loop 语义由 engine 驱动，节点 handler 只感知单次迭代。
- 首版仅支持 `restful` 节点的 loop（批量查询场景）；非 `restful` 节点声明 `loop` 被拒绝（reason code `WORKFLOW_LOOP_NODE_TYPE_NOT_SUPPORTED`）。其他节点类型的迭代语义未明确，后续如需扩展须先澄清并提范围扩展 change。
- Recipe YAML 已冻结 `loop` 子字段（`loop_cardinality`/`loop_completion_condition`/`loop_input_data_item`/`loop_element_variable`/`loop_result`），见 `docs/Recipe YAML.md`；本 change 只实现并消费 DSL，不得调整字段名、结构语义或默认规则。
- loop 退出条件求值复用 `exclusive-gateway` 的 condition evaluator，不新增第二套 evaluator。
- 结果聚合按 `loop_result.loop_result_type`（Map/List）聚合各迭代输出。
- 当 `maxBatchSize` 设置时按批并发调度，等待当前批次全部响应后才进入下一批；未设置时保持默认串行执行。批量仅由 loop 驱动，用于 `restful` 节点对同一 API 按入参列表的批量查询场景。
- 批内部分失败按 `batch_failure_strategy` 处理：`FAIL_ALL`（默认）全部失败终止，`PARTIAL_SUCCESS` 传递成功内容继续；全部失败进入节点失败优先级链（retry -> exception -> onError -> FAILED）。
- 不支持嵌套循环（Recipe YAML 明确"不支持嵌套循环"）。

契约输入：

- `WorkflowNodeDef` 保持 opaque，`loop` 私有 schema 由本 change owner，不冻结 core 强类型。

实现约束：

- loop 语义不得回写到 `engine-contracts` 或 `execution-engine` 最小主线。
- loop 的 durable recovery / snapshot / resume 由 `add-ts-workflow-persistence-recovery` 承接。
- loop 的分布式并行迭代由 `add-ts-workflow-distributed-execution` 承接。
- 不改变现有节点 handler 的单次执行契约；loop 透明地包裹单次执行。
- 不新增 recipe source、dispatch path、pending store 或 stream owner。

非目标：

- 嵌套循环
- loop body 内的 sub-recipe 嵌套循环
- `restful` 以外节点类型的 loop（knowledge-qa、llm 族、capability 族、interaction 族等暂不支持）
- loop 的 durable recovery / 分布式并行迭代

验收要点：

- integration test：loop 正常迭代、退出条件命中、结果聚合（Map/List）
- integration test：不支持嵌套循环时明确拒绝
- integration test：非 `restful` 节点声明 loop 被拒绝（`WORKFLOW_LOOP_NODE_TYPE_NOT_SUPPORTED`），仅 `restful` 节点接受 loop
- architecture test：loop 透明包裹单次执行，节点 handler 不感知循环
- integration test：`maxBatchSize` 按批并发执行，批次内全部响应后才进入下一批
- integration test：`batch_failure_strategy=FAIL_ALL` 批内部分失败终止并进入失败优先级链
- integration test：`batch_failure_strategy=PARTIAL_SUCCESS` 批内部分失败时传递成功内容继续聚合

并行边界：

- 本 change 只 owner 节点级 loop 迭代驱动、上下文绑定、退出条件求值和结果聚合。
- `exclusive-gateway` condition evaluator 被复用，不重建。
- 各节点 handler 只感知单次迭代执行，不自行实现循环。
