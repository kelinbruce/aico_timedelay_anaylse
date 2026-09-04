## MODIFIED Requirements

### Requirement: 内建默认配置与用户应用配置组合成两个冻结根

系统 SHALL 把 `packages/agent-app/config/default-system.yaml` 视为内部默认系统配置源，而不是用户可编辑的配置文件。用户系统配置 MAY 通过 `application.yaml` 提供；当该文件存在时，它是 `default-system.yaml` 之上的 overlay，其所在目录定义冻结的 `configRoot`。

最终冻结的配置 SHALL 暴露两个用户可理解的根：

- `configRoot`：配置输入根，包含 `application.yaml`、`skills/` 和 `agents/`。
- `workspaceRoot`：运行时输出根，包含运行时数据、SQLite 数据、日志、执行 workspace 状态和其他运行时状态。

`paths.workspaceRoot` 是该模型中唯一面向用户的路径条目。`paths.systemSkillsRoot`、`paths.agentsRoot`、`paths.sqliteFile`、`paths.runtimeWorkspaceRoot`、`paths.executionRoot` 以及任何其他执行根路径条目 MUST NOT 被接受为可写的用户路径条目。App composition SHALL 派生：

- `systemSkillsRoot = configRoot/skills`
- `agentsRoot = configRoot/agents`
- `sqliteFile = workspaceRoot/data/system/nextagent.sqlite`
- `runtimeWorkspaceRoot = workspaceRoot/execution`

`runtimeWorkspaceRoot` 是执行文件根的物理基座。它 MUST 只在 `workspaceRoot` 被规范化并冻结之后派生。它 MUST NOT 从用户配置、客户端输入、model 输出、Skill metadata、capability 参数或 gateway 响应读取。

本 change 约束的运行时目录布局 SHALL 是：

```text
<workspaceRoot>/
  data/
    system/
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

该布局只定义执行文件根和既有 SQLite 位置所需的目录。其他运行时输出仅当由其自己的 spec 拥有时 MAY 存在，并 MUST NOT 与 `execution/`、SQLite 父目录、配置根、provider 私有根或 source 私有根重叠。

当规范化或由 realpath 派生的 `runtimeWorkspaceRoot` 与 `dataDir`、`systemDataDir`、SQLite 父目录、`configRoot/skills`、`configRoot/agents`、provider 私有 source 根或 source 私有 Skill/包根重叠时，启动校验 SHALL fail closed。如果 `runtimeWorkspaceRoot` 已以文件、symlink、junction、reparse point 形式存在，或解析到规范化 `workspaceRoot` 之外，启动校验也 SHALL fail closed。

原始 `capabilityProviders.providers` MUST NOT 作为框架或保留 provider 的 `default-system.yaml` 或 `application.yaml` 条目。诸如 `builtin-tools`、`builtin-skills`、`local-skills-system` 和 `local-skills-agent-owned` 这样的内建和保留 provider 是由启动 resource provider registry 注册的 app 组合事实。

#### Scenario: 派生路径不是用户路径条目

- **WHEN** 用户配置包含 `paths.systemSkillsRoot`、`paths.agentsRoot`、`paths.sqliteFile`、`paths.runtimeWorkspaceRoot`、`paths.executionRoot` 或任何其他执行根路径条目
- **THEN** 启动校验 MUST 安全地拒绝该输入
- **AND** app composition MUST 继续只从冻结的 `configRoot` 和 `workspaceRoot` 派生这些路径

#### Scenario: Runtime workspace root 从 workspaceRoot 派生

- **WHEN** 最终系统配置冻结 `paths.workspaceRoot`
- **THEN** app composition MUST 将 `runtimeWorkspaceRoot` 派生为 `<workspaceRoot>/execution`
- **AND** 执行 `scopeBase` 值 MUST 在该派生根之下创建
- **AND** SQLite MUST 保持在 `<workspaceRoot>/data/system/nextagent.sqlite` 之下
- **AND** 执行根 MUST 遵循 `<workspaceRoot>/execution/<scope-key>/{workspace,.nextagent,temp/<run-key>}`

#### Scenario: Runtime workspace root 不与系统数据重叠

- **WHEN** 启动校验派生的运行时路径
- **THEN** `runtimeWorkspaceRoot` MUST 与 `dataDir`、`systemDataDir` 和 SQLite 父目录分离
- **AND** `runtimeWorkspaceRoot` MUST NOT 解析到规范化 `workspaceRoot` 之外
- **AND** 不安全的文件、symlink、junction、reparse point 或重叠目录 MUST 以安全诊断 fail closed
