# FN-6.7 脱敏

> 能力域 D6 安全与治理 · 子域 [D6.3 交互与信息安全](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-6.6](../../../features/D6-安全与治理/D6.3-交互与信息安全/F-6.6-脱敏.md) |
| spec | `redaction-policy` |
| 接口 | 系统内部，观测边界 |

## 描述

系统在日志、指标、追踪和审计输出前应用统一脱敏策略，控制高基数字段，不泄漏敏感信息。脱敏策略按输出边界拆分：external/observation surface 继续强制统一安全投影，local runtime diagnostic 由 canonical `runtime-logging` 定义窄 credential/token 脱敏策略，prompt、路径、命令和普通业务内容不脱敏。

## 处理过程

1. Observation 和 external safe output 经过 `ObservabilityProjectorHost` 共享边界的统一 redaction，fail closed。
2. Canonical `runtime-logging` 识别 local special field（`toolInput`、`toolOutput`、`modelInput`、`modelOutput`、`rawExceptionData`），应用窄 credential/token 脱敏和容量约束；prompt、路径、命令、stdout、stderr 和普通业务内容保持可诊断。
3. 两类 surface 不共享 raw field，也不允许 `diagnosticDetail=debug` 配置改变隔离结果。
4. 高基数字段降级处理。

## 结果

- 正常：观测输出脱敏完成。
- 本地 runtime diagnostic：保留故障根因和业务执行内容，credential/token 被清除。
- External/observation：继续满足既有安全契约，不消费 local special field。

## 规格

| 规格项 | 规格值 | 状态 | 来源 |
|---|---|---|---|
| 密钥/凭证泄露次数 | 0 | 已定义 | 安全红线 |
| 高基数字段阈值 | 单属性 <= 100 个不同值/10 分钟 | 建议评审值 | 建议补充 |
| Local runtime diagnostic 脱敏 | 只窄匹配清除 password/secret/API key/authorization/cookie/credential value 和认证类 token；保留 `credentialRef`、`credentialStatus`、usage token count 及 prompt/path/command/business content | 稳定 | `redaction-policy`：`Redaction is enforced by the shared observation boundary` |
| External/observation 隔离 | local special field 不进入 Web API、stream、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`；`debug` 模式不改变隔离结果 | 稳定 | `redaction-policy`：`Redaction is enforced by the shared observation boundary` |
