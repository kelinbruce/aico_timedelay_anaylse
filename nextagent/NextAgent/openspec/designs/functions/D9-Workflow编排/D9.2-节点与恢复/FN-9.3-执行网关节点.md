# FN-9.3 执行网关节点

> 能力域 D9 Workflow 编排 · 子域 [D9.2 节点与恢复](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-9.2](../../../features/D9-Workflow编排/D9.2-节点与恢复/F-9.2-工作流节点.md) |
| spec | `workflow-gateway-nodes`、`workflow-parallel-gateway` |
| 接口 | 系统内部，节点处理器 |

## 描述

执行网关与并行网关节点：网关节点按条件路由，并行网关节点并行分叉与汇合。

## 前置条件

- 工作流正在执行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 节点定义 | 是 | 网关或并行网关节点定义 |
| 节点输入 | 是 | 节点输入数据 |

## 输出

节点执行结果（路由决策或并行分支汇合结果）。

## 处理过程

1. 按节点类型分发到网关或并行网关处理器。
2. 网关按条件路由，并行网关并行分叉并汇合。
3. 经状态接口与运行时协作，返回结果。

## 结果

- 正常：节点执行完成。
- 失败：安全失败。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 并行分支模型 | 单进程并行分叉与汇合，无恢复 | 已定义 | `workflow-parallel-gateway` |
| 网关无业务 payload | `start-event` / `end-event` / `exclusive-gateway` 的 `WorkflowNodeResult.output` 恒为 `undefined`；生命周期事件只含安全摘要 | 已定义 | `workflow-gateway-nodes` |
| exclusive-gateway 条件求值 | 按 `next` 声明顺序首真分支命中，全部 false 时走最后一个 `condition: ""` fallback，无 fallback 则失败；condition evaluator 只读 `contextVariables` | 已定义 | `workflow-gateway-nodes` |
| inclusive-gateway 别名 | `inclusive-gateway` 作为 `PARALLEL` 的 BPMN DSL 别名，由 recipe loader `normalizeNodeType` 映射，不引入新 node type，复用 `PARALLEL` handler 执行语义 | 已定义 | `workflow-gateway-nodes` |
