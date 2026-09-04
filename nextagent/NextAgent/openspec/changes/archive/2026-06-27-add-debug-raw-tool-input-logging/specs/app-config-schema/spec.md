## MODIFIED Requirements

### Requirement: App composition schema 暴露稳定的首个 release 组基线

App composition 配置 schema SHALL 为首个 release 暴露以下稳定分组：

- `deployment`
- `paths`
- `identity`
- `channel`
- `hostedAgent`
- `modelProfiles`
- `adnclaw.system.capability-providers`
- `gateway`
- `observability`
- `rag`

每个分组 MUST 在配置边界下拥有稳定的所属 contract。后续 change MAY 扩展某个分组或其窄化的所属边界投影，但 MUST NOT 通过引入与之竞争的 app 级配置事实来源来绕过该基线。

本 change 的 `observability` 分组 SHALL 只暴露 `observability.logging.redaction`。该字段 MUST 是一个只允许两个值的字符串 enum：`normal` 和 `debug`。值缺失表示 `normal` 模式。在 `normal` 模式下，所有 runtime 日志字段 MUST 被净化。在 `debug` 模式下，tool-loop runtime 日志的 `toolInput` 字段 MAY 为诊断目的携带原始 tool 参数；`toolInputPreview` 和 `toolSafeSummary` 在所有模式下 MUST 保持净化。该字段 MUST NOT 被解读为一个可以关闭 safe error 映射、关闭 tool-loop runtime 日志中除 `toolInput` 之外字段的净化，或允许在 audit 事件、metric、trace、safe error 或 stream 投影中出现原始诊断输出的开关。

#### Scenario: 禁用或非活跃的配置分支保持非权威

- **WHEN** 一个配置条目被禁用或属于非活跃的部署分支
- **THEN** 它 MAY 保留在源配置中
- **AND** 它 MUST NOT 成为当前进程活跃的已校验 runtime config 的一部分

#### Scenario: observability logging 默认为 normal 模式

- **WHEN** 启动校验一个省略 `observability.logging.redaction` 的配置源集合
- **THEN** 冻结的 runtime 配置 MUST 表现得如同 `observability.logging.redaction=normal`
- **AND** 启动 MUST NOT 从 environment、logger sink 行为或 runtime 失败推断出 debug 模式

#### Scenario: debug 模式在 tool-loop 日志中启用原始 toolInput

- **WHEN** 冻结的 runtime 配置具有 `observability.logging.redaction=debug`
- **THEN** tool-loop runtime 日志条目 MAY 在 `toolInput` 字段中包含原始 tool 参数
- **AND** `toolInputPreview` 和 `toolSafeSummary` MUST 保持净化
- **AND** audit 事件、metric、trace、safe error 和 stream 投影 MUST 保持净化

#### Scenario: normal 模式净化所有 tool-loop 日志字段

- **WHEN** 冻结的 runtime 配置具有 `observability.logging.redaction=normal`
- **THEN** tool-loop runtime 日志条目 MUST 通过 runtime tool input sanitizer 净化 `toolInput`
- **AND** 任何日志字段中不得出现原始 tool 参数、路径、凭证、prompt 或高基数字段
