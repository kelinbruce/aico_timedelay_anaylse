# Frozen model contract 群内确认

状态：**已确认**

本记录只列出 `refine-openai-compatible-model-adapter` 对 frozen/public contract 的目标变化和明确保持不变的边界。2026-07-28 已确认原范围继续有效；2026-07-29 对随后收敛的模型目录按需解析生命周期、产品 provider 清单、catalog/selection configuration 同形复用、selection scope/mode、Prompt model scalar 和 thinking 单一 authority 完成补充确认；2026-07-30 本任务需求方进一步确认 provider-options 开放扩展、Gateway-owned optional fetch、删除 header policy、raw agent id 无需拒绝、hook 采用低复制隔离策略，以及 scripted-model app factory 只属于 testing surface、宿主变体选择名称不得暗示模型选择；2026-07-31 进一步确认 Agent assembly 直接以 frozen `systemConfig.modelProfiles` 校验模型引用，删除 configured-model membership/configured ids 中间抽象，app-facing model ports 只保留既有 `ModelCatalogQueryService` 与 `ModelInvocationService`，最终 invocation service 不得作为 configured runtime 输入，推荐 operation identity 由 session service 自有 UUID generator 建立且不由 App composition 注入；同日需求方确认 `modelProfileRegistry` 是 `systemConfig.modelProfiles/modelProfileValidationEvidence` 的重复 Host 投影，应删除且不得建立替代 index/helper，并指出 summary model selection 不得 hard-code 空 `flowVariables`，应承接当前 context assembly 的 trusted string-only projection。

## Model invocation scope

`ModelInvocationScope` 已存在于当前 `agent-contracts/model` 基线，本 change 对其执行 breaking refinement，并保持为单一 flat closed object：

- required fields：`tenantId`、`subjectId`、`agentId`、`agentVersion`、`agentAssemblyRef`、`operationId`；
- optional fields：`sessionId`、`requestId`、`runId`，三者 all-or-none；
- `operationId` 只用于 correlation、observability 和 audit，不参与模型选择、provider routing、授权、幂等、retry 或模型可见输入。

领域 identity 到模型 scope 的映射为：

- run-bound 调用把 owning `stepId` 的同一值写入 `operationId`，并携带真实 accepted session/request/run；
- recommendation service 在 terminal 预计算或 Web 按需路径的每次实际模型调用前建立 fresh `operationId`，completed run 三元组作为真实 causal correlation 保留；
- memory extraction 把 scheduler/cycle-owned `cycleId` 的同一值写入 `operationId`，不合成 session/request/run。

## Model invocation request

`ModelInvocationRequest` 是 closed object。

Required fields：

- `invocationScope`
- `modelId`
- `messages`
- `tools`

Optional fields：

- `temperature`
- `maxOutputTokens`
- `topP`
- `topK`
- `presencePenalty`
- `frequencyPenalty`
- `thinking`
- `providerOptions`
- `timeoutMs`
- `maxRetries`

顶层 `requestId`、`stepId`、`modelProfileId`、`providerKind`、`modelName`、`baseUrl`、`credentialRef`、`locale` 和 `commonOptions` 删除，不保留 alias 或 dual read/write。

Optional/default resolution：

| Optional fields | 缺省语义 |
|---|---|
| `temperature` | profile → selected Prompt Template → governed Capability patch → trusted request → governed hook，后层优先；全部缺失时为 `0.55` |
| `maxOutputTokens` | 同一固定 precedence；全部缺失时为 `32,000` |
| `topP` | 同一固定 precedence；全部缺失时为 `1` |
| `topK`、`presencePenalty`、`frequencyPenalty`、`thinking` | 同一固定 precedence；全部缺失时保持缺失并使用 provider 缺省语义 |
| `providerOptions` | 使用相同层次顺序，但 Capability layer 只接受 governed Skill metadata mapping；按顺序顶层浅合并，后者优先且同名嵌套对象整体替换；全部缺失时不向 provider 传递，也不合成空对象 |
| `timeoutMs` | governed hook 值优先，其次 trusted request、profile；三层均缺失时为 `30,000 ms`，之后再受 execution budget 约束 |
| `maxRetries` | governed hook 值优先，其次 trusted request、profile；三层均缺失时为 `2` |
| `ModelProfile.displayName` | 缺失时保持缺失，不从 `modelId` 合成 |
| `AgentAssembly.modelIds` | required、非空、有序且无重复；不存在 singular Agent `modelId` 配置 |
| `AgentAssembly.defaultModelId` | 缺失时 initial selection 使用 `modelIds` 顺序中的第一个 eligible model |
| `ModelSelectionRequest.locale` | 缺失时不施加 locale-specific filter |
| `ModelSelectionRequest.modelId` | 缺失时不施加显式 model-id filter；优先合法 `defaultModelId`，否则使用第一个 eligible `modelIds` 项 |
| `contextPatch.modelId/modelOptions` | 缺失时不覆盖后续选择/参数；单个 model option 缺失时不覆盖该字段 |
| `BEFORE_MODEL_INVOKE` mutation optional fields | 缺失时保持 hook 前 effective value，不清空字段且不由 hook 合成默认值 |

