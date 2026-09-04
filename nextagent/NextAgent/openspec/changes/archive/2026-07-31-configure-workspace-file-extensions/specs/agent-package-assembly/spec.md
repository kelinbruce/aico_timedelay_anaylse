## ADDED Requirements

### Requirement: Agent-scoped file extension policy compilation

系统 SHALL 将可信 Agent definition 的四个 workspace file extension allowlist/denylist 编译为 app-private Agent/version scoped policy，保留字段缺省与显式空数组的差异，并通过 composition provider 注入文件 capability；系统 MUST NOT 修改或重新定义 frozen `AgentWorkspaceFilePolicy`。读取类操作 SHALL 仅使用读取 allowlist/denylist，写入类操作 SHALL 仅使用写入 allowlist/denylist；系统 MUST NOT 在两类策略之间自动合并或扩权。每类策略 MUST 按以下顺序判定目标最终后缀：命中 denylist 时拒绝；否则 allowlist 缺省时允许；否则仅在命中 allowlist 时允许。运行期 MUST 使用 accepted run 固化的 Agent/version 对应策略，MUST NOT 从默认 Agent、其他 Agent、Tool input、模型输出、客户端 metadata 或 capability 参数补充或扩大后缀授权。

#### Scenario: Read and write policies remain independent
- **WHEN** Agent 配置 `readAllowedExtensions: [".log"]` 和 `writeAllowedExtensions: [".json"]`
- **THEN** 读取授权 SHALL 仅允许 `.log`，写入授权 SHALL 仅允许 `.json`，compiler MUST NOT 把 `.json` 自动加入读取 allowlist

#### Scenario: Deny precedence is preserved in runtime policy
- **WHEN** `.json` 同时位于读取 allowlist 和读取 denylist
- **THEN** 编译后的 private policy MUST 保留两个事实，读取判定 MUST 拒绝 `.json`

#### Scenario: Frozen workspace policy contract remains unchanged
- **WHEN** 系统编译任意 extension allowlist/denylist 配置
- **THEN** `AgentAssembly.workspacePolicy.files` 的 frozen shape MUST 保持不变，extension policy MUST 仅由 app-private provider 提供

#### Scenario: Accepted Agent scope is authoritative
- **WHEN** 两个 Agent 对同一后缀配置不同授权并分别接受 request run
- **THEN** 每个 run 的文件 Tool MUST 仅使用其固化 Agent/version 的策略且缓存不得跨 Agent/version 复用
