# FN-2.6 指定技能处理

> 能力域 D2 请求运行时 · 子域 [D2.2 请求状态与处理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-2.6](../../../features/D2-请求运行时/D2.2-请求状态与处理/F-2.6-指定技能处理.md) |
| 主规格 | `targeted-skill-routing` |
| 接口 | 提交时携带 `routingConstraints.targetSkill` 或 `$skill:` 指令 |

## 描述

用户提交请求时指定由某个 Skill 处理，系统校验可用性和权限后按指定 Skill 路由，并用统一 Capability 最终结果确定成功、失败或取消。

## 前置条件

- 用户已登录。
- 指定的技能可用且当前用户有权使用。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| routingConstraints.targetSkill | 是 | 指定的技能标识 |

## 输出

按指定技能路由处理。

## 处理过程

1. 系统校验指定技能的可用性、权限和智能体归属。
2. 校验通过后，通过受治理 Capability 边界调用指定 Skill。
3. 成功保留 Skill 结果；最终失败产生安全终止消息；取消产生取消终态。
4. 定向 Skill 不回退普通模型选路，也不对统一边界返回的最终失败执行第二层自动重试。
5. 记录路由证据。

## 结果

- 正常：按指定技能路由。
- 技能不可用：安全拒绝。
- 无权限：安全拒绝。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 定向 Skill lifecycle 身份 | started 与 completed 复用相同 `capabilityKind=TOOL`、`capabilityId=Skill`、已解析 `targetCapabilityId` 和 `toolCallId`；过程标题使用与普通 Skill 调用相同的"加载技能：<目标 Skill>"规则 | `targeted-skill-routing`：`定向 Skill 加载必须发布 Capability lifecycle facts` |
| 定向目标数量 | 每个请求至多一个受治理 target Skill | `targeted-skill-routing`：定向 Skill 路由约束 |