`contextWindowTokens` 没有固定默认值：使用静态模型信息的 provider registration 要求 profile 配置合法值，使用 model-information service 的 registration 必须取得合法查询值。

固定推理默认值只由 `agent-model` catalog resolution 填充并投影到 `ResolvedModelConfiguration`。bundled profile、Prompt Template、Skill、Capability 和 hook 不复制这些默认常量，只提供显式 override。

Prompt Template 与 Skill 的 `modelOptions` 使用与模型配置一致的八字段 closed inference schema：

- `temperature`
- `maxOutputTokens`
- `topP`
- `topK`
- `presencePenalty`
- `frequencyPenalty`
- `thinking`
- `providerOptions`

前七个字段复用模型调用契约的 shape/range/null rules；`providerOptions` 必须是 non-null `JsonObject`，其 inner keys 保持开放。Prompt Template 只允许已编译且为最终 selected model 选中的模板产生该字段；Skill 只允许 source-admitted、manifest-validated、已接受的 `SkillMetadata.modelOptions` 经受治理 Skill Tool mapper 产生该字段。最终模型确定后，selected adapter 只拒绝与 canonical 顶层模型字段或 identity/access/transport authority 冲突的 camelCase/provider-native keys，并把其他已知或未知 JSON fields 原样交给 AI SDK provider namespace；不得用 allowlist 拒绝未来 provider extension。Prompt Template 与 Skill 不接受 provider identity/access、transport、`timeoutMs` 或 `maxRetries`；后二者是模型执行控制，不属于推理参数。

## Model identity and catalog

- `ModelProfile.modelId` 是系统内唯一 canonical model identity；
- 父层 required `providerId` 对 `agent-model` 可信 provider registry 做 exact lookup，绑定恰好一个 provider registration；
- 产品配置允许的 exact `providerId` 清单恰好为 `openai-compatible | model-gateway`；前者要求 `baseUrl`、后者禁止 `baseUrl`，两者都允许 optional `credentialRef` 且缺失时不发送 credential；其他值不能仅靠配置启用；
- 同一 `modelId` 同时作为 NextAgent 模型身份和传给 provider 的模型标识；
- `ModelFinalResult` required field 为 `content`，optional fields 恰好为 `reasoning/finishReason/usage/toolCalls/providerResponseId/safeError`；模型身份由对应 request 持有，`providerResponseId` 只用于安全 response correlation；
- `modelId` 在全部 provider 父项之间全局唯一；同一字面值不能在两个 `providerId` 下重复，系统不通过父级 `providerId`、前缀或隐藏 rewrite 消除歧义；
- `ResolvedModelConfiguration` 始终包含 effective `temperature=0.55`、`maxOutputTokens=32,000` 和 `topP=1`，除非 profile 显式覆盖对应值；
- Agent definition 可省略 `modelIds`，由通用 assembly compiler 按 frozen `systemConfig.modelProfiles` 顺序继承全部已校验模型；显式 `modelIds` 必须 non-empty、ordered、unique，runtime assembly 始终携带解析后的非空集合；optional `defaultModelId` 存在时必须属于该集合，省略时 initial selection 使用第一个 eligible id；
- accepted Agent assembly 已在 publication 阶段完成模型引用校验，model selection 不重复表达 unknown activation；已知但 `UNAVAILABLE` 的模型走可用候选排除并以 `NO_AVAILABLE_MODEL` 表达；
- 现有 `profileId`、`modelProfileId`、`providerKind` 和 `modelName` 原子迁移为 canonical `modelId`；`ModelFinalResult` 收敛到上述 closed terminal shape；
- validated `systemConfig.modelProfiles` 是 Agent assembly publication 的冻结模型定义来源；Gateway bindings 完成后、ready 前再建立 private provider binding；primary health 不调用 Gateway model-information service；
- 本 change 新增 app-private `ModelCatalogQueryService`，提供 `list(signal)` 和 `get(modelId, signal)`，只返回安全模型配置和可用性，不暴露 endpoint、credential、transport 或 provider access，也不增加 `NextAgentApp` public API；
- startup compile、Capability graph validation 和 hot reload publication 直接读取同一个 frozen `systemConfig.modelProfiles` 校验 Agent `modelIds/defaultModelId`，不建立 configured ids、membership port 或另一份模型存在性权威；
- app-facing model ports 只保留既有 `ModelCatalogQueryService(list/get)` 与独立 `ModelInvocationService(complete/stream)`；Context Engine 直接消费前者，不做无意义改名或组合接口；
- `AVAILABLE` entry 的模型身份只位于 `configuration.modelId`，不重复顶层 `modelId`；`UNAVAILABLE` entry 使用顶层 `modelId`；selection 原样复用 available entry 的 frozen `ResolvedModelConfiguration`；
- 首次 `get` 只解析目标模型，首次 `list` 解析全部尚未解析模型；同模型并发查询 single-flight，完成结果逐模型冻结到进程重启，unknown `get` 不调用 provider，取消不把未完成模型冻结为 `UNAVAILABLE`；
- 公共目录只返回 `AVAILABLE | UNAVAILABLE`，不暴露内部未解析或解析中状态。

