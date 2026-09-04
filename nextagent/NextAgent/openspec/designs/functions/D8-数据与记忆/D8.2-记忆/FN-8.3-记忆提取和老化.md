# FN-8.3 记忆提取和老化

> 能力域 D8 数据与记忆 · 子域 [D8.2 记忆](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-8.2](../../../features/D8-数据与记忆/D8.2-记忆/F-8.2-长期记忆.md) |
| 主规格 | `memory-extraction` |
| 遗留规格 | `memory-aging` |
| 接口 | 系统内部，后台 schedule、受控管理或测试触发 |

## 描述

系统在请求终态关键路径之外提取跨请求、跨会话长期记忆，并通过老化生命周期管理 retained memory。提取和老化子配置缺省均启用，但只在有效记忆配置和对应 backend 条件满足时运行。

## 前置条件

- 记忆配置有效且对应的提取或老化能力处于有效启用状态。
- 本地后台 lifecycle 仅在选择 local memory backend 时运行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 请求轨迹集合 | 否 | 提取周期查询到的受治理任务轨迹 |
| 记忆分区 | 否 | 老化周期处理的 Owner Scope 与 Agent Scope 分区 |

## 输出

提取的记忆或老化结果。

## 处理过程

1. 后台提取周期从请求轨迹的安全投影提取记忆，并在需要 LLM 时使用与主路径一致的受治理模型选择和提示词规则。
2. 后台提取保持独立执行身份，不伪造请求运行状态或改变已完成请求。
3. 若老化已启用，按生命周期管理记忆老化。
4. 提取和老化不阻塞请求终态。

## 结果

- 正常：记忆提取或老化完成。
- 显式关闭或前置条件不满足：返回安全 `SKIPPED`/`FAILED` 结果，不执行对应周期。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 提取缺省策略 | `extraction.enabled=true`，`strategy=RULE_FIRST`；规则没有 accepted candidate 时才使用 LLM fallback | `memory-extraction`：`Extraction strategy and configuration` |
| 老化缺省策略 | `aging.enabled=true`，每日 00:00；记忆状态为 `ACTIVE`、`ARCHIVED` | `memory-aging`：`Background aging trigger and execution boundary`、`LongTermMemoryState lifecycle transitions` |
| 请求影响 | 提取和老化不延迟请求完成，也不改变已完成请求的结果 | `memory-extraction`：`Dreaming extraction input boundary`、`memory-aging`：`Background aging trigger and execution boundary` |
