# developer-hook-trace-logging Delta

## MODIFIED Requirements

### Requirement: SDK developer hook trace logging 由调用方拥有

SDK plugin SHALL 接受调用方提供的 log sink。SDK SHALL NOT 改变 app config，也 SHALL NOT 要求新的 host external。SDK SHALL 提供一个 formatter，把 developer hook trace entry 转换为单条 NDJSON 行。SDK MAY 提供一个写入调用方提供的 `logDirectory` 的 file sink helper；该 helper MUST 把目标文件保持在调用方提供的目录之下。

#### Scenario: Developer hook trace entry 包含打印时间
- **WHEN** `developer-hook-trace` 写入任何受支持的生命周期 hook 边界
- **THEN** NDJSON entry MUST 包含 `printedAt`
- **AND** `printedAt` MUST 是表示本地 trace 打印时间的 ISO-8601 时间戳字符串
- **AND** 该 entry MUST 保持原始 `boundary` 不变。

#### Scenario: Developer hook trace 只有一个生命周期 payload 位置
- **WHEN** `developer-hook-trace` 写入任何受支持的生命周期 hook 边界
- **THEN** 该 entry MUST 只在 `boundary` 中保留由 stage 拥有的业务 payload，包括模型 timing
- **AND** 它 MUST NOT 把 `boundary` 字段复制为顶层的 `raw*`、`modelFirstContentLatencyMs`、`modelE2ELatencyMs` 或 `modelE2ELatencySource` 字段
- **AND** 它 MUST NOT 从 trace 打印时间戳推导额外的模型时延。

#### Scenario: Developer hook trace 接受不带 timing 元数据的模型结果
- **WHEN** 既有 `agent-app` host 加载该 plugin artifact，并在不带 `firstContentLatencyMs` 或 `modelE2ELatencyMs` 的情况下调用 `AFTER_MODEL_RESULT` 边界
- **THEN** plugin MUST 写入该边界并返回 `PASS`
- **AND** 它 MUST NOT 要求配套修改 `agent-app` 或 `DefaultAgent` 的 timing 实现。
