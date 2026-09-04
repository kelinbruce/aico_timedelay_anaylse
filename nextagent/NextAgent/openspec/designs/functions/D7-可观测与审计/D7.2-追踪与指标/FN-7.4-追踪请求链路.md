# FN-7.4 追踪请求链路

> 能力域 D7 可观测与审计 · 子域 [D7.2 追踪与指标](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-7.3](../../../features/D7-可观测与审计/D7.2-追踪与指标/F-7.3-链路追踪.md) |
| spec | `otel-observability-adapter`、`trace-log-linking`；在建 `add-otlp-trace-export` |
| 接口 | 系统内部，链路追踪 |

## 描述

系统追踪请求链路，关联日志和追踪，跨进程使用 W3C 标准。

## 前置条件

- 请求正在执行。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 请求标识 | 是 | 要追踪的请求 |

## 输出

链路追踪数据。

## 处理过程

1. 系统为请求建立追踪。
2. 关联日志和追踪。
3. 跨进程使用 W3C 标准传播。
4. 追踪标识不进入核心契约。

## 结果

- 正常：链路追踪数据可用。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 追踪采样率 | 错误 100%、正常 10% | 建议评审值 | 建议补充 |
| 本地运行包 developer hook trace 默认装配 | backend-capable 本地 `pack:release` 在包内 `config/default-system.yaml` 声明 `developer-hook-trace` 并在包内 default Agent 激活 `loop-raw-boundary`；不改源 Agent、不改非包内开发默认、不默认启用 `context-monitor` | 稳定 | `developer-hook-trace-logging`：`Local runtime packaging includes developer hook trace artifact with local release default activation`；`local-runtime-package`：`Local release packages stage developer diagnosis defaults in package configuration only` |
