## Function

- **所属 Function**：`FN-6.9 引用密钥`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 前置条件

- **变更类型**：修改
- **目标内容**：公共 contract 只接受 `env:`/`file:` reference grammar；model credential reference 位于 `modelProfiles[]` 父层 provider access config 而不进入子 profile，引用内容在公共边界保持 opaque，encrypted envelope 由最底层 resolver/adapter 使用独立 key source 处理。
- **依据 Requirements**：`Product credentials use the frozen SecretReference grammar`

### 输出

- **变更类型**：修改
- **目标内容**：raw credential 不进入配置投影、可见诊断、模型目录查询、Agent assembly、模型调用请求或模型上下文；非法引用安全失败且不回显输入。
- **依据 Requirements**：`Product credentials use the frozen SecretReference grammar`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统只在 credential-bearing provider access entry 接受合法 `SecretReference`，把引用内容作为 opaque value 传递到可信 credential 使用边界；缺失字段不触发环境自动发现，resolver/adapter 在最底层处理 encrypted envelope，非法引用语法安全失败。
- **依据 Requirements**：`Product credentials use the frozen SecretReference grammar`

### 量化指标

- **指标名称**：原始密钥泄漏次数
- **变更类型**：测量口径调整
- **原值或原口径**：`0`，状态为已定义，原来源为 Function 中的安全红线。
- **目标值或目标口径**：目标保持 `0` 不变，权威来源调整为 `Product credentials use the frozen SecretReference grammar`。
- **单位与测量边界**：单位为次；适用于产品配置、冻结运行期投影、可见诊断、模型目录查询、Agent 装配、模型调用请求和模型上下文中的 raw secret 出现次数。
- **依据 Requirements**：`Product credentials use the frozen SecretReference grammar`

### 主规格

- **变更类型**：修改
- **目标内容**：`secret-configuration-boundary`
- **依据 Requirements**：`Product credentials use the frozen SecretReference grammar`
