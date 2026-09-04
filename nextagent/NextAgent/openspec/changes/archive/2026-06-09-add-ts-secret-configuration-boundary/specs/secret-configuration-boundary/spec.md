## ADDED Requirements

### Requirement: Active secret 引用在 ready 之前被校验
系统 SHALL 在 startup/bootstrap 期间、ready 状态发布或请求处理可用之前，校验 active 的携带凭据的 `SecretReference` 值。

该校验 SHALL 在 app configuration 校验流程内运行，并 SHALL NOT 创建单独的 secret readiness 状态。

#### Scenario: ready 状态被发布
- **WHEN** 系统发布其 app configuration readiness
- **THEN** active secret 引用校验已经完成
- **AND** 其安全 issue 贡献已经被包含进 `DefaultSystemConfig.configEvaluation` diagnostic 和 readiness 证据输入中

### Requirement: 产品凭据使用冻结的 SecretReference 语法
携带凭据的产品配置字段 MUST 使用现有的 `SecretReference` 语法，并 SHALL 只允许 `env:` 或 `file:` 引用。

原始 secret 值、内联凭据、`direct:` 值和 `none` 哨兵值 MUST NOT 进入产品配置、冻结的 runtime 投影、可见 diagnostic 或 model context。

#### Scenario: 直接配置了原始凭据
- **WHEN** 某个携带凭据的字段包含原始值而不是 `env:` 或 `file:` 引用
- **THEN** 启动校验 MUST 拒绝该 entry
- **AND** 产生的 safe issue MUST NOT 回显所提供的值

### Requirement: 拥有方 schema 定义 secret 校验范围
每个拥有方配置 schema SHALL 标识其携带凭据的 entry，并 SHALL 把它们的 active/inactive 和必需状态提供给 app configuration 校验流程。

secret 边界 SHALL NOT 推断 entry 关键性、可行集合、降级或最终 readiness。

#### Scenario: Secret 校验贡献一个失败
- **WHEN** 某个 active credential 引用无法被解析
- **THEN** secret 校验 MUST 产生一个 safe issue 贡献
- **AND** app configuration 校验 MUST 仍然是对最终 readiness 分类的唯一 owner

### Requirement: Active 与 inactive 引用使用不同的校验深度
所有声明的 credential 引用 MUST 通过语法校验。Active 引用还 MUST 在启动完成之前通过可解析性校验。Inactive 引用 SHALL NOT 仅仅为了确定当前可解析性而被读取。

#### Scenario: Inactive 文件引用不可用
- **WHEN** 某个 inactive 分支声明了一个语法有效但目标不可用的 `file:` 引用
- **THEN** secret 校验 MUST NOT 读取该目标
- **AND** 它 MUST NOT 为该引用创建当前启动的可解析性失败

### Requirement: 一个 app 组合的 resolver 同时服务校验和 runtime 注入
`agent-app` SHALL 为一次启动组合创建一个 resolver 实例。同一个 resolver 实例 SHALL 被用于 active 引用启动校验，并被注入到消费凭据的 adapter 或 provider。

下游消费者 MUST NOT 读取源配置、构造替代 resolver 或消费共享的 secret usage snapshot。

#### Scenario: 组合 model provider
- **WHEN** 启动校验和 model provider 组合完成
- **THEN** 两条路径使用同一个 app 组合的 resolver 实例
- **AND** model provider 通过其现有的窄 runtime 输入接收其 credential 引用

### Requirement: Active 引用在启动完成前可解析
Active `env:` 引用 MUST 解析到已存在且非空的环境变量。Active `file:` 引用 MUST 解析到已存在、可读且非空的文件。

缺失、为空、不可读、不受支持或 resolver 失败的结果 MUST 产生稳定的 safe issue code，并且 MUST NOT 被推迟到第一个请求。

#### Scenario: Active 环境变量为空
- **WHEN** 某 active 必需的 `env:` 引用解析到空值
- **THEN** secret 校验 MUST 在 ready 之前产生一个 safe issue 贡献
- **AND** 下游组合 MUST NOT 把该引用视为已校验

### Requirement: Secret 校验输出保持 app 内部且窄化
secret 校验 SHALL 只为 app configuration 校验流程产生 app 内部的 safe issue 贡献。

系统 MUST NOT 引入 `SecretReadinessState`、`SecretUsageSnapshot`、共享的 `SecretValidationResult` 或其他跨 package 的 secret artifact。

#### Scenario: 下游组合消费配置
- **WHEN** model、gateway、capability、local auth、readiness 或 release 组合消费配置输出
- **THEN** 它 MUST 使用其现有的 owner 定义的窄投影、被注入的依赖或 `ConfigValidationEvidence`
- **AND** 它 MUST NOT 消费共享的 secret artifact

### Requirement: Secret 派生输出永不暴露 secret 材料或引用路径
从 secret 校验派生的可见 diagnostic 和 runtime 输出 MUST NOT 暴露原始 secret 值、解密值、环境变量值、文件内容、完整的 `env:` 或 `file:` 引用字符串、本地 secret 路径、adapter 原生错误或 stack trace。

Safe issue MAY 包含稳定的 issue code、安全字段引用、引用种类、scope 和安全消息。

#### Scenario: Resolver 抛出不安全的内部错误
- **WHEN** resolver 抛出包含本地路径或原生异常 payload 的错误
- **THEN** 可见 issue MUST 只包含稳定的安全失败类别和安全字段上下文
- **AND** 日志、trace、指标、audit、readiness、release 证据、safe error 和 stream MUST NOT 暴露该不安全 payload

### Requirement: 已解析的 secret 保持瞬态
已解析的 secret 值 SHALL 只作为交付给预期 adapter 或 provider 调用的瞬态 resolver 结果存在。

已解析的值 MUST NOT 被冻结进配置 artifact、存储在共享 cache 或 snapshot 中、被持久化、记录日志、trace、audit、作为指标发出、包含在 safe error 中、被 stream 或被添加到 model context。

#### Scenario: Provider 解析凭据
- **WHEN** 被注入的 provider resolver 返回一个凭据
- **THEN** 该 provider MAY 把它用于预期的 adapter 调用
- **AND** 没有任何配置或可观测 artifact 可以保留已解析的值
