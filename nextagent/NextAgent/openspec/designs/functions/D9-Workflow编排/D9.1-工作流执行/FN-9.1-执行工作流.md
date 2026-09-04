# FN-9.1 执行工作流

> 能力域 D9 Workflow 编排 · 子域 [D9.1 工作流执行](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-9.1](../../../features/D9-Workflow编排/D9.1-工作流执行/F-9.1-执行工作流.md) |
| 主规格 | `workflow-contracts` |
| 遗留规格 | `workflow-execution-engine`、`workflow-routing`、`workflow-output-parser-contract` |
| 接口 | 系统内部，工作流执行服务 |

## 描述

系统按统一 Recipe/FlowGraph 契约执行工作流，把任务组织成可追踪的执行流程，经状态接口与运行时协作。

## 前置条件

- 请求已路由到工作流。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 工作流标识与版本 | 是 | 按 `workflow-contracts` 的 RecipeDefinition 选择要执行的工作流 |
| 请求 | 是 | 触发工作流的请求 |

## 输出

工作流执行结果。

## 处理过程

1. 系统执行工作流流程，并只消费 Capability 调用边界交付的唯一最终结果。
2. engine 消费 `RecipeDefinition.runtime`：`runtime.timeout` 作为流程级超时（`runtime` 未定义时回退到 v1 `recipe.timeoutMs`），`runtime.defaultRetry` 作为节点重试默认值，`runtime.controlPolicy` 决定取消/回滚策略。
3. 节点重试按优先级链解析：节点级 `retry`（结构化）-> 节点级 `retryPolicy`（v1）-> `runtime.defaultRetry` -> `{ maxRetries: 0 }`；gateway 节点始终不重试。节点超时按优先级链解析：节点级 `timeout` -> 节点级 `timeoutMs`（v1）-> 无节点级超时。
4. 节点执行前校验 `dependsOn` 引用的节点均已完成，未完成时抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED`；不实现并行 DAG 调度。
5. 经运行时拥有的状态接口与运行时协作。
6. 待确认输入桥接到运行时的待确认输入生命周期。
7. Capability 最终失败不进入节点 retry；节点级异常转移统一走 `exception` 分支（不消费已废弃的 `onError`），无匹配 exception 时 Workflow 失败，取消直接中断。
8. 合法 `NODE_WAITING` 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING` 控制结果；无 pending context 时失败。
9. 工作流不拥有请求生命周期、取消、检查点或终态提交。

## 结果

- 正常：工作流执行完成。
- 失败：安全失败。
- 待确认：桥接到运行时待确认输入。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Capability 最终失败后的自动重试 | 0 次/节点最终失败；从节点收到最终 `CapabilityInvocationResult` 起，到进入 exception、cancel fallback failure 或 Workflow 失败结束 | `workflow-contracts`：`Workflow 节点重试不重放 Capability 最终失败` |
| output_parser 显示控制字段 | `show_title`/`show_content`（可见性）、`type`（TEXT/CHART/CHART_PRO/HTML/TABLE/PIU/DSL，映射 ToolMessageType）、`data`（覆盖序列化内容）、`message_level`（TITLE/DETAIL/ANSWER/EXPAND_PANEL，覆盖 answer-node 派生 level）、`show_aigc`（AIGC 标签透传）；output_parser 驱动路径仅在 `data` 或 `message_level` 存在时触发 | `workflow-output-parser-contract`：`Workflow output parser control configuration`、`Workflow output parser display type resolution`、`Workflow output parser data content override`、`Workflow output parser message level override`、`Workflow output parser AIGC label passthrough` |
| 工作流输出存储模型 | TS runtime 统一用 `TOOL_STRUCTURED_DELTA` timeline event 承载所有工作流输出展示；PIU 数据内联在 `content`；legacy HOFS/ZENITH 双存储路由不适用 | `workflow-output-parser-contract`：`Workflow output parser storage model deviation` |
| 引擎 runtime 配置消费 | `runtime.timeout` 流程级超时、`runtime.defaultRetry` 节点重试默认、`runtime.controlPolicy` 取消/回滚策略；`runtime` 未定义时回退 v1 | `workflow-execution-engine`：`Engine Consumes Runtime Config` |
| 节点重试解析优先级 | `retry` -> `retryPolicy` -> `defaultRetry` -> `{maxRetries:0}`；gateway 节点不重试 | `workflow-execution-engine`：`Node Retry Resolution` |
| 节点超时解析优先级 | `timeout` -> `timeoutMs` -> 无节点级超时 | `workflow-execution-engine`：`Node Timeout Resolution` |
| 节点异常转移 | 统一走 `exception` 分支，不消费已废弃的 `onError` | `workflow-execution-engine`：`OnError Deprecated In Engine` |
| RESTFUL SSE 流式模式 | `stream_type: "sse"` 经 CLIP `subscribe` 原语发起 SSE 流式调用；`NODE_OUTPUT_DELTA` 投影 `TOOL_STRUCTURED_DELTA`（LIVE_ONLY）、聚合结果 `CAPABILITY_RESULT_DELTA`（LIVE_ONLY）+ `TOOL_STRUCTURED_DELTA`（PERSISTED）、`CAPABILITY_COMPLETED` 保持 body-free；与 `batchInputDataItem`、`is_long_api` 互斥，未设置时行为不变 | `workflow-restful-sse`：`Restful SSE Stream Type`、`Restful SSE Mutual Exclusion` |
| dependsOn 前置校验 | 依赖节点未完成时抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED`，不实现并行 DAG 调度 | `workflow-execution-engine`：`DependsOn Validation` |
| 单节点并发批量调用 | `batchConfig` 适用 `RESTFUL`+`KNOWLEDGE_SEARCH`+`LLM_ROUTER`，loader 对所有节点类型统一归一化；batch 模式按 `batchMode`(serial/parallel)、`batchFailStrategy`(continue/abort)、`batchResultMerge`(append/map) 编排，per-element 通过 element context 注入变量隔离；`LLM_ROUTER` 强制非流式，`KNOWLEDGE_SEARCH` 空结果转 failed item；其他 LLM 族节点声明时报 `WORKFLOW_BATCH_UNSUPPORTED_NODE_TYPE` | `workflow-contracts`：`NodeBatchConfig`、`LoopBatchMutex` |
