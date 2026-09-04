# invocation-audit Specification

## Purpose
TBD - 由归档 change add-ts-capability-invocation-audit 创建。归档后更新 Purpose。
## Requirements
### Requirement: Capability invocation audit 使用 app 组合的 audit 路径

Capability invocation audit SHALL 通过 TS 后端使用的 app 组合 audit 路径来表示。capability executor、capability catalog、risk policy、sandbox 边界和 provider adapter MAY 通过内部实现 DTO 暴露权威的调用事实和安全分类，但 capability 实现 MUST NOT 直接写入 audit 记录、定义私有 audit schema，或在 `agent-contracts` 下新增 public audit SPI/DTO contract。

#### Scenario: Executor 拥有的调用结果成为 audit 输入
- **WHEN** 一次 capability 调用启动、完成、失败、被拒绝、超时、被取消、被禁用或未找到
- **THEN** capability executor 边界向 `agent-app` 组合的 observability wrapper 提供 owner 安全的调用事实
- **AND** `agent-observability` 通过 app 组合的 audit 路径构造并写入 audit 事件
- **AND** 本 change MUST NOT 在 `agent-contracts` 下新增 `CapabilityAuditInput`、`IAuditBoundary` 或等价的 public SPI/DTO contract

#### Scenario: 启动与执行前拒绝在 executor 边界被审计
- **WHEN** 一次调用在 provider 执行之前进入 executor 边界
- **THEN** 当所需的 owner 安全标识存在时，executor 提供一个非终态的 started audit 事实
- **AND** 在 provider 执行之前发生的拒绝、禁用、未找到或 executor 不可用会产生一个安全的终态 audit 事实
- **AND** capability 实现自身不发出这些事实

#### Scenario: Capability 实现不绕过 audit sink
- **WHEN** 一个具体的内建、local、API 后端、ToolBank 或可执行 capability 执行工作
- **THEN** 它向 executor 边界返回一个受治理的调用结果
- **AND** 它不调用 audit sink，也不定义 audit 专用输出字段

### Requirement: 调用 audit 事实使用稳定的业务标识

每个 capability 调用 audit 事实 SHALL 使用稳定的业务标识作为主要关联 key。对已进入 executor 边界的调用，所需的 owner 安全输入是 `tenantId`、`subjectId`、`sessionId`、`requestId`、`runId`、`requestContextId`、`capabilityInvocationId`、`capabilityId`、`agentId`、`agentVersion`、status、outcome 和发生时间。`providerId`、`providerKind` 等 provider 字段在 descriptor 已解析后是必需的。安全的 reason code、时延、可重试性、result ref 和 artifact ref 在存在且权威时被包含。

如果当前调用阶段缺失某个必需的 owner 安全输入，系统 SHALL 对 audit 路径 fail closed，并产生有界的 audit 降级证据，而不是伪造占位标识。

Trace 或 span 标识 MAY 由 observability 层作为补充诊断字段附加，但它们 MUST NOT 取代稳定的业务标识，也 MUST NOT 成为 capability 调用 audit contract 的必需项。

#### Scenario: 缺失的可选标识被省略
- **WHEN** 一次 capability 拒绝发生在可选调用 ref 被分配之前
- **THEN** audit 输入只包含已经权威的标识
- **AND** 系统不伪造占位 id

#### Scenario: 缺失的必需标识只降级 audit
- **WHEN** 一次 capability 调用到达 executor 边界，但该阶段缺失某个必需的 owner 安全标识
- **THEN** capability 执行结果和 request 终态事实仍由 executor/runtime 结果治理
- **AND** audit 路径记录有界的降级证据，而不发出不安全或伪造的标识

### Requirement: 每次调用只有单一终态 audit 事实

单次 capability 调用 SHALL 至多拥有一个终态 audit 事实。终态 audit 结果包括 completed、failed、denied、timed out、canceled、aborted、disabled 和 not found。迟到的结果或重复的完成信号 MUST NOT 改写终态 audit 事实；它们 MAY 产生有界的安全降级证据。

#### Scenario: 超时后的迟到结果只作为诊断
- **WHEN** 一个 capability 结果在调用已经产生超时终态 audit 事实之后到达
- **THEN** 终态 audit 事实保持不变
- **AND** 迟到的结果只作为安全诊断或降级证据表示

### Requirement: 调用 audit 只记录安全摘要与引用

