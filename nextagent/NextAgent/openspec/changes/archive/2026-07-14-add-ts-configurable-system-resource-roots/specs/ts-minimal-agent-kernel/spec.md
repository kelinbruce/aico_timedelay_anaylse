## ADDED Requirements

### Requirement: App Config 支持运维者本地资源根

`agent-app/config` SHALL 允许可信 system configuration 通过 `paths.agentRoot` 和 `paths.skillRoot` 为 Agent package 和系统 Skill 设置本地资源根。内建 `default-system.yaml` SHALL 声明 `paths.agentRoot: "agents"` 和 `paths.skillRoot: "skills"`。当任一字段被 overlay 或 test fixture 省略时，系统 SHALL 像以前一样从 app config 根推导同样的默认根：Agent package 为 `agents`，系统 Skill 为 `skills`。

由此产生的 `DefaultSystemConfig.paths.agentsRoot` 和 `DefaultSystemConfig.paths.systemSkillsRoot` SHALL 保持为由 app composition 拥有的规范化绝对路径。Runtime、core、context、model、capability、gateway 和 channel package MUST NOT 解析 raw path 配置或环境变量。

#### Scenario: 配置本地资源根

- **WHEN** application config 设置 `paths.agentRoot: "../configured-agents"` 和 `paths.skillRoot: "../configured-skills"`
- **THEN** app config 校验 MUST 把规范化后的绝对根冻结到 `DefaultSystemConfig.paths` 下
- **AND** Agent package 发现 MUST 使用 `paths.agentsRoot`
- **AND** 系统 Skill 发现 MUST 使用 `paths.systemSkillsRoot`
- **AND** 被省略的字段 MUST 保留既有的 `agents` 和 `skills` 默认值。

#### Scenario: 打包的默认 Agent 根

- **WHEN** 一个本地 runtime release package 被组装
- **THEN** 该 package MUST 包含 `agents/default-agent/agent.yaml`
- **AND** 打包的 `config/default-system.yaml` MUST 声明 `paths.agentRoot: "agents"` 和 `paths.skillRoot: "skills"`。

#### Scenario: 不安全的本地资源根被拒绝

- **WHEN** 配置的本地资源根与 runtime 执行根、runtime 数据根、sqlite storage 根或 shared-data 根重叠
- **THEN** app config 校验 MUST 在 startup 返回 ready 的 `DefaultSystemConfig` 之前 fail closed。

### Requirement: App Config 支持 RAG 索引环境引用

`agent-app/config` SHALL 允许 `rag.indexes` source configuration 使用 `env:<NAME>`。该 env 引用 SHALL 由 app config source loader 在 schema 校验之前解析，并被规范化为既有的冻结 `DefaultSystemConfig.rag.indexes` 字符串数组形态。

env 值 MAY 是逗号分隔的 RAG index 名称列表，或是 RAG index 名称的 JSON 字符串数组。application overlay 中为空或未解析的 env 值 MUST 被忽略，以保持既有默认 `rag.indexes` 继续生效。raw `env:` 字符串 MUST NOT 泄漏到下游组件。

#### Scenario: 来自环境变量的 RAG 索引

- **GIVEN** `rag.indexes: env:RAG_INDEXES`
- **AND** `RAG_INDEXES=local,remote-netops`
- **WHEN** `agent-app/config` 解析默认 system config source
- **THEN** `DefaultSystemConfig.rag.indexes` MUST 等于 `["local", "remote-netops"]`
- **AND** 下游 package MUST 只消费冻结后的字符串数组。

#### Scenario: RAG 索引环境值缺失时保持默认值

- **GIVEN** `rag.indexes: env:RAG_INDEXES`
- **AND** `RAG_INDEXES` 未设置或为空
- **WHEN** app config 校验运行
- **THEN** startup MUST 使用既有默认 RAG 索引保持 ready
- **AND** 下游 package MUST NOT 收到 raw `env:RAG_INDEXES` 值。
