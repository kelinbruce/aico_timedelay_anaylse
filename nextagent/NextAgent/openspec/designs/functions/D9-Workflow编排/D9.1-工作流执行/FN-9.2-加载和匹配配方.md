# FN-9.2 加载和匹配配方

> 能力域 D9 Workflow 编排 · 子域 [D9.1 工作流执行](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-9.1](../../../features/D9-Workflow编排/D9.1-工作流执行/F-9.1-执行工作流.md) |
| spec | `workflow-contracts`、`workflow-routing` |
| 接口 | 系统内部，配方加载与匹配 |

## 描述

系统启动期加载本地配方，运行时按显式标识或意图识别匹配配方，无法匹配时回退对话循环或安全拒绝。directive 定向的 `targetRecipe` 和有效用户问题由 FN-2.8 在 request acceptance 前生成，本 Function 不重新解析 directive。

## 前置条件

- 配方已加载。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 配方标识 | 否 | 显式指定的配方 |
| 请求意图 | 否 | 用于意图识别的请求 |

## 输出

匹配的配方。

## 处理过程

1. 启动期加载本地配方。
2. 运行时按显式标识或意图识别匹配。
3. 无法匹配时回退对话循环或安全拒绝。

## 结果

- 正常：匹配到配方。
- 无匹配：回退对话循环或安全拒绝。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 单智能体最大配方数 | 50 | 建议评审值 | 建议补充 |
| 配方匹配超时 | 1,000 ms 确定性，5,000 ms 模型辅助 | 建议评审值 | 建议补充 |
| 配方路径归属 | `<paths.agentRoot>/{agentId}/recipes/`（默认 `agents/{agentId}/recipes/`），只允许 workspace 内相对路径 | 稳定 | `workflow-package`：`Recipe Path Ownership` |
| 配方能力发布 | 静态 Recipe 资源作为 `WORKFLOW` capability descriptor 发布到当前 Agent Scope 的 capability catalog | 稳定 | `workflow-package`：`Local Recipe Loading` |
