# FN-6.9 引用密钥

> 能力域 D6 安全与治理 · 子域 [D6.3 交互与信息安全](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-6.8](../../../features/D6-安全与治理/D6.3-交互与信息安全/F-6.8-密钥安全配置.md) |
| 主规格 | `secret-configuration-boundary` |
| 接口 | 系统内部，密钥解析器 |

## 描述

系统通过密钥引用解析密钥，原始密钥不进入配置、日志、流、审计、指标或模型上下文。

## 前置条件

- 配置中使用密钥引用。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 密钥引用 | 是 | 环境变量或文件引用 |

## 输出

解析后的密钥。

## 处理过程

1. 模型配置只在二级 `modelProfiles[]` 父 provider 项保存 `credentialRef`；子模型和调用请求不携带 credential。
2. 系统只在访问目标外部依赖时解析密钥引用（环境变量或文件/加密信封）。
3. 原始密钥只用于调用，不进入配置、日志、流、审计、指标或模型上下文。
4. 密钥解析有缓存和失败隔离，并使用独立 key source。

## 结果

- 正常：密钥解析成功。
- 引用无效：安全失败。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Secret reference grammar | `env:<name>`、`file:<path>` | `secret-configuration-boundary`：`Product credentials use the frozen SecretReference grammar` |
| 密钥暴露边界 | 仅在可信依赖使用边界瞬态解析；原始密钥和引用路径不得进入配置投影、诊断或业务上下文 | `secret-configuration-boundary`：`Resolved secrets remain transient`、`Secret-derived outputs never expose secret material or reference paths` |
