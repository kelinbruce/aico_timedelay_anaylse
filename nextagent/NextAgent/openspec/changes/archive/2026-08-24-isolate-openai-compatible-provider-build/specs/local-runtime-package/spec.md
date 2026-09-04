# local-runtime-package Delta

## Function

- **所属 Function**：`FN-4.1 调用模型`
- **Function 变更类型**：修改
- **spec 角色**：legacy 规格

## ADDED Requirements

### Requirement: Model Gateway-only package excludes OpenAI-compatible provider implementation

打包流程 MAY 在操作者显式选择 `model-gateway-only` 模式时生成模型能力受限的本地 runtime package。该 package MUST 在 package manifest 中声明 `modelProviderProfile="model-gateway-only"`，且 MUST 从 package runtime 内容中排除 OpenAI-compatible provider invocation implementation 和 `@ai-sdk/openai-compatible` runtime dependency。默认 package MUST 继续包含 OpenAI-compatible provider invocation capability。

`model-gateway-only` package 的 staging 或 self-check MUST 在生成成功候选前验证配置能力兼容。任一 `openai-compatible` model profile 出现在配置样例或启动配置中时，packaging/self-check MUST fail closed 并产生安全诊断 code `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE`；MUST NOT 生成可启动但首次模型调用才缺件的候选，MUST NOT 静默忽略该 profile，也 MUST NOT 把该 provider 显示为 `UNAVAILABLE` 代替构建能力错误。配置只包含 `model-gateway` 且其余启动前置条件满足时，package self-check MUST 按现有本地 runtime package 契约执行。

**需求类别**：系统质量属性
**质量属性**：可维护性
**适用范围**：`FN-4.1 调用模型`

#### Scenario: 默认 package 保持既有能力
- **WHEN** 操作者构建默认 `backend-only` 或 `with-frontend` package
- **THEN** package manifest 不声明 `model-gateway-only` 模型能力
- **AND** package 包含 OpenAI-compatible provider invocation capability 和对应 runtime dependency

#### Scenario: 构建 model-gateway-only package
- **WHEN** 操作者显式选择 `model-gateway-only` 打包模式
- **AND** 配置样例只包含 `model-gateway` provider profile
- **THEN** gateway-only TypeScript build 不把 OpenAI-compatible provider invocation implementation 源文件纳入编译输入
- **AND** package manifest 声明 `modelProviderProfile="model-gateway-only"`
- **AND** package 不包含 OpenAI-compatible provider invocation implementation 文件
- **AND** package 不包含 `@ai-sdk/openai-compatible` runtime dependency

#### Scenario: model-gateway-only package 配置不兼容
- **WHEN** `model-gateway-only` 打包模式的配置包含 `openai-compatible` provider profile
- **THEN** staging 或 self-check 在成功候选生成前 fail closed
- **AND** 诊断只暴露安全 code 与 provider identity
- **AND** 系统不生成首个模型调用才失败的候选

#### Scenario: 排除文件破坏 runtime export
- **WHEN** provider 排除导致 package manifest 声明的 runtime export 或依赖缺失
- **THEN** pack flow MUST fail before archive
- **AND** 诊断标识缺失的 package/export/dependency
