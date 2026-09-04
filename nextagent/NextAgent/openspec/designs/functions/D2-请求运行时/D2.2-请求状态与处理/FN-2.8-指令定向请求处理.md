# FN-2.8 指令定向请求处理

> 能力域 D2 请求运行时 · 子域 D2.2 请求状态与处理 · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 主规格 | `directive-capability-routing` |
| 覆盖特性 | [F-2.1](../../../features/D2-请求运行时/D2.1-请求提交与控制/F-2.1-提交请求.md) |
| 接口 | 已接受请求的输入投影 |

## 描述

系统从已接受输入中识别有效 `$skill:` 或 `$workflow:` directive，生成唯一的受治理路由目标和不含已解释 directive 的有效用户问题。

## 前置条件

- 已建立可信 Agent Scope、Owner Scope 和 schema-valid 路由约束。

## 输入

用户 submit 或 edit 文本及不包含 target 字段和 Tool-call 数量预算的 typed routing constraints。

## 输出

有效用户问题及可选的 `targetSkill` 或 `targetRecipe` 结构化约束。

## 处理过程

1. 系统识别并校验输入中的 capability directive。
2. 对有效且无冲突的 directive，系统生成唯一结构化路由目标，并从有效用户问题中移除已识别 token。
3. 对非法或冲突 directive，系统不生成可执行目标，进入安全拒绝或受治理澄清路径。
4. Web request schema 只接收安全非目标 allow-list，拒绝 target fields、Tool-call 数量预算和未知字段。
5. retry 与 recovery 复用已保存的有效问题和结构化目标；edit 对新输入重新解析。

## 结果

- Workflow、模型输入、可见历史和后续上下文只消费有效用户问题。
- Skill/Workflow 路由只消费受治理结构化目标。
- 非法 metadata 或 directive 不降级为无约束执行。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 支持的 directive | `$skill:<name>`、`$workflow:<name>` | `directive-capability-routing`：`Natural Language Capability Directives` |
| 有效解析结果 | 生成唯一受治理路由目标，并从有效用户问题中移除全部已识别 directive token | `directive-capability-routing`：`Directive Mapping to Routing Constraints`、`Directive 生成有效用户问题` |
| 冲突处理 | 相同目标可归一为一个；不同或跨类型目标必须安全拒绝或进入受治理澄清，不得静默选择 | `directive-capability-routing`：`Directive Conflict Handling` |
| Web request routing constraints | 只接受安全非目标 allow-list；无 capability target 和 Tool-call 数量预算 | `directive-capability-routing`：`Agent Web Requests Do Not Carry Target Directives` |
