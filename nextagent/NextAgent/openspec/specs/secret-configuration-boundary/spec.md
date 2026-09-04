# secret-configuration-boundary Specification

## Purpose
定义密钥引用的受信配置、启动校验、按需解析和安全失败边界，确保原始密钥不会进入公共配置、模型输入或可观测输出。

## Function

- **所属 Function**：`FN-6.9 引用密钥`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## Requirements
### Requirement: Active secret references are validated before ready
The system SHALL validate active credential-bearing `SecretReference` values during startup/bootstrap before ready state is published or request processing becomes available.

The validation SHALL run inside the app configuration validation flow and SHALL NOT create a separate secret readiness state.

#### Scenario: Ready state is published
- **WHEN** the system publishes its app configuration readiness
- **THEN** active secret reference validation has already completed
- **AND** its safe issue contributions have already been included in `DefaultSystemConfig.configEvaluation` diagnostics and the readiness evidence input

### Requirement: Product credentials use the frozen SecretReference grammar

携带 credential 的产品配置字段 MUST 使用 `SecretReference` grammar，并且 SHALL 只允许 `env:` 或 `file:` reference。

raw secret、inline credential、`direct:` value 和 `none` sentinel MUST NOT 进入产品配置、冻结运行期投影、可见诊断或模型上下文。

Agent App 的 `modelProfiles[]` 父层 provider access config 提供 optional `credentialRef` 时，MUST 遵守同一 grammar、active-reference validation 和最底层 resolver 边界；子层 canonical `ModelProfile` MUST NOT 携带或复制该 reference。该字段缺失时的 no-credential 语义由 `model-invocation-contract` 定义，MUST NOT 绕过本 Requirement 从环境变量或子 `ModelProfile` 自动发现 credential。

公共 `SecretReference` contract MUST NOT 接受或定义 `ENC(...)` 或任何 encrypted-envelope grammar。`env:` 或 `file:` 所引用内容 MUST 在公共配置、模型目录安全查询、Agent assembly 和模型调用请求中保持 opaque；这些边界 MUST NOT 携带 raw secret。如果引用内容使用 `ENC(...)` 或等价 encrypted envelope，解密 MUST 由 secret resolver 或 adapter 在最底层处理，且解密密钥 MUST 来自独立 secret source。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：系统

#### Scenario: 直接配置 raw credential

- **WHEN** 携带 credential 的字段包含 raw value，而不是 `env:` 或 `file:` reference
- **THEN** startup validation MUST 拒绝该 entry
- **AND** 产生的 safe issue MUST NOT 回显 supplied value

#### Scenario: 模型调用解析 credential

- **WHEN** 模型 provider 需要 credential
- **THEN** credential 只在最底层受信任解析边界使用
- **AND** raw secret 不进入模型目录 query、Agent assembly、调用 request 或模型上下文

#### Scenario: Provider 父项使用 SecretReference

- **WHEN** Agent App system config 的 `modelProfiles[]` 父项提供 `credentialRef`
- **THEN** startup validation MUST 只接受合法 `env:` 或 `file:` reference
- **AND** frozen 子 `ModelProfile`、模型目录 query、Agent assembly 和调用 request MUST NOT 复制该 reference

#### Scenario: 配置把 envelope 当作 SecretReference

- **WHEN** credential 配置字段直接使用 `ENC(...)` 或其他非 `env:` / `file:` 语法
- **THEN** startup validation MUST 拒绝该 entry
- **AND** 系统 MUST NOT 猜测或选择 resolver-specific envelope grammar

#### Scenario: 引用内容使用 encrypted envelope

- **WHEN** 合法 `env:` 或 `file:` reference 的内容使用 `ENC(...)` 或等价 encrypted envelope
- **THEN** 解密 MUST 由 secret resolver 或 adapter 在最底层处理
- **AND** 解密密钥 MUST 来自独立 secret source

