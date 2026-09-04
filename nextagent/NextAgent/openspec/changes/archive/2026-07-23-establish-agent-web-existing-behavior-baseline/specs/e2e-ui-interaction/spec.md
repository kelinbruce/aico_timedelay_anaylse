## MODIFIED Requirements

### Requirement: User Input Reply

系统 SHALL 在前端呈现 Composer，用户提交后通过 backend bootstrap 选择的 SSE 或 WebSocket transport 实时渲染模型回复。Transport 选择 MUST NOT 改变用户可见的 text delta、过程投影和 terminal 收敛语义。

#### Scenario: 问答交互使用当前 transport
- **WHEN** 用户在 Composer 输入问题并提交
- **THEN** 前端 SHALL 使用 backend bootstrap 选择的 Web stream transport 渲染回复
- **AND** SSE 与 WebSocket SHALL 产生等价的用户可见 stream 结果

### Requirement: SSE Stream Consumption

系统 SHALL 通过当前配置的 SSE 或 WebSocket transport 消费共享 `StreamEnvelope` 投影，包括 text delta、Capability/process entry 和 terminal event。

#### Scenario: 配置的 Web stream 被正确消费
- **WHEN** backend bootstrap 选择 SSE 或 WebSocket 且 request 产生 stream events
- **THEN** 前端 SHALL 实时合并 text delta
- **AND** SHALL 以当前过程视图呈现 Capability 生命周期
- **AND** terminal event SHALL 正确收敛 UI 状态

### Requirement: Tool Call Render

系统 SHALL 将 Capability/tool 执行呈现为可视化过程条目，展示名称和生命周期状态。有受支持的 `safeResult` 时，前端 SHALL 使用对应的结构化详情；没有受支持的 `safeResult` 或当前安全失败详情，但存在非空且非通用的 `safeSummary` 时，前端 SHALL 使用该摘要。缺少上述受支持安全字段时，本 capability 不定义或保证详情 fallback 行为。

#### Scenario: 工具调用展示当前投影
- **WHEN** 模型发起并完成一个 Capability/tool 调用
- **THEN** 前端 SHALL 展示调用名称和生命周期状态
- **AND** MAY 展示安全结构化投影产生的摘要或详情

#### Scenario: Safe result 优先于其他安全摘要
- **GIVEN** Capability result 包含当前支持的 `safeResult`
- **WHEN** 前端生成过程详情
- **THEN** SHALL 使用该结构化安全投影
- **AND** SHALL NOT 用同一事件的其他摘要覆盖它

#### Scenario: Safe summary 在没有受支持 safe result 时作为摘要
- **GIVEN** Capability result 不包含受支持的 `safeResult` 或当前安全失败详情，但包含非空且非通用的 `safeSummary`
- **WHEN** 前端生成过程详情
- **THEN** SHALL 使用该 `safeSummary` 作为摘要

### Requirement: Session Management UI

系统 SHALL 支持前端会话管理，包括进入新会话状态、首次提交时建立会话，以及切换、删除和重命名已有会话。新会话入口 SHALL 进入未持久化会话的 pre-session 状态；在该状态首次执行合法普通提交时，前端 MUST 先成功建立并激活会话，再把该输入作为该会话的首个 request 提交。会话建立失败时，前端 MUST NOT 提交 request，并 MUST 保留可重试的 Composer 输入。已有 active session 的普通提交 MUST 复用该会话且 MUST NOT 建立另一会话。附件选择、绑定和提交顺序继续由 `agent-web-attachment-composer` 拥有，本 requirement 不重新定义该路径。

#### Scenario: 新会话入口保持 pre-session 状态
- **WHEN** 用户进入新会话状态但尚未执行合法普通提交
- **THEN** 前端 MUST NOT 仅因进入该状态而持久化空会话

#### Scenario: 根路由首次普通提交先建立会话
- **GIVEN** 当前页面处于没有 active session 的 pre-session 状态
- **WHEN** 用户执行合法普通提交
- **THEN** 前端 MUST 先成功建立并激活一个会话
- **AND** MUST 再把该输入作为该会话的首个 request 提交

#### Scenario: 会话建立失败时保留输入
- **GIVEN** 当前页面处于没有 active session 的 pre-session 状态
- **WHEN** 用户执行合法普通提交但会话建立失败
- **THEN** 前端 MUST NOT 提交 request
- **AND** MUST 保留 Composer 输入供用户重试

#### Scenario: 已有会话不重复建立
- **GIVEN** 当前页面已有 active session
- **WHEN** 用户执行合法普通提交
- **THEN** 前端 MUST 在该 active session 中提交 request
- **AND** MUST NOT 为该提交建立另一会话

#### Scenario: 已有会话操作更新会话视图
- **WHEN** 用户切换、重命名或删除已有会话
- **THEN** 对应操作 SHALL 正确执行
- **AND** 会话视图 SHALL 反映操作结果

### Requirement: Auth Settings UI

系统 SHALL 支持当前 local auth 入口的登录、认证 challenge 恢复和登出。当前 sidebar settings SHALL 只提供已实现的语言与 light/dark/system 主题偏好。Agent Web SHALL NOT 在该要求下承诺不存在的 API Key 配置或模型选择 UI；模型与凭据配置由当前 runtime/app configuration owner 管理。

#### Scenario: 登录与登出更新认证状态
- **WHEN** 用户通过当前认证入口登录或登出
- **THEN** 前端 SHALL 更新认证会话状态
- **AND** 后续受保护请求 SHALL 使用当前认证状态

#### Scenario: 不呈现未实现的 API Key 和模型设置
- **WHEN** 用户打开当前认证相关 UI
- **THEN** Agent Web SHALL NOT 因本要求提供 API Key 配置或模型选择入口

#### Scenario: Local settings only expose current preferences
- **WHEN** 用户打开 local sidebar settings
- **THEN** Agent Web SHALL 提供语言与 light/dark/system 主题偏好
- **AND** SHALL NOT 把这些偏好误写成模型或凭据配置
