# FN-5.1 管理能力目录

> 能力域 D5 Capability 能力体系 · 子域 [D5.1 能力治理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-5.1](../../../features/D5-Capability能力体系/D5.1-能力治理/F-5.1-统一能力治理.md) |
| 主规格 | `capability-source-configuration` |
| 遗留规格 | `capability-catalog` |
| 接口 | 系统内部，能力目录 |

## 描述

系统统一管理工具、技能和子智能体的发现、可用性判断、归属绑定和冲突治理。

## 前置条件

- 能力已注册。

## 输入

能力来源（内置/本地/远端/插件）。

## 输出

能力描述符（含类型、可用性、归属）。

## 处理过程

1. 系统从各来源发现能力。
2. 判断可用性和归属绑定。
3. 处理冲突和影子能力。
4. 模型只看到当前请求范围内可用的能力。
5. 自定义能力来源必须显式接入能力治理；模型接入配置不会自动注册或授权任何能力。

## 结果

- 正常：能力目录构建完成。
- 能力不可用：标记不可用，不展示给模型。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Capability 类型 | `TOOL`、`SKILL`、`AGENT` | `capability-catalog`：`Capability Governance Uses The Existing Unified Contracts` |
| 可用性门禁 | Capability 必须属于当前 Agent、已启用且可用，并且不存在未解决的名称冲突 | `capability-catalog`：`Catalog Owns Registration Gates And Availability Verdict` |
| 冲突处理 | 无法唯一解析的同名 Capability 从可见和可执行结果中排除，不按注册顺序选择 | `capability-catalog`：`Catalog Owns Registration Gates And Availability Verdict` |
