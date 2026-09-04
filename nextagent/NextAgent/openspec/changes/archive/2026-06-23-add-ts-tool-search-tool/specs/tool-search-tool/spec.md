## ADDED Requirements

### Requirement: ToolSearch 只搜索受治理的可见 Tool 元数据

系统 SHALL 将 `ToolSearch` 暴露为一个只搜索当前 run 受治理且可见的 Tool 元数据的查询 Tool。它 MUST NOT 扫描外部来源、安装 Tool、扩大授权或定义 capability 冲突解决。

#### Scenario: ToolSearch 返回可见的安全元数据
- **WHEN** model 以有效的 query 调用 `ToolSearch`
- **THEN** 系统只搜索当前可见的受治理 Tool 的安全元数据
- **AND** 返回有界且稳定的结果。

#### Scenario: 隐藏的 Tool 不被披露
- **WHEN** 存在匹配的 Tool 但对当前 Agent/run 不可见
- **THEN** ToolSearch MUST NOT 返回或揭示该 Tool。

### Requirement: ToolSearch 披露保留既有 model Tool Calling

当可信 app 配置设置 `tool-disclosure-mode=tool-search` 且 `ToolSearch` 可用时，系统 SHALL 暴露 `ToolSearch`，而不移除、重排或改写在同一 Agent/run 中原本可见的受治理 model Tool Calling 条目。基于 ToolSearch 的披露 MAY 增加请求本地的已激活 Tool schema，但 MUST NOT 以 ToolSearch 模式本身作为理由隐藏既有的 model 可见 Tool schema。当该开关缺失或设置为 `list` 时，系统 MUST 保持既有受治理的非 ToolSearch Tool schema 披露行为，且除非另一个可信的基于 ToolSearch 的披露模式要求，ToolSearch MUST NOT 出现在 model Tool Calling 集合中。

#### Scenario: ToolSearch 模式保留预设 Tool Calling
- **WHEN** 当前 Agent 拥有在 ToolSearch 启用前可见的受治理 model 可调用 Tool
- **AND** 可信 app 配置设置 `tool-disclosure-mode=tool-search`
- **AND** `ToolSearch` 可用
- **THEN** model input 包含 `ToolSearch`
- **AND** 每个既有可见的 model Tool Calling 条目保持可见，且 descriptor 语义不变。

#### Scenario: List 模式保留默认 Tool 披露
- **WHEN** 未配置任何 Tool 披露模式
- **AND** 当前 Agent 拥有受治理的 model 可调用 Tool
- **THEN** ToolSearch 的可用性 MUST NOT 单凭自身将非 eager 的 Tool schema 从 model input 中隐藏
- **AND** ToolSearch 的可用性 MUST NOT 单凭自身将 `ToolSearch` 加入 model Tool Calling 集合。

#### Scenario: 搜索结果激活有界 Tool schema
- **WHEN** model 调用 `ToolSearch` 并返回匹配的可见 Tool
- **THEN** 返回的 Tool ID 被加入请求本地的允许 Tool 上下文
- **AND** 下一次 model 调用可以在保持既有 model Tool Calling 条目不变之外，包含这些已激活的 Tool schema。

### Requirement: Skill descriptor 披露可由可信 app 配置设置为 ToolSearch 延迟

系统 SHALL 为 Skill descriptor 披露提供一个可信 app 配置开关。默认模式 MUST 通过在 system prompt 中渲染可见的 model 可调用 Skill descriptor 来保持既有行为。当该开关设置为 `tool-search` 模式时，系统 MUST 从 system prompt 中省略完整 Skill descriptor 列表，只在一个 `available-deferred-skills` 块中渲染延迟的 Skill ID，并允许 `ToolSearch` 除 Tool 元数据之外还搜索安全的受治理 Skill 元数据。该开关 MUST 由 app composition 拥有，MUST NOT 由 client 请求体、model 输出、Skill manifest 元数据或 capability 参数控制。

#### Scenario: 默认 Skill 披露保持基于列表
- **WHEN** 未配置任何 Skill 披露模式
- **THEN** 可见的 model 可调用 Skill descriptor 被渲染在 system prompt 中
- **AND** `ToolSearch` 只搜索 Tool 元数据。

#### Scenario: ToolSearch 模式渲染延迟 Skill ID 并让 ToolSearch 找到 Skill
- **WHEN** 可信 app 配置将 Skill 披露模式设置为 `tool-search`
- **THEN** system prompt 不渲染完整 Skill descriptor 列表
- **AND** 它在一个 `available-deferred-skills` 块中渲染可见的延迟 Skill ID，但不渲染 Skill 描述、正文内容、来源细节或可执行指令
- **AND** `ToolSearch` 可以返回可见的 model 可调用 Skill 的有界安全元数据
- **AND** 返回的 Tool 结果仍激活请求本地的 Tool schema，而返回的 Skill 结果不扩大 Tool schema，且必须通过 `Skill` 工具加载。

### Requirement: ToolSearch 延迟的 Skill 要求加载前进行请求本地发现

当 Skill 披露被 ToolSearch 延迟时，系统 SHALL 将 `ToolSearch` 的 Skill 结果视为请求本地的已发现 Skill 引用。延迟的 Skill MUST NOT 通过 `Skill` 工具加载，除非该 Skill 已通过当前请求本地的 capability 上下文被发现。Capability descriptor MAY 携带可选的披露 policy 元数据和安全搜索提示；policy 元数据 MUST 是可信的 descriptor 元数据，MUST NOT 由 client 请求体、model 输出或 Skill 工具参数控制。

#### Scenario: ToolSearch 将返回的 Skill 标记为已发现
- **WHEN** `ToolSearch` 在 `tool-search` 模式下返回可见的 model 可调用 Skill 元数据
- **THEN** 返回的 Skill ID 被加入请求本地的已发现 Skill 上下文
- **AND** 只搜索或返回安全的 Skill 元数据和安全搜索提示。

#### Scenario: ToolSearch 延迟的 Skill 在发现前不能被加载
- **WHEN** model 对一个不在请求本地已发现 Skill 上下文中的延迟 Skill 调用 `Skill`
- **THEN** Skill 正文 MUST NOT 被加载
- **AND** 结果 MUST 安全失败，不揭示隐藏的 provider 或来源细节。

#### Scenario: Eager Skill 保持可直接加载
- **WHEN** 一个受治理的 Skill descriptor 显式声明 eager 披露
- **THEN** 该 Skill 可以按可信披露 policy 保持可见或直接可加载
- **AND** 它 MUST NOT 要求先经过一次 `ToolSearch` 发现步骤。