## Agent App system config 与 public projection

- `NextAgentApp` 的模型相关顶层字段只保留含 frozen `modelProfiles/modelProfileValidationEvidence` 的 `systemConfig`，不新增 catalog/query/binding public API；
- `RuntimeModelProviderKind`、composition input `modelProviderKind` 与 `productModelProviderKind` 删除且不保留 alias；外部可信 Host 如需识别已配置 provider，改读 `systemConfig.modelProfiles[].providerId`；
- `DefaultSystemConfig` 只使用两层 `modelProfiles[]`：父层 required `providerId/models`、optional `baseUrl/credentialRef`；子层 required `modelId/fallbackEligible`，optional `displayName/contextWindowTokens`、`temperature/maxOutputTokens/topP/topK/presencePenalty/frequencyPenalty/thinking`、`providerOptions`、`timeoutMs/maxRetries`；
- 子模型存在于 `models[]` 中并通过校验后即进入目录装配；停用模型时从配置移除；
- `providerId` 是唯一 provider 身份与路由键；产品配置清单恰好为 `openai-compatible | model-gateway`，`agent-model` 只对可信 provider registry 做 exact lookup，不根据字符串前缀或平行 provider-kind 摘要推断 provider class；
- 命中的 provider registration 校验父层 `baseUrl/credentialRef`；支持 credential 的 registration 在 `credentialRef` 缺失时不发送 credential，也不从环境或子 profile 隐式补齐；
- 既有 fallback-only invalid-credential degrade 规则按父层共享 provider access config 迁移：只有该父层受影响 profiles 全部 fallback-eligible 且排除后仍有 viable non-fallback profile 时，才可排除整个集合并 degraded-ready；primary/shared-provider 或其他配置错误 fail closed；
- `agent-contracts/gateway` 定义环境中立且 Fetch-compatible 的 optional `FetchGateway`，`GatewayBindings.fetch` 不新增 selection kind、LOCAL default 或 readiness requirement；该能力可供 app composition 下的 outbound HTTP consumer 复用，但本 change 只在 bindings 完成后把它可选装配给 OpenAI-compatible adapter，不迁移其他 REST client；LOCAL 缺失时使用平台默认 fetch，仓库内不实现 REMOTE fetch；
- SDK client 和 transport 不进入 system config；本 change 不定义 outbound header policy 或额外 header 语义；
- bundled `default-system.yaml` 和 env projection 同步改为父层 provider access + 子层 models，把现有 `profileId/modelName` 收敛为单一 `modelId`，并把 `modelOptions` 展开为目标扁平字段；
- bundled Agent manifest 省略部署相关模型引用并使用同一通用继承规则；删除内置 Agent normalization，不保留 `default-openai` alias，也不在 Agent manifest 解析环境变量；test composition 与 fixtures 继续使用调用方显式提供的 exact `modelId`；
- `modelProfileRegistry` 顶层字段删除；validation evidence 继续以 frozen `modelId/code/message` items 保留在 `systemConfig.modelProfileValidationEvidence`，Host 可按需从两层 `modelProfiles` 派生扁平清单、fallback ids 或 exact lookup，但 production 不维护重复 registry/index/helper；
- runtime consumers 只通过 app-private model catalog/query/binding 取得模型事实，不读取上述 Host projection 作为 authority。

