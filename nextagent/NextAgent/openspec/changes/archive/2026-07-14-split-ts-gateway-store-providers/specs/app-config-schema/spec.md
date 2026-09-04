## MODIFIED Requirements

### Requirement: 内建默认值与用户 application config 组合成两个冻结根

系统 SHALL 把 `packages/agent-app/config/default-system.yaml` 当作内部默认 system configuration source，而不是用户可编辑的配置文件。用户 system configuration MAY 通过 `application.yaml` 提供；当该文件存在时，它是 `default-system.yaml` 之上的 overlay，且其所在目录定义冻结的 `configRoot`。

最终冻结配置 SHALL 暴露两个用户可理解的根：

- `configRoot`：配置输入根，包含 `application.yaml`、`skills/` 和 `agents/`。
- `workspaceRoot`：runtime 输出根，包含 runtime 数据、SQLite 数据、日志、执行 workspace 状态和其他 runtime 状态。

`paths.workspaceRoot` 是该模型中唯一面向用户的路径条目。`paths.systemSkillsRoot`、`paths.agentsRoot`、`paths.workingMemorySqliteFile`、`paths.longTermMemorySqliteFile`、`paths.sqliteFile`、`paths.runtimeWorkspaceRoot`、`paths.executionRoot` 以及其他任何执行根路径条目 MUST NOT 被接受为可写的用户路径条目。App composition SHALL 派生：

- `systemSkillsRoot = configRoot/skills`
- `agentsRoot = configRoot/agents`
- `workingMemorySqliteFile = workspaceRoot/data/system/working-memory.sqlite`
- `longTermMemorySqliteFile = workspaceRoot/data/system/long-term-memory.sqlite`
- `sqliteFile = workspaceRoot/data/system/nextagent.sqlite`
- `runtimeWorkspaceRoot = workspaceRoot/execution`

`runtimeWorkspaceRoot` 是执行文件根的物理基底。它 MUST 只在 `workspaceRoot` 被规范化并冻结之后派生。它 MUST NOT 来自用户 config、客户端输入、model 输出、Skill metadata、capability 参数或 gateway 响应。

本 change 约束的 runtime 目录布局 SHALL 为：

```text
<workspaceRoot>/
  data/
    system/
      working-memory.sqlite
      long-term-memory.sqlite
      nextagent.sqlite
  execution/
    <scope-key>/
      workspace/
      .nextagent/
        skills/
          <skillProjectionKey>/
            <skill-name>/
              scripts/
              references/
              assets/
      temp/
        <run-key>/
```

该布局只定义执行文件根所要求的目录和 provider 拥有的 SQLite 位置。其他 runtime 输出 MAY 只在由其自身 spec 拥有时存在，且 MUST NOT 与 `execution/`、SQLite 父目录、配置根、provider 私有根或 source 私有根重叠。

当规范化或由 realpath 派生的 `runtimeWorkspaceRoot` 与 `dataDir`、`systemDataDir`、SQLite 父目录、`configRoot/skills`、`configRoot/agents`、provider 私有 source 根或 source 私有 Skill/package 根重叠时，startup 校验 SHALL fail closed。当 `runtimeWorkspaceRoot` 已经以文件、symlink、junction、reparse point 形式存在，或解析到规范化 `workspaceRoot` 之外时，startup 校验也 SHALL fail closed。

raw `capabilityProviders.providers` MUST NOT 作为框架或保留 provider 的 `default-system.yaml` 或 `application.yaml` 条目。内建和保留 provider（例如 `builtin-tools`、`builtin-skills`、`builtin-agents`、`local-skills-system`、`local-skills-agent-owned`、`local-agents`、`local-subagents` 和 `memory-tools`）是由 `agent-capability` 从可信内部贡献、外部 owner 贡献和 config 驱动的 provider 输入组装的 owner 拥有的 startup provider 贡献。内部和外部 owner 贡献在 config 驱动的 provider 配置被规范化之前已知，因此用户 config 无法覆盖保留 provider 身份。`agent-app` MUST NOT 维护一份单独的手写框架/保留 provider 列表作为权威 provider registry。

#### Scenario: application.yaml 叠加 default-system.yaml
- **WHEN** startup 提供一个用户 `application.yaml`
- **THEN** app composition MUST 把它作为内部 `default-system.yaml` 之上的 overlay 应用
- **AND** 产生的冻结配置 MUST 使用 `application.yaml` 所在目录作为 `configRoot`
- **AND** 缺失的用户字段 MUST 继续来自内部默认 source

#### Scenario: 派生路径不是用户路径条目
- **WHEN** 用户配置包含任何内部派生的 SQLite 路径、`paths.systemSkillsRoot`、`paths.agentsRoot`、`paths.runtimeWorkspaceRoot`、`paths.executionRoot` 或其他执行根路径条目
- **THEN** startup 校验 MUST 安全地拒绝该输入
- **AND** app composition MUST 继续只从冻结的 `configRoot` 和 `workspaceRoot` 派生这些路径

#### Scenario: Runtime workspace root 从 workspaceRoot 派生
- **WHEN** 最终 system config 冻结 `paths.workspaceRoot`
- **THEN** app composition MUST 把 `runtimeWorkspaceRoot` 派生为 `<workspaceRoot>/execution`
- **AND** 执行 `scopeBase` 值 MUST 创建在该派生根之下
- **AND** 全部三个 SQLite 文件 MUST 保持在 `<workspaceRoot>/data/system/` 之下
- **AND** 执行根 MUST 遵循 `<workspaceRoot>/execution/<scope-key>/{workspace,.nextagent,temp/<run-key>}`

#### Scenario: Runtime workspace root 不与系统数据重叠
- **WHEN** startup 校验派生的 runtime 路径
- **THEN** `runtimeWorkspaceRoot` MUST 与 `dataDir`、`systemDataDir` 和 SQLite 父目录相互独立
- **AND** `runtimeWorkspaceRoot` MUST NOT 解析到规范化 `workspaceRoot` 之外
- **AND** 不安全的文件、symlink、junction、reparse point 或重叠目录 MUST 以安全诊断 fail closed

#### Scenario: default-system 不声明框架 provider
- **WHEN** 内建默认值和用户 overlay 被规范化
- **THEN** 框架和保留 capability provider MUST 只从可信 owner 贡献组装
- **AND** raw config MUST NOT 成为这些 provider 的权威 registry
