# FN-9.4 执行能力节点

> 能力域 D9 Workflow 编排 · 子域 [D9.2 节点与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-9.2](../../../features/D9-Workflow编排/D9.2-节点与恢复/F-9.2-工作流节点.md) |
| 主规格 | `workflow-capability-nodes` |
| 接口 | 系统内部，节点处理器 |

## 描述

执行 Capability 节点，调用统一受治理边界并把唯一最终成功、降级、失败或取消结果交给 Workflow。

## 前置条件

- 工作流正在执行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 节点定义 | 是 | 能力节点定义 |
| 节点输入 | 是 | 节点输入数据 |

## 输出

节点执行结果（能力调用结果）。

## 处理过程

1. 节点处理器解析能力节点定义。
2. 将节点声明的 retry 次数作为同一次逻辑 Capability 调用的额外 attempt 上限；未配置时使用统一缺省。
3. 调用受治理 Capability；节点不对边界已返回的最终失败执行第二层自动重试。
4. 成功/降级形成节点结果，失败保留 `safeError` 并上升，取消直接传播。
5. `tool-choice` 只在 bounded candidate set 中选择 tool 并产出 `selectedToolId`/`mappedArguments`，不执行 side effect；现存 `tool_choice` 兼容解析到标准 `tool-choice`。
6. `restful` 节点配置了非空 `batchConfig` 时，对 `batchInputDataItem` 每个元素独立调用 capability：`serial` 模式按 `batchSize` 分组串行执行，`parallel` 模式用 worker pool 由 `batchParallelism` 直接控制元素级并发度；按 `batchFailStrategy` 决定 `continue`（失败元素入 `failed_items` 继续）或 `abort`（未启动元素跳过，已启动允许完成），产出 `batch_results`/`failed_items`/`api_response`。
7. `python` 节点优先通过 `WorkflowSandboxExecutionPort.runPython` 直接经 sandbox gateway 执行预定义脚本，不经 `python` capability 路径、不触发 nl2py guardrail；port 未注入时 fallback 到 `capabilityInvocation`，变量声明作为 `preamble` 字段传递、`code` 只含用户 `script`。
8. `restful` 节点 `open_reflection=true` 时参数追问反思创建 pending input 暂停流程；reflection pending input 超时 resume 时（`resumeState.answers === undefined`）防御性抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不重新调用模型创建新 reflection pending input，由 engine exception 分支处理或终态化 `FAILED`。
9. 经状态接口与运行时协作，返回结果。

## 结果

- 正常：节点执行完成。
- 失败：安全失败。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 最终失败后的节点自动重放 | 0 次；retry 只发生在统一调用边界返回最终结果之前 | `workflow-capability-nodes`：`Capability 节点上升统一最终失败` |
| tool-choice 无副作用 | 只在 bounded candidate set 中选择，产出 `selectedToolId`/`mappedArguments`，不执行 tool；现存 `tool_choice` 兼容解析 | `workflow-capability-nodes`：`Tool Choice Node` |
| restful batch 并发模型 | `parallel` 模式用 worker pool，`batchParallelism` 直接控制元素级并发度（默认 5、上限 20），不受 `batchSize` 约束；`serial` 模式按 `batchSize` 分组串行 | `workflow-capability-nodes`：`Restful Batch Execution` |
| restful batch 失败策略 | `continue` 失败元素入 `failed_items` 继续、节点不失败；`abort` 未启动元素跳过、已启动允许完成、节点 `NODE_FAILED` | `workflow-capability-nodes`：`Restful Batch Execution` |
| restful batch 产物 | `batch_results`（append 按 index 或 map 按 key）、`failed_items`（index/item/safe error）、`api_response`（最后元素结果） | `workflow-capability-nodes`：`Restful Batch Execution` |
| python 节点执行路径 | 优先经 `WorkflowSandboxExecutionPort.runPython` 直接通过 sandbox gateway 执行预定义脚本，不经 `python` capability、不触发 nl2py guardrail；port 未注入时 fallback 到 `capabilityInvocation` | `workflow-capability-nodes`：`Python Node` |
| python 节点 preamble 隔离 | fallback 路径下变量声明作为 Python capability input 的 `preamble` 字段传递，`code` 只含用户 `script`；变量声明 MUST NOT 拼进 `code`，nl2py guardrail 不检查 `preamble` | `workflow-capability-nodes`：`Python Node` |
| restful reflection 超时 | `open_reflection=true` 时参数追问反思创建 pending input；超时 resume 时（`resumeState.answers === undefined`）抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），不创建新 reflection pending input，走 exception 分支或 `FAILED` | `workflow-capability-nodes`：`Restful Node` |
