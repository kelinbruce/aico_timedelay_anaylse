## MODIFIED Requirements

### Requirement: App composition schema 暴露稳定的首个 release 分组基线

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

每个分组 MUST 在配置边界下拥有稳定的 owning contract。后续 change MAY 扩展某个分组或其狭义的 owning-boundary 投影，但 MUST NOT 通过引入竞争的 app 级配置事实来源来绕过该基线。

本 change 的 `observability` 分组 SHALL 只暴露 `observability.logging.redaction`。该字段 MUST 是一个只允许两个取值的 string enum：`normal` 和 `debug`。缺省值表示 `normal` 模式。该字段 MUST NOT 被解释为关闭脱敏、关闭 safe error 映射或允许原始诊断输出的开关。

#### Scenario: 禁用或非活跃的配置分支保持非权威

- **WHEN** 一条配置条目被禁用或属于非活跃 deployment 分支
- **THEN** 它 MAY 保留在源配置中
- **AND** 它 MUST NOT 成为当前进程活跃的已校验 runtime config 的一部分

#### Scenario: observability logging 默认为 normal 模式

- **WHEN** 启动时校验的配置源集合省略了 `observability.logging.redaction`
- **THEN** 冻结的 runtime 配置 MUST 表现得如同 `observability.logging.redaction=normal`
- **AND** 启动 MUST NOT 从环境、logger sink 行为或 runtime 故障推断出 debug 模式

### Requirement: 内建默认配置与用户应用配置组合成两个冻结根

系统 SHALL 把 `packages/agent-app/config/default-system.yaml` 视为内部默认系统配置源，而不是用户可编辑的配置文件。用户系统配置 MAY 通过 `application.yaml` 提供；当该文件存在时，它是 `default-system.yaml` 之上的 overlay，其所在目录定义冻结的 `configRoot`。

最终冻结的配置 SHALL 暴露两个用户可理解的根：

- `configRoot`：配置输入根，包含 `application.yaml`、`skills/` 和 `agents/`。
- `workspaceRoot`：运行时输出根，包含 workspace、SQLite 数据、日志和其他运行时状态。

`paths.workspaceRoot` 是该模型中唯一面向用户的路径条目。`paths.systemSkillsRoot`、`paths.agentsRoot` 和 `paths.sqliteFile` MUST NOT 被接受为可写的用户路径条目；它们被派生为 `configRoot/skills`、`configRoot/agents` 和 `workspaceRoot/data/system/nextagent.sqlite`。

原始 `capabilityProviders.providers` MUST NOT 作为框架或保留 provider 的 `default-system.yaml` 或 `application.yaml` 条目。诸如 `builtin-tools`、`builtin-skills`、`local-skills-system` 和 `local-skills-agent-owned` 这样的内建和保留 provider 是由启动 resource provider registry 注册的 app 组合事实。

本 change 的内建 `default-system.yaml` SHALL 携带默认值 `observability.logging.redaction=normal`。用户 `application.yaml` MAY 覆盖该字段。冻结配置 MUST 保留 overlay 之后最终的 enum 值，作为当前进程唯一权威的 logging-mode 输入。

#### Scenario: application.yaml 覆盖 default-system.yaml

- **WHEN** 启动时提供了一个用户 `application.yaml`
- **THEN** app composition MUST 将其作为内部 `default-system.yaml` 之上的 overlay 应用
- **AND** 得到的冻结配置 MUST 使用包含 `application.yaml` 的目录作为 `configRoot`
- **AND** 缺省的用户字段 MUST 继续来自内部默认源

#### Scenario: 派生路径不是用户路径条目

- **WHEN** 用户配置包含 `paths.systemSkillsRoot`、`paths.agentsRoot` 或 `paths.sqliteFile`
- **THEN** 启动校验 MUST 安全地拒绝该输入
- **AND** app composition MUST 继续只从冻结的 `configRoot` 和 `workspaceRoot` 派生这些路径

#### Scenario: default-system 不声明框架 provider

- **WHEN** 产品组合加载内建 `default-system.yaml`
- **THEN** 该文件 MUST NOT 包含原始 `capabilityProviders.providers`
- **AND** app 就绪 MUST NOT 依赖 `providerId=builtin-tools` 的用户原始配置条目
- **AND** 框架 provider MUST 通过启动 resource provider registry 事实注册

#### Scenario: 应用配置可以启用安全的 debug 日志

- **WHEN** 用户 `application.yaml` 设置 `observability.logging.redaction=debug`
- **THEN** 冻结的 runtime 配置 MUST 将当前进程的 logging 模式标记为 `debug`
- **AND** 启动 MUST NOT 把该设置重新解释为关闭脱敏或发出原始敏感字段的许可
