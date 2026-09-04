## MODIFIED Requirements

### Requirement: Attachment 请求上下文流由 runtime 拥有并被显式校验

系统 SHALL 把携带 attachment 的请求上下文视为 runtime 拥有的流，它从请求接受开始，一直延续到 model 调用前的同步 context assembly。Submit request、retry latest 和 edit latest 都 MUST 在请求被接受进入执行之前触发相同的 owner 作用域和 agent 作用域 attachment 授权检查。

请求接受之前，runtime SHALL 使用当前 `tenantId`、`subjectId` 和可信 `agentId`，对照权威的 `RequestAttachment` 事实解析每个 `attachmentId`。除非每个被引用的 attachment 都是 owner 作用域、agent 作用域、绑定到已接受的 session/request 可见性、`validationStatus=ACCEPTED` 且 `availabilityStatus=AVAILABLE`，否则该请求 SHALL 被拒绝。

接受成功后，runtime/session 所有权 SHALL 把该请求的最终 attachment 引用集持久化到不可变的 root user message 或等价的单一权威 message 事实中。该持久集合 SHALL 是 retry latest、attachment context assembly 和 attachment cleanup 引用保护所消费的唯一权威。该持久集合 SHALL 只包含 `attachmentIds`。

对于 edit latest，为新请求写入的 attachment 集合 SHALL 表示编辑后请求的最终 attachment 引用集，而不是隐式的"先前集合加上新上传 attachment"的合并。Retry latest SHALL 只从被重试请求的不可变 root message 读取 attachment 引用。

Context Engine SHALL 只在当前 request/run 的同步 context build 期间消费 attachment。它 SHALL 使用 owner scope 和 agent scope 重新读取权威 attachment 事实，并按规则顺序将每个 attachment 分类为 `latest-request-critical`、`latest-request-optional`、`historical` 或 `excluded`。它 SHALL NOT 把客户端 payload、message metadata 副本、model 输出或 capability 参数当作 attachment 文件名、类型、大小、状态或存储引用的权威。

#### Scenario: 带有效 Markdown attachment 的请求提交进入上下文流

- **WHEN** 用户提交一个带有一个 owner 作用域且 agent 作用域的 Markdown attachment 的请求，该 attachment 具有 `validationStatus=ACCEPTED` 和 `availabilityStatus=AVAILABLE`
- **AND** 该 attachment 直接绑定到当前请求
- **AND** 当前 assembly 中尚未保留该 attachment 的等价受控替代
- **THEN** runtime 只在权威 attachment 校验成功后才接受该请求
- **AND** runtime/session 将被接受请求的最终 attachment 引用集持久化到不可变的 root user message
- **AND** Context Engine 在 context build 期间同步重新读取该 attachment
- **AND** 该 attachment 变得有资格进行 model 可见的 descriptor 或受控内容投影

#### Scenario: Retry latest 在调度前重新校验原始 attachment 引用

- **WHEN** retry latest 针对一个已 terminal commit 的请求，其不可变 root message 仍引用先前的 attachment
- **THEN** runtime 在 retry 请求被接受之前重新校验这些 attachment 引用
- **AND** 如果任何 attachment 不再是权威、可用、owner 作用域或 agent 作用域，runtime 拒绝该 retry
- **AND** runtime MUST NOT 静默移除缺失的 attachment 并继续

#### Scenario: Edit latest 在创建新请求前重新校验编辑后的 attachment 集合

- **WHEN** edit latest 重新提交一个带有 attachment 引用的最新已结束请求
- **THEN** runtime 在接受之前对照权威 attachment 事实校验编辑后的请求
- **AND** 新的不可变 root user message 只存储编辑后请求的最终 attachment 引用集
- **AND** 如果任何被引用的 attachment 未通过授权、校验或可用性检查，新请求被拒绝
- **AND** 用户收到一个显式的安全失败，而不是隐式的纯文本编辑

#### Scenario: Retry latest 只读取持久化的 attachment 集合

- **WHEN** retry latest 从一个已 terminal commit 的请求创建
- **THEN** runtime 只从被重试请求的不可变 root message 或等价的单一权威 message 事实读取 attachment 引用
- **AND** runtime MUST NOT 从上传入口的临时状态、瞬态 command 缓存或后续 cleanup 诊断重建 attachment 集合

### Requirement: Attachment 上下文分类与预算保护遵循固定规则

Context Engine SHALL 以固定的规则顺序决定 attachment 上下文分类，而不是把该决定留给实现细节。

一个 attachment SHALL 由确定性的请求事实而非自由形式的语义推断分类为 `latest-request-critical`。只有当以下全部为真时，它才是 `latest-request-critical`：

- 它直接绑定到当前请求；
- 它保持 owner 作用域、agent 作用域、可用，并被批准用于受控 context 消费；
- 当前 assembly 尚未为同一 `attachmentId` 保留等价的受控摘录、Markdown 投影或已批准 ref。

一个绑定到当前请求但仅因已存在等价受控替代而不满足 critical 条件的 attachment SHALL 被分类为 `latest-request-optional`。一个只通过可见 history 出现的 attachment SHALL 被分类为 `historical`。一个 owner scope、agent scope、session/request 可见性、可用性、可见 history 资格或受控消费前置条件不满足的 attachment SHALL 被分类为 `excluded`。

