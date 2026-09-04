## ADDED Requirements

### Requirement: Model provider profile 在启动期间加载并稳定化
系统 SHALL 在 assembly/bootstrap 期间加载 `adnclaw.system.model-profiles[]`，并 SHALL 在系统进入 ready 状态之前把已校验的 runtime profile registry 稳定化。

#### Scenario: 启动达到 ready 状态
- **WHEN** 系统报告 ready
- **THEN** model profile 配置已经被加载、校验并稳定化

### Requirement: 产品配置使用稳定的 model profile baseline
每个产品 model profile SHALL 使用稳定的 baseline 字段：

- `profileId`
- `providerKind`
- `modelName`
- `baseUrl`
- `credentialRef`
- `timeoutMs`
- `modelOptions`
- `providerOptions`
- `enabled`
- `fallbackEligible`

#### Scenario: 存在被禁用的 profile
- **WHEN** 某 profile 的 `enabled=false`
- **THEN** 它 MAY 保留在源配置中，但 MUST NOT 进入已启用的 runtime profile 集合

### Requirement: 受支持的 provider kind 是封闭集合
在不改变 `agent-contracts` 的前提下，首个产品 baseline MUST 只允许已启用的产品 model profile 使用 `OPENAI` provider kind。

诸如 `MINIMAX`、`DEEPSEEK` 或 `QWEN` 这样的额外 provider kind，需要之后的 contract change 才能进入产品配置。

Fake、test 或 mock provider MUST NOT 出现在产品配置中。

#### Scenario: 配置了不支持的 provider kind
- **WHEN** 某 profile 使用受支持集合之外的 provider kind
- **THEN** 启动 MUST 拒绝该 profile 配置

### Requirement: 使用 secret 引用而不是原始凭据
`credentialRef` MUST 使用 secret reference 语法，并 SHALL 只允许 `env:` 或 `file:` 引用。

原始 secret 值、内联凭据、`direct:` 值和 `none` 哨兵值 MUST NOT 进入产品配置、日志、trace、audit、指标或面向 model 的 runtime artifact。

#### Scenario: 环境变量支撑的 secret 引用
- **WHEN** 某 profile 使用 `credentialRef=env:OPENAI_API_KEY`
- **THEN** runtime registry MAY 保留该引用字符串，AND 它 MUST NOT 暴露已解析的 secret 值

#### Scenario: 文件支撑的 secret 引用
- **WHEN** 某 profile 使用语法有效的 `file:` credential 引用
- **THEN** 产品 credential resolver MUST 只通过 app 组合的 resolver 路径读取该文件，AND 它 MUST NOT 在失败结果中暴露文件路径或已解析的 secret

本能力拥有 model profile secret reference 语法校验。ready 之前的 active 引用可解析性校验和单一 resolver 注入路径 SHALL 由 `secret-configuration-boundary` 拥有。

### Requirement: 校验遵循确定性规则顺序
启动校验 MUST 按以下顺序应用规则：

1. `modelProfiles[]` 存在且非空
2. 必需的身份字段存在
3. `providerKind` 受支持
4. `timeoutMs` 为正数
5. `baseUrl` 在受控 provider 规则下有效
6. `credentialRef` 是有效的 secret 引用
7. `profileId` 唯一
8. `fallbackEligible=true` 要求 `enabled=true`
9. 至少一个 profile 保持启用

#### Scenario: 所有 profile 都被禁用
- **WHEN** 校验完成且没有任何 profile 被启用
- **THEN** 启动 MUST 在 ready 状态之前失败

### Requirement: 成功启动产生一个稳定的 runtime profile registry
成功的启动 SHALL 产生一个 `modelProfileRegistry` 作为稳定的 runtime profile artifact。

该 registry SHALL 至少包含：

- 按 `profileId` 索引的已校验 profile
- 已启用 profile 的索引
- fallback-eligible profile 的索引
- 按 `profileId` 索引的安全 provider route descriptor
- 校验证据

该 registry 在当前进程 lifecycle 内 SHALL 是递归只读的，包括嵌套的 `modelOptions`、`providerOptions`、索引、安全 provider route descriptor 和校验证据，并 SHALL 保持可追溯到 `profileId`。

下游模块 SHALL 消费该 registry 和必要的 selector，而不是单独暴露的可变 profile 集合或 route catalog。

安全 provider route descriptor SHALL 只包含 provider 访问组装所需的非敏感稳定字段。Adapter factory、provider SDK client、已解析的凭据和其他可变 runtime handle MUST NOT 进入 `modelProfileRegistry`。

#### Scenario: 请求期间运行 model 选择
- **WHEN** 选择策略评估候选 profile
- **THEN** 它 MUST 消费已稳定化的 runtime profile registry，而不是重新解析源配置

### Requirement: Fail-fast 与降级启动边界是显式的
系统 SHALL NOT 静默丢弃无效的 profile。

如果无效配置使系统没有可用的已启用 profile 集合，启动 MUST 失败。在 TS 首版中，fallback-only profile 只有在其 `credentialRef` 语法无效且至少保留一个有效启用的主 profile 时，才 MAY 被排除。其他 profile 校验失败 SHALL 保持 fail-fast。

排除路径 MUST 发出 operator 可见的结构化证据，包含失败的 `profileId` 和安全 diagnostic code，且不带原始 secret 值或本地路径。

#### Scenario: 唯一启用的 profile 具有无效 credential 引用
- **WHEN** 唯一启用的 profile 缺少有效的 secret 引用
- **THEN** 启动 MUST 失败

#### Scenario: 次级 fallback profile 无效
- **WHEN** 存在多个 profile，一个 fallback-only profile 无效而仍保留一个有效启用的主 profile
- **THEN** 系统 MAY 在没有该 profile 的情况下继续启动，AND 它 MUST 保留标识失败 `profileId` 的 operator 可见证据