## Model Gateway

- `ModelGatewayProvider` 增加 provider-private model-information service；
- model-information service 通过同一 `modelId` 查询 `contextWindowTokens`，返回 closed `FOUND | NOT_FOUND | UNAVAILABLE` result；
- capability 在 app bootstrap 时只完成装配，Gateway 信息查询由 ready 后首次 Context Engine selection、显式 deep model-provider health 或其他 safe catalog `list/get` 触发；
- invocation client 继续接收完整 canonical `ModelInvocationRequest`；
- Gateway 不合成 lifecycle coordinates，也不把 invocation scope 转为模型可见输入或 provider-native body。

## Related public contracts

- `agent-contracts/model` 新增唯一 canonical `ModelInferenceOptions` type/runtime schema，恰好包含七个 provider-neutral inference fields 和 optional `providerOptions`；Capability patch、Prompt Template 和 Skill metadata 复用该结构规则，source authority 仍由各 owner 单独治理，`ModelInvocationRequest` 继续保持 flat fields；
- `CapabilityInvocationResult.contextPatch.modelName` 替换为 optional canonical `modelId`；
- `contextPatch.modelOptions` 收敛为八字段 closed inference schema；`providerOptions` 只接受已接受 Skill metadata 经受治理 Skill Tool mapper 产生的值，非 Skill Capability result、Capability 参数、Skill input/body、模型输出和其他 metadata 的同形注入安全失败；
- Prompt Template `modelOptions` 使用相同八字段 closed inference schema，省略字段不合成默认值，`providerOptions` 在最终模型确定后由 selected adapter 校验；
- `SkillMetadata.modelOptions`、manifest parser、runtime schema 和 Skill Tool mapper 使用相同八字段 closed inference schema，`providerOptions` 只来自已接受的受治理 Skill metadata；
- `ModelInputRenderRequest.providerOptions` 和 `RenderedModelInput.providerOptions` 收敛为 optional call-level carry；Context Engine 只合并 selected Prompt Template、governed Skill metadata mapping 和 trusted request，三者均缺失时保持字段缺失且不合成空对象，private profile defaults 继续只由模型边界持有；
- `BEFORE_MODEL_INVOKE` mutation 删除 `commonOptions`，改用与 `ModelInvocationRequest` 对齐的扁平 inference fields，并支持受控 `providerOptions`、`timeoutMs` 和 `maxRetries`；
- hook 不得修改 `modelId`、`invocationScope`、Owner/Agent Scope、provider access 或 transport；
- prompt model match 使用 canonical `modelId` string 直接赋值给 `match.model`，不使用单字段 nested object；
- `ModelSelectionRequest` 复用既有 `identityContext` 并显式携带 `agentId/agentVersion/agentAssemblyRef`；`mode` 只允许 `INITIAL | FALLBACK`，只表达首次选择或跨模型 fallback；
- Context Engine 通过统一 `ModelSelectionService` 原样返回 catalog available entry 的 frozen canonical selected model configuration。

## 推荐问题 operation identity

- `RequestLifecycleDependencies.postTerminalCallback(command, run, status)` 保持既有三参数 contract；
- `SuggestedQuestionRequest` 保持既有 tenant/subject/agent/session/request/run closed fields；
- 推荐服务在自身模型调用边界通过 service-owned cryptographically secure UUID generator 建立 identity，App composition 不注入或感知该 generator；
- terminal 预计算与 Web 按需生成汇入同一推荐服务；每次实际模型调用前由服务建立 fresh scope `operationId`，缓存命中或没有模型调用时不生成 identity；
- Web/client、模型输出、Capability 参数和其他不可信 metadata 没有提供或覆盖该 identity 的 public 字段。

## Model invocation timeline

