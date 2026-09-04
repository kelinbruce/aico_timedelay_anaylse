## ADDED Requirements

### Requirement: Skill Manifest Tool 约束 SHALL 接受 canonical 与兼容列表形态

Skill manifest parser SHALL 保持 `allowed-tools` 作为 canonical 的顶层 tool allow-list 字段。parser SHALL 接受 `allowed-tools` 为空白分隔字符串或 YAML 字符串列表。parser SHALL 同时接受顶层 `tools` 作为 `allowed-tools` 的兼容别名。

当 `allowed-tools` 与 `tools` 同时以非空值声明时，parser SHALL 以非法 tool 约束诊断拒绝该 manifest。兼容别名 SHALL NOT 创建新的 public Skill metadata 字段；接受的值 SHALL 映射到既有 `allowedTools` Skill metadata。

#### Scenario: canonical YAML 数组 tool 约束可加载
- **WHEN** 某个 Skill manifest 把 `allowed-tools` 声明为包含 `Bash`、`Read` 和 `Agent` 的 YAML 列表
- **THEN** manifest 解析 SHALL 接受该 Skill。
- **AND** descriptor 映射 SHALL 通过既有 Skill metadata 暴露 `allowedTools: ["Bash", "Read", "Agent"]`。

#### Scenario: 兼容 tools 别名映射到 allowed tools
- **WHEN** 某个 Skill manifest 把 `tools` 声明为包含 `Bash`、`Read` 和 `Agent` 的 YAML 列表
- **THEN** manifest 解析 SHALL 接受该 Skill。
- **AND** descriptor 映射 SHALL 通过既有 `allowedTools` Skill metadata 暴露该列表。

#### Scenario: 冲突的 canonical 与别名字段被拒绝
- **WHEN** 某个 Skill manifest 声明了非空的 `allowed-tools`
- **AND** 同时声明了非空的 `tools`
- **THEN** manifest 解析 SHALL 以非法 tool 约束拒绝该 Skill。

### Requirement: Skill Manifest Denied Tool 约束 SHALL 接受列表形态

Skill manifest parser SHALL 接受 metadata `denied-tools` 为空白分隔字符串或 YAML 字符串列表。接受的值 SHALL 映射到既有 `deniedTools` Skill metadata。

#### Scenario: denied tools 列表可加载
- **WHEN** 某个 Skill manifest 把 `metadata.denied-tools` 声明为 YAML 列表
- **THEN** manifest 解析 SHALL 接受该 Skill。
- **AND** descriptor 映射 SHALL 通过既有 `deniedTools` Skill metadata 暴露该列表。
