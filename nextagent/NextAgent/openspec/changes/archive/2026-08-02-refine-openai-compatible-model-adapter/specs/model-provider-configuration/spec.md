## REMOVED Requirements

### Requirement: Model provider profiles are loaded and stabilized during startup

**Reason**：该 Requirement 把配置加载、模型目录、provider metadata 和 Agent 激活校验绑定到 legacy 配置 spec；本次触及的模型目录黑盒行为统一迁入 `FN-4.1 调用模型` 的 canonical spec。

**Migration**：目标行为由 `model-invocation-contract` 的“全局模型目录提供安全模型配置”承载；配置读取、校验和 composition 白盒流程由 design 承载。

### Requirement: Product configuration uses the stable model profile baseline

**Reason**：模型 profile 的公共输入和 provider-specific metadata source 属于模型调用的配置前置条件，不再由 legacy 配置 spec 重复定义。

**Migration**：目标行为迁入 `model-invocation-contract` 的“全局模型目录提供安全模型配置”和“模型接入配置只在模型边界内解析”。

### Requirement: Supported provider kinds are a closed set

**Reason**：目标子 `ModelProfile` 以全局唯一 `modelId` 标识模型，父级 `ModelProviderProfile.providerId` exact lookup 已装配 provider registration；Gateway invocation capability 和模型信息可用性共同决定模型是否可调用，属于 `FN-4.1 调用模型` 黑盒边界。

**Migration**：目标行为迁入 `model-invocation-contract` 的“全局模型目录提供安全模型配置”和“模型接入配置只在模型边界内解析”。

### Requirement: Validation follows deterministic rule order

**Reason**：原 Requirement 同时描述黑盒校验结果和 app 内部校验顺序；黑盒模型目录结果迁入 canonical spec，具体顺序属于 design。

**Migration**：失败与降级结果迁入 `model-invocation-contract` 的“全局模型目录提供安全模型配置”；校验顺序与 composition 由 design 承载。

### Requirement: Successful startup produces one stable runtime profile registry

**Reason**：内部模型消费者把 app-owned runtime registry 当作目录/选择权威时会与全局模型目录形成双重权威；在所有运行期消费者迁移后，`NextAgentApp.modelProfileRegistry` 也只重复 `systemConfig.modelProfiles` 与 validation evidence，没有独立宿主语义。

**Migration**：目标运行期行为由 model-owned catalog/query 与 Context Engine selection 承载；`NextAgentApp` 只保留 `systemConfig` 顶层字段服务可信 App Host，不作为内部运行期 authority；重复的 `modelProfileRegistry` 与没有独立消费者或路由语义的 `productModelProviderKind` 删除，不保留 alias。模型配置、identity 与 validation evidence 只使用 `systemConfig` 中的 canonical contract；provider selection 与 binding 只使用 canonical `providerId`。目标迁入 `model-invocation-contract` 的“Agent App system config 使用 canonical model/provider 配置”和“可信 App Host 可读取配置快照但运行期模型功能不依赖它”。

### Requirement: Secret references are used instead of raw credentials

**Reason**：原 Requirement 把 `credentialRef` 建模为 legacy flat model profile 字段；目标配置把 provider access 放在两层 `modelProfiles[]` 父项、把模型画像放在子 profile，但 `SecretReference` grammar、最底层 resolver 和 raw-secret 禁止行为保持不变。

**Migration**：`credentialRef` 的目标字段位置与缺省语义迁入 `model-invocation-contract` 的“Agent App system config 使用 canonical model/provider 配置”；`env:`/`file:` grammar、active reference validation、最底层 resolver 和 non-leakage 行为由 `secret-configuration-boundary` 的“Product credentials use the frozen SecretReference grammar”承载。

### Requirement: Fail-fast and degrade-startup boundaries are explicit

**Reason**：原 Requirement 的唯一 degrade 例外按 legacy profile-local `credentialRef` 建模；目标配置把 credential 归属到两层 `modelProfiles[]` 中可被多个子 profiles 共享的父项，必须原子定义受影响模型集合并保持其他配置错误 fail-fast。

**Migration**：目标 fail-fast 与 fallback-only invalid-credential degradation 迁入 `model-invocation-contract` 的“Agent App system config 使用 canonical model/provider 配置”；Secret grammar 和 non-leakage 继续由 `secret-configuration-boundary` 承载。