`latest-request-critical` attachment 上下文 SHALL 是最小安全当前请求上下文的一部分。它 SHALL NOT 为了迁就 history 预算而被静默省略、静默截断或静默降级。Historical attachment 上下文和非关键的当前请求 attachment 上下文 MAY 在预算或读取约束需要时显式降级。

#### Scenario: 等价的已保留摘录阻止 critical 升级

- **WHEN** 当前请求引用一个 attachment
- **AND** 当前 assembly 已包含同一 `attachmentId` 的等价受控摘录、Markdown 投影或已批准 ref
- **THEN** 原始 attachment 的大内容不被分类为 `latest-request-critical`
- **AND** 该请求可以继续使用已保留的受控替代

#### Scenario: Historical attachment 保持在先前 history 竞争之内

- **WHEN** 一个 attachment 只能通过可见的先前会话到达
- **THEN** Context Engine 将它分类为 `historical`
- **AND** 它只在先前 history 预算内竞争
- **AND** 它可以被摘要、缩减为仅元数据投影，或以显式降级 evidence 省略

#### Scenario: 隐藏先前轮次的 attachment 不能绕过可见 history 规则

- **WHEN** 一个先前会话轮次被可见 history 规则排除，例如替换或不完整轮次过滤
- **THEN** 只源自该轮次的 attachment 上下文也被排除
- **AND** Context Engine MUST NOT 单独提取该 attachment 来绕过可见 history 边界

### Requirement: 缺失的关键 attachment 上下文显式失败，非关键损失显式降级

如果最小安全当前请求上下文因 `latest-request-critical` attachment 不可用、不可读、被删除、过期、跨 owner、跨 agent、无安全包含方式地超预算，或缺失所需受控投影而无法组装，系统 SHALL 在 model 调用之前返回一个显式的 insufficient-context 或安全失败结果。

如果一个 `latest-request-optional` 或 `historical` attachment 因预算压力、读取失败、缺失受控投影或依赖尚未启用而无法消费，系统 MAY 显式降级为一个已保留的受控替代、仅元数据投影、省略或安全通知。该流 SHALL NOT 生成新的 attachment 摘要或新的长期 ref。此类降级 SHALL 产生机器可读的 reason evidence，并在改变用户对答案完整性的合理预期时对用户可见。

#### Scenario: Latest-request-critical attachment 在 context build 期间变为不可用

- **WHEN** Context Engine 在同步 context build 期间重新校验一个当前请求关键的 attachment
- **AND** 该 attachment 不再可读、不再可用、不再是 owner 作用域或不再是 agent 作用域
- **THEN** context assembly 以 insufficient-context 或安全失败显式失败
- **AND** runtime MUST NOT 像该请求是纯文本一样调用 model

#### Scenario: 当前非关键 attachment 在预算压力下显式降级

- **WHEN** 一个当前请求 attachment 被分类为 `latest-request-optional`
- **AND** 完整的受控投影会超出可用上下文预算
- **THEN** 系统可以将其替换为一个已保留的受控替代、仅元数据投影或省略
- **AND** 降级原因被记录为机器可读 evidence
- **AND** 如果降级影响答案完整性，runtime 投影一条展示安全的通知

#### Scenario: Historical attachment 读取失败不会无声消失

- **WHEN** 一个 historical attachment 在 context build 期间无法读取
- **THEN** 系统只可以通过显式降级继续
- **AND** 它记录一个描述省略或回退的 reason code
- **AND** 它不会在没有可追溯 evidence 的情况下静默丢弃该 attachment

### Requirement: Attachment 上下文 artifact 保持可追溯且安全

Attachment 上下文 MAY 产生 descriptor、受控 Markdown 内容投影、attachment 上下文决策和降级 evidence。它可以消费由其他 capability 产生的已批准受控 ref，但该流 SHALL NOT 创建新的独立摘要/ref 生成机制。这些 artifact SHALL 可追溯到源头的 `attachmentId` 和当前请求上下文决策，但 SHALL NOT 通过 safe error、用户可见 stream payload、audit 细节或结构化日志暴露 raw 存储 handle、本地文件系统路径、provider SDK handle 或原始 attachment payload。

`BlobRef` 和等价的存储引用 SHALL 保持在 attachment runtime 和 gateway 边界内部。Model 可见的 attachment 上下文 SHALL 只包含安全 descriptor、受控内容投影或被批准用于 context 消费的受控 ref。

#### Scenario: Context assembly 发出可追溯的安全 attachment artifact

- **WHEN** 一个 attachment 被选中用于 context 消费
- **THEN** Context Engine 发出一个可追溯到源头 `attachmentId` 的安全 descriptor 或受控投影
- **AND** 发出的 artifact 不包含 blob ref、本地路径或原始存储坐标

#### Scenario: 降级 evidence 对下游消费者是安全的

- **WHEN** attachment 上下文被摘要、缩减、省略或失败
- **THEN** 系统发出带有安全 reason code 或安全摘要的机器可读降级 evidence
- **AND** 该 evidence 可被 runtime 通知投影、可观测性或后续审查消费
- **AND** 它不暴露原始 attachment 内容或敏感存储细节