`MODEL_INVOCATION_STARTED | MODEL_INVOCATION_COMPLETED | MODEL_INVOCATION_FAILED` 的安全 identity 使用 `stepId` 和 canonical `modelId`。`modelProfileId`、模型语义的 `providerKind` 和 `modelName` 从 model-event producer、persisted schema、历史读取和 workbench server/browser model projection 删除，不保留 compatibility alias；Capability provider/source classification 保持既有契约。

## Observability projection 与 metrics

- timeline mapper 以 `stepId/modelId` 校验 model event，并只把 `runId + stepId` 用于进程内 duration/first-visible pairing；
- `stepId`、`modelId`、`providerId` 和旧 `providerKind/modelProfileId/modelName` 不进入 diagnostic candidates、trace attributes、structured-log detail 或 metric labels；
- duration、usage、first-visible、failure 和 stable run/timeline refs 保持；
- `model_invocation_total`、`model_invocation_duration_seconds`、`model_token_usage_total`、`model_ttft_seconds`、`model_chunk_latency_seconds`、`model_total_latency_seconds` 删除 `provider_kind` label，不以 `OTHER`、`modelId`、`providerId` 或替代 provider category 兼容；
- metric name、value、dedup、outcome/token labels 与其他 inventory 保持。

## Outbound model HTTP headers

既有四个 correlation headers 保留，并由 `agent-model` 从已校验 invocation scope 集中生成：

- 始终生成 `X-NextAgent-Agent-Id`；
- 完整 session/request/run 存在时，同时生成 `X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`；
- request、hook、provider options 和 caller 不得提供或覆盖这些 headers；
- `agentId` 为非敏感 correlation fact，`X-NextAgent-Agent-Id` 使用其可信原值，不做 opaque mapping 或 raw-value rejection；
- 本 change 不定义 optional outbound header policy。

## Lifecycle hook 引用隔离

- model hook boundary 不得直接暴露 owner-owned nested mutable references；
- 实现使用 runtime readonly projection、structural sharing 或 copy-on-write guard，避免每次调用 full-request deep clone；
- runtime 只对 mutation 中实际出现的 replacement fields detach/canonicalize，未替换字段继续复用 owner request value；
- hook 原地修改 received nested boundary 或返回后继续修改 replacement reference，都不能改变 effective request 或 provider input。

## 保持边界

- `NextAgentApp` 的模型相关顶层 public shape 恰好为 `systemConfig`；其模型配置/evidence contract 按上一节原子迁移，`modelProfileRegistry` 不保留 alias；
- `SuggestedQuestionRequest` 与 `postTerminalCallback(command, run, status)` 保持既有 contract；
- request lifecycle、terminal commit、Owner Scope 和 Agent Scope owner 保持不变；
- `SecretReference`、secret resolver 和 Secret production path 保持不变；
- provider correlation header names 保持为既有 Agent/Session/Request/Run 四个名称；
- same-model retry 由模型边界负责，Core 只负责 cross-model fallback。
- reasoning 保持模型输出归一化及既有展示/时间线用途；模型输入消息、工具轮续接、跨轮上下文和 provider continuation 回传不进入本 change。

## Confirmation