Capability 调用 audit MUST 在发出前通过统一脱敏 policy。Audit 输出 MUST NOT 包含原始 tool 参数、原始 tool 结果、原始 model 输入、原始 model 输出、原始 provider 响应、原始 sandbox stdout/stderr、原始附件内容、原始大内容、原始本地路径、secret、credential、token、stack trace、完整 manifest、完整 Skill 内容或未授权的对象内容。

允许的 audit 细节是有界的安全摘要、reason code、调用 status、capability/provider 身份、低基数分类、时延、可重试性、result ref 和 artifact ref。

#### Scenario: 可执行 capability 的输出被摘要
- **WHEN** 一个可执行 capability 返回 stdout、stderr、生成的文件或 sandbox 错误
- **THEN** invocation audit 只记录安全结果、有界的长度/分类、安全 ref 和 reason code
- **AND** 不发出原始命令输出、本地路径和原始 sandbox 错误正文

#### Scenario: Provider 后端 capability 失败是安全的
- **WHEN** 一个 API 后端或远程 capability source 因原始 provider 响应而失败
- **THEN** invocation audit 记录安全类别、reason code、可重试性和有界时延
- **AND** 省略原始 provider 正文和携带 credential 的细节

### Requirement: Skill 与嵌套调用 audit 保持最小且受控

Skill 调用、按需 Skill 内容披露和嵌套调用 SHALL 使用同一个 app 组合的 capability 调用 audit 路径。Skill audit 事实 SHALL 只记录安全关联字段，例如调用 id、存在时的父调用 id、session/run/request ref、capability id、skill id、provider id、provider kind、执行模式、status、安全终态摘要、安全 ref、生成消息计数、生成消息角色、meta 标记和有界长度。

Skill audit MUST NOT 包含完整 Skill 清单、原始 content ref、原始本地路径、原始 manifest、原始 Skill 内容、生成消息内容、fork 出的 transcript、原始 model 输入/输出、原始 tool 参数/结果、stack trace 或完整结果 payload。

当一个面向 model 的内建 `Skill` tool 调用解析为目标 Skill capability 调用时，audit MAY 记录该 tool 调用 id 与目标 Skill 调用 id 之间 owner 安全的关联。该关联 MUST NOT 引入第二个 public 调用信封，并 MUST NOT 包含原始 `args`、原始 Skill 内容、原始 source ref、原始 manifest 内容或 fork 出的 transcript。

#### Scenario: 内联 Skill 生成消息被摘要
- **WHEN** 一次内联 Skill 调用产生隐藏的生成消息
- **THEN** audit 只记录计数、角色、meta 标记和有界长度
- **AND** 不发出生成消息内容

#### Scenario: Fork 的嵌套调用被关联但不合并 transcript
- **WHEN** 一次 fork 的嵌套调用到达终态结果
- **THEN** audit 记录父调用 id、嵌套调用 id、执行模式、status、安全终态摘要和安全 ref
- **AND** fork 的会话 transcript 和原始 model/tool 内容保持在 audit 输出之外

#### Scenario: Skill tool 目标解析被安全关联
- **WHEN** 一个面向 model 的内建 `Skill` tool 调用解析为目标 Skill 调用
- **THEN** audit 可以把 tool 调用 id 和目标 Skill 调用 id 记录为安全关联字段
- **AND** 不发出原始 Skill 参数、原始 Skill 内容、原始 source ref、原始 manifest 内容和 fork 出的 transcript

### Requirement: 调用 audit 失败是显式且不阻塞的

Audit sink 不可用、写入超时、序列化失败、脱敏失败或缺失必需 owner 安全字段 MUST NOT 改变 capability 调用结果、request 终态事实或 session 历史。系统 SHALL 对不安全的 audit 内容 fail closed，并产生显式的 audit 降级证据。

#### Scenario: capability 成功后 audit 写入失败
- **WHEN** 一次 capability 调用成功，但 audit sink 无法写入对应的 audit 事件
- **THEN** 调用结果仍由 capability executor 结果治理
- **AND** 系统记录有界的 audit 降级证据，而不发出不安全内容

### Requirement: 调用 audit 只作为治理证据被消费

Capability 调用 audit 记录是治理证据和诊断导航辅助。它们 MUST NOT 作为 authoritative source 被用于 capability 可用性、调用 status、幂等 replay 资格、request 终态 status、session 历史、checkpoint 状态或 artifact 所有权。

#### Scenario: audit 与调用结果不一致
- **WHEN** audit 诊断看起来与权威的 capability 调用结果或 runtime 事实不一致
- **THEN** 权威的 capability/runtime/gateway 事实仍是事实来源
- **AND** audit 诊断被视为降级或不完整的证据

