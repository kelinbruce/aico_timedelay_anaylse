# FN-3.1 编写智能体配置

> 能力域 D3 Agent 装配与主链路 · 子域 [D3.1 智能体装配](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-3.1](../../../features/D3-Agent装配与主链路/D3.1-智能体装配/F-3.1-装配智能体.md) |
| spec | `agent-package-assembly` |
| 接口 | `agents/{agentId}/agent.yaml` 配置文件 |

## 描述

开发者编写配置文件声明智能体的模型、提示词、能力、策略和运行参数。

## 前置条件

- 开发者有智能体包目录访问权限。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| agentId | 是 | 智能体标识 |
| agentVersion | 是 | 智能体版本 |
| modelProfile | 是 | 模型配置 |
| promptTemplate | 是 | 提示词模板 |
| capabilityBinding | 是 | 能力绑定 |
| runtimeSettings | 否 | 运行参数，如每轮工具调用上限 |

## 输出

智能体配置已注册，等待启动期编译。

## 处理过程

1. 开发者在智能体包目录下编写配置文件。
2. 配置文件声明模型、提示词、能力、策略和运行参数。
3. 启动期扫描配置文件并注册。

## 结果

- 正常：配置注册成功。
- 配置无效：安全失败，提示错误。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Packaged Agent definition 单一来源 | 本地运行包只把 packaged Agent definition 暂存到 `agents/{agentId}/agent.yaml`；pack flow MUST NOT 暂存或保留 `config/default-agent.yaml` duplicate，startup 从已验证 system config 和 `agents/` root 选择 active Agent | `local-runtime-package`：`Local runtime package has a stable responsibility layout` |