- 已确认参与者：2026-07-28 本 change 群内评审全员
- 已确认结论：除下述补充项外，目标 contract 全员同意且无异议
- 补充确认范围：ready、assembly publication 与 primary health 的零 Gateway model-information I/O；首次 Context Engine selection、显式 post-ready deep model-provider health 或其他 safe `list/get` 消费者触发逐模型 lazy resolution、single-flight、cancellation 与进程内 freeze；产品 `providerId` 封闭清单；available catalog entry 去除重复顶层 `modelId` 与 selection 原样复用；`ModelSelectionRequest` 复用 `identityContext` 和显式 Agent fields；Prompt `match.model` scalar；顶层 `thinking` 作为唯一 reasoning input authority
- 补充确认参与者：本轮群内评审全员
- 补充确认日期：2026-07-29
- 补充确认结论：全员同意且无异议
- 2026-07-30 补充确认参与者：本任务需求方
- 2026-07-30 补充确认范围：`providerOptions` 未知字段开放且只拒绝 reserved collision；环境中立的 `FetchGateway` 位于 `agent-contracts/gateway` 并由 optional `GatewayBindings.fetch` 承载，后续 REST consumer 可复用该 contract，但本 change 只由 `agent-app` 装配给 OpenAI-compatible adapter；LOCAL 缺省与仓库外 REMOTE 实现边界；删除 header policy；raw `agentId` 不拒绝；hook readonly low-copy view 与 replacement-only detach；scripted-model app factory 只从 `agent-app/testing` 暴露，auth/frontend host 变体选择使用不与 model selection 混淆的名称
- 2026-07-30 补充确认结论：已明确确认上述边界
- 2026-07-31 补充确认参与者：本任务需求方
- 2026-07-31 补充确认范围：Agent assembly 直接以 frozen `systemConfig.modelProfiles` 校验模型引用；删除 configured-model membership/configured ids；保留既有 `ModelCatalogQueryService` 命名，app-facing model ports 只包含 catalog query 与 invocation；最终 `ModelInvocationService` 只作为 configured runtime 输出和 consumer port，testing surface 通过测试 `ModelGatewayProvider` 复用真实 provider composition；推荐 operation identity 由 session service 自有 UUID generator 建立且不由 App composition 注入
- 2026-07-31 补充确认结论：已明确确认上述边界
- 2026-07-31 summary flow variables 补充确认参与者：本任务需求方
- 2026-07-31 summary flow variables 补充确认范围：Core 在 Context Engine 边界只投影 runtime flow variables 的 trusted string entries，按既有安全边界排除原始用户问题 `input_question`；`TraceableSummaryGenerationRequest` 显式携带该 trusted projection；summary model selection 与最终 prompt assembly 使用同一 map，不 hard-code 空对象、不引入第二份 match map，也不 deep clone runtime context
- 2026-07-31 summary flow variables 补充确认结论：已明确指出并纳入目标契约
- 2026-07-31 stream terminal marker 补充确认参与者：本任务需求方
- 2026-07-31 stream terminal marker 补充确认范围：`ModelFinalResult` 字段集合与非流式 `complete()` shape 保持不变；流式终态必须在 required `content` 外携带 defined `finishReason`、`usage`、`toolCalls`、`providerResponseId` 或 `safeError` 中至少一个既有 marker，只含 `content` 和/或 `reasoning` 的尾事件仍是 delta，流在其后结束必须显式安全失败；跨 Core、Workflow、model lifecycle 与 Gateway 复用唯一判据
- 2026-07-31 stream terminal marker 补充确认结论：本任务需求方明确指出误判风险并要求确认后修复；该轮 marker 范围随后由 terminal consumption 补充确认收窄，当前目标契约以后一条结论为准
- 2026-07-31 terminal consumption 补充确认参与者：本任务需求方
- 2026-07-31 terminal consumption 补充确认范围：流式终态只由 defined `finishReason` 或 `safeError` 证明，usage/tool calls/response id 不单独证明结束；`stop` 可合法携带非空 Tool calls 并进入 Tool loop；`content-filter` 必须先成为不可恢复策略失败；error 按可信 recoverability 决定 retry/fallback，`retryable=false` 不得由 category 隐式升级；本轮不修改既有 `length` 恢复逻辑
- 2026-07-31 terminal consumption 补充确认结论：已明确确认上述边界
- 2026-07-31 contracts helper ownership 补充确认参与者：本任务需求方
- 2026-07-31 contracts helper ownership 补充确认范围：`agent-contracts/model` 只承载类型、端口和 runtime schema；流式终态以 `ModelStreamTerminalResultSchema` 声明，不导出终态判断 helper 或消费行为；Core、Workflow、model boundary 与 remote Gateway 在各自实现边界消费同一 schema
- 2026-07-31 contracts helper ownership 补充确认结论：需求方明确指出原 helper 不符合 `agent-contracts` 定位，已按上述边界收敛
- 2026-07-31 stream service ownership 补充确认参与者：本任务需求方
- 2026-07-31 stream service ownership 补充确认范围：后一轮确认取代此前 terminal marker/consumer helper 方案；`ModelInvocationService.stream(request, signal, onDelta)` 负责按序交付 delta 并通过 Promise 返回唯一 `ModelFinalResult`，Core、Workflow 与 Gateway consumer 不再判别尾事件，`agent-contracts/model` 不再声明 `ModelStreamTerminalResultSchema`；OpenAI-compatible adapter 使用 AI SDK `timeout.totalMs` 作为 provider request/retry/backoff 的唯一总时限，不保留自建 deadline controller/timer/race，仅按 caller signal 与 SDK timeout/stream completion 状态建立安全错误分类
- 2026-07-31 stream service ownership 补充确认结论：需求方明确提出并要求确认可行后实施
- 异议条目：无
- Follow-up：无