### Requirement: Owning schemas define secret validation scope
Each owning configuration schema SHALL identify its credential-bearing entries and SHALL provide their active/inactive and required status to the app configuration validation flow.

The secret boundary SHALL NOT infer entry criticality, viable set, degradation, or final readiness.

#### Scenario: Secret validation contributes a failure
- **WHEN** an active credential reference cannot be resolved
- **THEN** secret validation MUST produce a safe issue contribution
- **AND** app configuration validation MUST remain the sole owner of the resulting readiness classification

### Requirement: Active and inactive references use different validation depth
All declared credential references MUST pass grammar validation. Active references MUST also pass resolvability validation before startup completes. Inactive references SHALL NOT be read solely to establish current resolvability.

#### Scenario: Inactive file reference is unavailable
- **WHEN** an inactive branch declares a grammar-valid `file:` reference whose target is unavailable
- **THEN** secret validation MUST NOT read the target
- **AND** it MUST NOT create a current-startup resolvability failure for that reference

### Requirement: One app-composed resolver serves validation and runtime injection
`agent-app` SHALL create one resolver instance for a startup composition. The same resolver instance SHALL be used for active-reference startup validation and injected into credential-consuming adapters or providers.

Downstream consumers MUST NOT read source configuration, construct an alternative resolver, or consume a shared secret usage snapshot.

#### Scenario: Model provider is composed
- **WHEN** startup validation and model provider composition complete
- **THEN** both paths use the same app-composed resolver instance
- **AND** the model provider receives its credential reference through its existing narrow runtime input

### Requirement: Active references are resolvable before startup completes
An active `env:` reference MUST resolve to an existing non-empty environment variable. An active `file:` reference MUST resolve to an existing readable non-empty file.

Missing, empty, unreadable, unsupported, or resolver-failure outcomes MUST produce stable safe issue codes and MUST NOT be deferred until the first request.

#### Scenario: Active environment variable is empty
- **WHEN** an active required `env:` reference resolves to an empty value
- **THEN** secret validation MUST produce a safe issue contribution before ready
- **AND** downstream composition MUST NOT treat that reference as validated

### Requirement: Secret validation output stays app-internal and narrow
Secret validation SHALL produce only app-internal safe issue contributions for the app configuration validation flow.

The system MUST NOT introduce `SecretReadinessState`, `SecretUsageSnapshot`, a shared `SecretValidationResult`, or another cross-package secret artifact.

#### Scenario: Downstream composition consumes configuration
- **WHEN** model, gateway, capability, local auth, readiness, or release composition consumes configuration output
- **THEN** it MUST use its existing owner-defined narrow projection, injected dependency, or `ConfigValidationEvidence`
- **AND** it MUST NOT consume a shared secret artifact

### Requirement: Secret-derived outputs never expose secret material or reference paths
Visible diagnostics and runtime outputs derived from secret validation MUST NOT expose raw secret values, decrypted values, environment variable values, file contents, complete `env:` or `file:` reference strings, local secret paths, adapter-native errors, or stack traces.

Safe issues MAY contain stable issue codes, safe field references, reference kinds, scopes, and safe messages.

#### Scenario: Resolver throws an unsafe internal error
- **WHEN** the resolver throws an error containing a local path or native exception payload
- **THEN** the visible issue MUST contain only the stable safe failure category and safe field context
- **AND** logs, traces, metrics, audits, readiness, release evidence, safe errors, and streams MUST NOT expose the unsafe payload

### Requirement: Resolved secrets remain transient
Resolved secret values SHALL only exist as transient resolver results delivered to the intended adapter or provider invocation.

Resolved values MUST NOT be frozen into configuration artifacts, stored in a shared cache or snapshot, persisted, logged, traced, audited, emitted as metrics, included in safe errors, streamed, or added to model context.

#### Scenario: Provider resolves a credential
- **WHEN** an injected provider resolver returns a credential
- **THEN** the provider MAY use it for the intended adapter invocation
- **AND** no configuration or observable artifact may retain the resolved value
