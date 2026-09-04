## MODIFIED Requirements

### Requirement: App composition schema 暴露稳定的首版 group 基线

App composition 配置 schema SHALL 为首版暴露以下稳定的 group：

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

每个 group MUST 在配置边界下拥有稳定的 owning contract。后续变更 MAY 扩展某个 group 或其窄化的 owning-boundary 投影，但 MUST NOT 通过引入竞争性的 app 级配置事实来源绕过该基线。

本变更的 `observability` group SHALL 只暴露 `observability.logging.redaction`。该字段 MUST 是只允许两个取值的 string enum：`normal` 和 `debug`。缺省值表示 `normal` 模式。该字段 MUST NOT 被解释为关闭 redaction、关闭 safe error mapping 或允许 raw diagnostic 输出的开关。

本变更的 `rag` group SHALL 只暴露 `rag.indexes`。该字段是冻结的 app-composition 默认 logical index 列表，仅在 Tool input 省略 `indexes` 时供 builtin `rag` Tool 使用。它 MUST 包含 1-5 个唯一的 provider 中立 logical index 名称。每个名称 MUST 非空、不超过 128 个字符，且只使用启动校验接受的安全 logical-index 字符集。如果省略，启动校验 SHALL 推导出 `rag.indexes=["local"]`。该配置 MUST NOT 包含 provider 私有 index 绑定、endpoint、credential、workspace 路径、SQLite 路径、raw FTS 表达式或检索参数。

#### Scenario: 禁用或非活跃的配置分支保持非权威

- **WHEN** 某个配置条目被禁用或属于非活跃的 deployment 分支
- **THEN** 它 MAY 保留在源配置中
- **AND** MUST NOT 成为当前进程活跃已校验 runtime config 的一部分

#### Scenario: observability logging 默认为 normal 模式

- **WHEN** 启动校验一个省略 `observability.logging.redaction` 的配置源集合
- **THEN** 冻结的 runtime 配置 MUST 表现得如同 `observability.logging.redaction=normal`
- **AND** 启动 MUST NOT 从环境、logger sink 行为或运行期失败推断出 debug 模式

#### Scenario: RAG 默认 logical index 被冻结

- **WHEN** 启动校验一个带 `rag.indexes=["local", "remote-netops"]` 的配置源集合
- **THEN** 冻结的 runtime 配置 MUST 把这些值暴露为当前进程的 RAG 默认 logical index
- **AND** 下游 RAG Tool 组合 MAY 仅在 Tool input 省略 `indexes` 时使用它们
- **AND** runtime 请求、模型输出和 Tool input MUST NOT 变更已冻结的默认列表

#### Scenario: RAG 默认 logical index 失败关闭

- **WHEN** 启动校验一个带空、重复、超限或不安全 `rag.indexes` 的配置源集合
- **THEN** 启动校验 MUST 在 ready 状态前安全拒绝该输入
- **AND** 系统 MUST NOT 把无效值重新解释为 provider 私有 index 绑定或 host path
