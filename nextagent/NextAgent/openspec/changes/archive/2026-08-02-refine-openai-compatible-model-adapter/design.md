## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | 调用方只提交已选模型和动态输入；ready 前冻结 validated system model definitions 与 private provider binding，Gateway metadata 由首次 safe query 逐模型解析，失败只使对应模型不可用；标准 AI SDK 路径返回 provider-neutral 结果和 best-effort usage。 | `model-invocation-contract` 及 8 个迁移来源 specs | `FN-4.1 调用模型` |
| `FN-4.2 模型失败降级` | 模型边界拥有一次 logical invocation 内的同模型 retry；Agent Core 只决定是否允许 cross-model fallback，下一模型由 Context Engine 重新选择和装配。 | `model-fallback-semantics`、`routing-evidence-and-fallback` | `FN-4.2 模型失败降级` |
| `FN-4.3 装配上下文` | 主 Agent loop 与辅助模型消费者统一从 Agent 激活且当前可用的模型中选择，fallback 时按新模型重新预算和渲染。 | `context-engine` 及 4 个迁移来源 specs | `FN-4.3 装配上下文` |
| `FN-10.2 装配插件` | 模型选择与 fallback policy point 保持 `RESERVED`，避免插件绕过新的模型选择和降级 owner 边界。 | `agent-scoped-plugin-composition` | `FN-10.2 装配插件` |
| `FN-3.2 编译智能体装配` | 把混合 legacy Requirement 中触及的 assembly 黑盒行为迁入既有 canonical spec，并把省略模型激活范围定义为统一的编译期系统模型继承。 | `agent-package-assembly`、`app-config-schema`、`ts-minimal-agent-kernel` | `FN-3.2 编译智能体装配` |
| `FN-5.1 管理能力目录` | 把 custom Capability provider 的可信 adapter registration 行为迁入既有 canonical spec，不改变产品行为。 | `capability-source-configuration`、`ts-core-contracts` | `FN-5.1 管理能力目录` |
| `FN-5.2 调用能力` | Capability result 的 request-local 模型选择字段从不唯一 `modelName` 原子迁移到 canonical `modelId`；`modelOptions` 使用八字段 closed inference schema，且 `providerOptions` 只接受受治理 Skill metadata 来源。 | `capability-catalog`、`ts-core-contracts`、`context-engine` | `FN-5.2 调用能力` |
| `FN-10.4 自定义工具和提示词` | prompt manifest 使用只含 `modelId` 的 closed model match，把 prompt compatibility 与唯一 canonical model selection 接通，并使 template `modelOptions` 支持与模型配置一致的八个推理字段。 | `prompt-template-assembly`、`context-engine` | `FN-10.4 自定义工具和提示词` |
| `FN-10.1 注册和执行钩子` | `BEFORE_MODEL_INVOKE` mutation 与封闭扁平调用 schema 对齐，并保持 runtime stage authority 与模型 access authority 隔离。 | `lifecycle-hook-execution`、`model-invocation-contract` | `FN-10.1 注册和执行钩子` |
| `FN-1.20 查看推荐问题` | post-terminal 推荐生成消费统一 selection result 和真实 background scope，不再读取主 model profile、提交 descriptors 或冒用 completed run lifecycle。 | `question-recommendation`、`context-engine` | `FN-1.20 查看推荐问题` |
| `FN-8.3 记忆提取和老化` | 后台 LLM extraction 使用统一 selection、safe prompt projection 和真实 background scope。 | `memory-extraction`、`context-engine`、`model-invocation-contract` | `FN-8.3 记忆提取和老化` |
| `FN-5.9 调用技能` | Skill model metadata 原样映射为 canonical `modelId`，不再生成 `modelName` patch；Skill manifest/runtime `modelOptions` 支持与模型配置一致的八个推理字段。 | `skill-tool`、`capability-catalog`、`context-engine` | `FN-5.9 调用技能` |
| `FN-6.9 引用密钥` | 把两个混合 legacy Requirements 的 secret 行为迁入既有 canonical spec；`credentialRef` 从 legacy flat model profile 移到两层 `modelProfiles[]` 父项，Secret grammar、resolver 和实现保持不变。 | `secret-configuration-boundary`、`model-provider-configuration`、`ts-core-contracts` | `FN-6.9 引用密钥` |
| `FN-10.5 集成外部系统` | 把通用 Gateway 配置边界迁入既有 canonical spec，新增环境中立的 optional `FetchGateway` 与安全 merge 语义，并明确 model-information capability 只在 bootstrap 装配、不会形成 ready 前远程查询。 | `gateway-configuration`、`ts-core-contracts` | `FN-10.5 集成外部系统` |
| `FN-10.11 开发工作台` | 工作台从 canonical timeline 和 Agent assembly 读取 `stepId/modelId/modelIds/defaultModelId`，不建立平行 read model。 | `dev-agent-workbench`、`model-invocation-contract` | `FN-10.11 开发工作台` |
| `FN-7.5 采集指标` | model metrics 保留调用、duration、usage 和 stream timing 事实，移除没有 canonical 来源的 `provider_kind` label，且不以模型/provider identity 替代。 | `agent-runtime-metrics`、`model-invocation-contract` | `FN-7.5 采集指标` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `model-provider-configuration` / 全部 7 个 legacy Requirements | `FN-4.1` / `model-invocation-contract`；Secret behavior 迁入 `FN-6.9` / `secret-configuration-boundary` | 来源 7 个 `REMOVED` + 两个目标 specs 的 `ADDED/MODIFIED` | fail-fast/degraded-ready、Secret grammar/resolver/non-leakage 和全部模型配置行为均由目标 specs 完整承载；只迁移 `credentialRef` 字段 owner，不改变 Secret resolver behavior | 本 design 的 app config schema、目录 bootstrap、校验顺序、provider registration composition 和 Secret characterization | 归档后来源清空；从所属 Function、Feature、spec-to-design-map 和其他导航移除 legacy spec 引用后退役，不退役 Function/Feature |
| `model-profile-contracts` / `ModelProfile carries the model context window size`、`Context window is the assembly budget window source` | `FN-4.1` / `model-invocation-contract`；`FN-4.3` / `context-engine` | 来源 `REMOVED` + 两个目标 `ADDED` | 无 | 选择结果到 budget 的内部映射 | 归档后来源清空；清理 Function、Feature、spec-to-design-map 和其他导航后退役 |
| `model-info-contracts` / `ModelInfo carries the model context window size`、`Budget decision gate reads the real model window from ModelInfo` | `FN-4.1` / `model-invocation-contract`；`FN-4.3` / `context-engine` | 来源 `REMOVED` + 两个目标 `ADDED` | 无 | contract 到内部 read model 的映射 | 归档后来源清空；满足相同门禁后退役 |
| `model-provider-adapter` / `Agent-model owns internal provider adapter capability`、`Provider adapter consumes reviewed invocation inputs`、`Provider SDK remains internal to agent-model`、`Raw provider results stay inside agent-model boundaries`、`Provider adapter does not own fallback or routing` | `FN-4.1` / `model-invocation-contract`；fallback owner 同步到 `FN-4.2` | 来源 `REMOVED` + 目标 `ADDED/MODIFIED` | 来源 spec 中 `Provider adapter forwards failures to safe mapping` 等完全未触及 Requirements 原位保留 | adapter SPI、factory、SDK mapping | 来源 spec 保留 |
| `model-stream-normalization` / `Stream deltas are provider-neutral`、`Tool-call fragments preserve order and association`、`Streaming converges to the same terminal result contract` | `FN-4.1` / `model-invocation-contract` | 来源 `REMOVED` + 目标 `ADDED/MODIFIED` | 来源 spec 中 streaming semantic model 与通用 stream failure Requirements 原位保留 | SDK full-stream event mapping | 来源 spec 保留 |
| `app-config-schema` / `Successful validation produces immutable configuration artifacts` | `FN-4.1` / `model-invocation-contract`；`FN-3.2` / `agent-package-assembly`；Capability 与 Gateway 的固定下游边界由各自既有 canonical Requirements 承载 | 来源 `REMOVED` + `model-invocation-contract` 目标 `ADDED` + `agent-package-assembly` 目标 `MODIFIED` | 两层 canonical `modelProfiles` system config、validation evidence 与非运行期 authority 由 `FN-4.1` 目标 Requirements 承载；重复 host registry 删除；通用 freeze、readiness/evidence 生成和 dependency injection 属于 composition 白盒设计 | app config schema/env projection、provider registration composition、freeze 和 evidence | 来源 Requirement 删除，source spec 其他未触及 Requirements 保留 |
| `ts-core-contracts` / `Configuration And Secret Reference Baseline` | `FN-4.1` / `model-invocation-contract`；`FN-5.1` / `capability-source-configuration`；`FN-6.9` / `secret-configuration-boundary`；`FN-10.5` / `gateway-configuration` | 来源 `REMOVED` + 四个目标 `ADDED/MODIFIED` | 无 | contract package 与 resolver/adapter mapping | 来源 Requirement 删除，source spec 其他未触及 Requirements 保留 |
| `ts-core-contracts` / `Context And Model Contract Baseline`、`Model invocation requests carry trusted run coordinates for provider correlation` | `FN-4.1` / `model-invocation-contract`；`FN-4.3` / `context-engine` | 来源 `REMOVED` + 目标 `ADDED/MODIFIED` | history、active-context、compression 行为已由 `context-engine` 既有 Requirements 承载 | transaction、CAS、request builder、内部 coordinates | 来源 spec 保留 |
| `ts-core-contracts` / `Capability Context Patch Supports Governed Model Selection`；`capability-catalog` / `Executors Return Results Without Owning Runtime Side Effects` | `FN-5.2` / `capability-catalog`；选择消费与 trusted `identityContext` 由 `FN-4.3` / `context-engine` 承载 | core 来源 `REMOVED` + capability canonical `MODIFIED` + context canonical `MODIFIED` | generated messages、allowed tools、result refs 和 executor side-effect 禁止行为完整保留 | capability result schema、request-local patch state 与 selection adapter | `ts-core-contracts` 来源 Requirement 删除；`capability-catalog` 保留 |
| `prompt-template-assembly` / `Prompt assembly has one decision boundary`、`Prompt assembly boundary guardrails`、`Prompt template selection is deterministic` | `FN-10.4` / `prompt-template-assembly`；最终选择由 `FN-4.3` / `context-engine` 承载 | canonical `MODIFIED` | authoring 的 `modelName` 原子迁移为单一 `modelId`；template `modelOptions` 从三字段 numeric schema 收敛为八字段 closed inference schema；source priority、specificity、完整模板选择、rendering 和 fallback 保持不变 | prompt compiler/types、options handoff、compatibility evaluator、safe descriptor projection 与 selection adapter | source spec 保留；归档时原位替换三个 Requirement |
| `lifecycle-hook-execution` / `Stage-specific boundaries and mutations are minimal runtime contracts` | `FN-10.1` / `lifecycle-hook-execution`；调用字段与 validation 由 `FN-4.1` / `model-invocation-contract` 承载 | canonical `MODIFIED` | 其他 8 个 stage、runtime-owned reduction、hook ordering、pending、failure 和 observability 行为完整保留 | runtime mutation schema/reducer 与 model hook wrapper | source spec 保留；归档时原位替换该 Requirement |
| `question-recommendation` / `Model Invocation for Recommendations` | `FN-1.20` / `question-recommendation`；选择契约由 `FN-4.3` / `context-engine` 承载 | canonical `MODIFIED` | terminal guard、prompt variables、Skill context、output cleaning/parsing、API、cache 和 frontend 行为完整保留；post-terminal invocation 使用 background lifecycle | suggested-question service selection/invocation adapter | source spec 保留 |
| `memory-extraction` / `Extraction strategy and configuration` | `FN-8.3` / `memory-extraction`；选择与调用契约由 `FN-4.3` / `context-engine`、`FN-4.1` / `model-invocation-contract` 承载 | canonical `MODIFIED` | scheduler、RULE_FIRST、prompt safety、候选、observability、failure 和 memory lifecycle 行为完整保留 | extraction LLM strategy selection/prompt/invocation adapter | source spec 保留 |
| `skill-tool` / `Skill tool is the model-facing Skill execution entry` | `FN-5.9` / `skill-tool`；patch schema/selection governance 由 `FN-5.2` / `capability-catalog`、`FN-4.3` / `context-engine` 承载 | canonical `MODIFIED` | Skill `modelOptions` 从开放 `JsonObject` 收敛为八字段 closed inference schema，其中 `providerOptions` 只能来自已接受的受治理 Skill metadata；resolution、disclosure、inline body、tool-result settlement、budget 和 safe failure行为完整保留 | Skill manifest parser、`SkillMetadataSchema`、typed metadata 与 Capability result mapper | source spec 保留 |
| `ts-minimal-agent-kernel` / `Target-State TS Configuration Ownership And Agent Assembly Compilation`、`Context 和 Model 调用边界`、`最小真实 Model Provider` | `FN-4.1` / `model-invocation-contract`；`FN-4.3` / `context-engine`；`FN-3.2` / `agent-package-assembly` | 来源 `REMOVED` + 三个目标 `ADDED/MODIFIED` | 未触及的 package 输入、Capability binding 和 runtime 主链路行为继续由各自既有 canonical Requirements 承载 | package/file/composition、gateway transaction 与 E2E fixture | 来源 spec 保留 |
| `routing-evidence-and-fallback` / `Agent Core orchestrates model fallback explicitly` | `FN-4.2` / `model-fallback-semantics` | 来源 `REMOVED` + 目标同名 `ADDED` | 来源 spec 中完全未触及的通用 evidence Requirements 原位保留 | Core gate 与 evidence writer | 来源 spec 保留 |
| `agent-runtime-metrics` / `Metric inventory 必须声明来源、标签和增强需求`、`Metric labels 必须低基数且固定` | `FN-7.5` / `agent-runtime-metrics` | canonical `MODIFIED` | metric inventory 的名称、值、dedup、其他 labels 与 projection failure 语义保持；只移除 6 个 model metrics 的 `provider_kind` label 和 vocabulary | model observation mapper、metrics projector/descriptors 与 tests | source spec 保留；归档时原位替换两个 Requirements |

并行 active change 的来源侧和目标侧重叠关系如下：

| stable spec | 本 change 的 Requirement operation | 并行 active change / Requirement operation | 当前协调结论 |
|---|---|---|---|
| `app-config-schema` | `REMOVED`：`Successful validation produces immutable configuration artifacts` | `add-ts-runtime-operational-log-hardening` `MODIFIED`：`App composition schema exposes a stable first-release group baseline`；`configure-workspace-file-extensions` `ADDED`：`Agent workspace file extension authority` | Requirement 名称和语义边界均不重叠 |
| `ts-core-contracts` | `REMOVED`：`Configuration And Secret Reference Baseline`、`Context And Model Contract Baseline`、`Model invocation requests carry trusted run coordinates for provider correlation`、`Capability Context Patch Supports Governed Model Selection` | `add-ts-memory-application-contract` `MODIFIED`：`Core Contract Namespace`、`Contract Subpaths Remain Architecture-Owned`；`add-ts-task-channel` `MODIFIED`：`Runtime Command And RequestRun Baseline`；`refine-session-thinking-presentation-contract` `ADDED`：`Final thinking is a persisted form of LLM_THINKING_DELTA`、`Conversation message contracts remain unchanged by process history`、`RuntimeSessionPort exposes run-scoped event history` | 本 change 不修改并行 change 的 Requirement；`Core Contract Namespace` 的 `agent-contracts/model` 导航由后归档者基于最新 stable 内容保留 |
| `ts-minimal-agent-kernel` | `REMOVED`：`Target-State TS Configuration Ownership And Agent Assembly Compilation`、`Context 和 Model 调用边界`、`最小真实 Model Provider` | `add-ts-cron-tools` `ADDED`：`Cron trigger 使用标准 request lifecycle`；`add-ts-runtime-operational-log-hardening` `ADDED/MODIFIED`：`Execution-root exception termination remains owner-scoped`、`Productized Package Module Structure`；`refine-session-thinking-presentation-contract` `ADDED`：`Model producers persist the last accumulated thinking delta at model invocation completion`、`Workflow lifecycle does not own model thinking completion`、`Runtime event emission follows one persistence path`、`Runtime exposes one scoped event-history facade`；`refine-session-title-and-search-validation` `MODIFIED`：`Web Submit Stream And History`；`refine-ts-empty-terminal-output` `ADDED`：`Terminal assistant output must be non-empty`；`refine-ts-tool-loop-empty-tool-name-recovery` `ADDED`：`Tool loop recovers empty tool-name tool calls without interrupting the run` | Requirement 名称和语义边界均不重叠 |
| `dev-agent-workbench` / `Run-bound model invocations use one runtime timeline boundary`、`Workbench exposes a reconstructed run effective view` | `MODIFIED`：三个 lifecycle events 与 effective view 的 identity 从 `stepId/modelProfileId/providerKind/modelName` 原子迁移为 `stepId/modelId` 与 assembly `modelIds/defaultModelId`，并同步 producer、persisted schema、历史读取、observability 与 workbench projector | `add-ts-dev-agent-workbench` `ADDED`：同名 Requirements 及旧安全 payload | `add-ts-dev-agent-workbench` 是硬排序迁移来源，不是兼容目标；其实现/规格必须先形成可迁移 baseline，且必须先归档到 stable，本 change 才能归档。随后本 change 在同一发布单元应用本 change 的 `dev-agent-workbench` delta。不得双写、双读或保留 output-only alias |
| `agent-package-assembly` | `MODIFIED`：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup` | `configure-workspace-file-extensions` `ADDED`：`Agent-scoped file extension policy compilation` | 目标 Requirement 与 file-extension Requirement 独立 |
| `gateway-configuration` | `MODIFIED`：`Gateway configuration is loaded and stabilized during startup` | `add-ts-cron-tools` `ADDED`：`Cron gateway adapter selection` | 目标 Requirement 与 cron adapter selection 独立 |
| `prompt-template-assembly` | `MODIFIED`：`Prompt assembly has one decision boundary`、`Prompt assembly boundary guardrails`、`Prompt template selection is deterministic` | 当前检查未发现同名并行 delta | authoring 的 model identity 字段和 model-options schema 原子迁移；选择优先级不变 |
| `lifecycle-hook-execution` | `MODIFIED`：`Stage-specific boundaries and mutations are minimal runtime contracts` | 当前检查未发现同名并行 delta | 其他 stage 和 lifecycle semantics 不变；本 change 只迁移 model-invoke mutation vocabulary 与 protected fields |
| `question-recommendation` | `MODIFIED`：`Model Invocation for Recommendations` | 当前检查未发现同名并行 delta | 推荐业务与 API 不变；本 change 迁移模型选择、invocation projection 和 post-terminal background scope |
| `memory-extraction` | `MODIFIED`：`Extraction strategy and configuration` | 当前检查未发现同名并行 delta | memory extraction lifecycle 不变；本 change 只迁移 LLM selection/prompt/invocation path |
| `skill-tool` | `MODIFIED`：`Skill tool is the model-facing Skill execution entry` | 当前检查未发现同名并行 delta | Skill 执行其他行为不变；本 change 迁移 model patch identity、Skill model-options schema 与治理 handoff |
| `agent-runtime-metrics` | `MODIFIED`：`Metric inventory 必须声明来源、标签和增强需求`、`Metric labels 必须低基数且固定` | `add-ts-runtime-operational-log-hardening` 修改同一 spec 的其他 Requirements，并触达 metrics registry/sink tests | Requirement 不同且目标兼容：本 change 只改 model metric labels，operational-log change 拥有 registry/sink/exporter。实施与归档均基于最新内容保留双方行为 |
| `otel-trace-export` / trace projection implementation | 不修改该 spec；只使 model observation 不再提供 step/model/provider diagnostic attributes | `add-otlp-trace-export` 修改 trace projector 与 tests，定义 span nesting、kind、safeSummary/outcome | 保留其 span lifecycle/nesting/kind/link contract；本 change 只改变 model diagnostic candidate input，实施时合并同一 tests，不形成归档顺序依赖 |

除 `dev-agent-workbench` payload 行外，上述重叠不存在同名或语义冲突，因此没有固定归档先后依赖；后归档者基于最新 stable Requirement 应用自身 delta，并保留另一 change 的独立行为。`add-ts-dev-agent-workbench` 必须先归档到 stable，本 change 才能归档；不得复制其 active delta，也不得以双写、双读或 compatibility alias 绕过该顺序。应用本 change 的来源 `REMOVED` 和目标 `MODIFIED` 时，必须以最新 stable Requirement 名称和完整语义为准。

下方各 Function 的“目标 Requirements”只列归档后约束该 Function 的 canonical spec 及其 `ADDED/MODIFIED` Requirements；迁移来源和来源侧 `REMOVED` 关系以上表为准，不再重复。

## `FN-4.1 调用模型`

### 目标与规范依据

本 Function 需要满足 proposal 中“`modelProfiles[]` 以父层唯一 `providerId` 和子层唯一 `modelId` 表达 provider/model，且同一 `modelId` 直接传给 provider”“模型调用使用封闭调用 schema 和开放但保留字段受控的二次开发参数”“Gateway metadata 局部降级”“OpenAI-compatible 总时限内同模型 retry、消费可选通用 Gateway fetch 和 best-effort usage”的目标。本节设计 Agent App 模型配置投影、模型目录、调用授权和 provider adapter 的实现路径。

#### 本 Function 的目标 Requirements

canonical spec：`model-invocation-contract`

- `ADDED`：`全局模型目录提供安全模型配置`
- `ADDED`：`Invocation scope represents real lifecycle coordinates`
- `ADDED`：`模型调用时间线使用 canonical identity`
- `ADDED`：`模型接入配置只在模型边界内解析`
- `ADDED`：`OpenAI-compatible 调用遵循统一 Chat Completions 语义`
- `ADDED`：`模型 transport 通过可选 Gateway fetch 装配`
- `ADDED`：`可恢复错误按受控次数重试`
- `ADDED`：`成功调用尽量保留 provider usage`
- `ADDED`：`流式输出只暴露完整的 provider-neutral 事实`
- `ADDED`：`Agent App system config 使用 canonical model/provider 配置`
- `ADDED`：`可信 App Host 可读取配置快照但运行期模型功能不依赖它`
- `MODIFIED`：`Invocation semantics define one stable invocation capability`
- `MODIFIED`：`Model invocation is triggered as a request-step execution stage`
- `MODIFIED`：`Target-state request fields are stable invocation inputs`
- `MODIFIED`：`Invocation preconditions are validated before provider execution`
- `MODIFIED`：`Non-streaming and streaming invocation share one terminal result contract`
- `ADDED`：`Provider options remain an open selected-provider extension`
- `MODIFIED`：`Profile timeout constrains provider execution`
- `MODIFIED`：`Failure exits are explicit and safe`

#### 设计约束

- `agent-model` 是 ready 后全局模型目录、provider binding、模型调用和结果归一化的唯一 owner。
- `agent-app` 保留配置读取、校验、不可变配置产物、验证证据和 composition，不形成第二个运行期模型目录。
- 模型调用请求中的单一 lifecycle-neutral scope、selected `modelId`、可选推理参数和开放但保留字段受控的 `providerOptions` 来自受信任调用路径；owning run-bound orchestrator 将 `stepId` 的同一值作为 `operationId` 与 accepted run coordinates 原子写入 scope，background owner 将已经冻结的 cycle/post-terminal identity 作为 `operationId`，只在存在真实相关 run 时携带完整 causal correlation。run-bound/background 由可信调用路径而非 scope shape 决定；`operationId` 只用于关联/审计，不参与推理、选择、routing、授权或幂等。locale 留在 selection/prompt 层；`providerId`、endpoint、credential、app 交付的通用 Gateway fetch 和其他接入事实不离开模型边界。
- 目标实现只发布一套模型调用 contract、一个 model-owned catalog 和一个 compatible adapter path。

### 当前实现

- `packages/agent-app/src/config/model-profiles.ts` 创建 `ModelProfileRegistry`，同时负责 profile lookup、enabled/fallback index、provider route descriptor 和 assembly selection。
- `ModelInfo` 和 `ModelInvocationRequest` 都复制 `providerKind`、`modelName`、`baseUrl`、`credentialRef` 和 `timeoutMs`；`modelProfileId` 与 `invocationScope` 为 optional。
- `model-request-builder.ts` 把 Context Engine 选中模型的 access 配置复制进请求；fallback path 再通过 provider/model/endpoint/credential 反查 profile identity。
- `ModelGatewayProvider` 只创建 invocation service，不能向统一模型边界提供安全模型信息。
- OpenAI-compatible 产品路径位于 `packages/agent-model/src/providers/openrouter/`，使用 OpenRouter 专属 SDK，并保留自定义 header fetch、timeout signal、raw stream/tool/usage 处理和宽泛类型断言。
- 既有 run-bound invocation 直接从 access-bearing `ModelInvocationRequest` 复制 `modelProfileId`、`providerKind` 和 `modelName` 形成 `MODEL_INVOCATION_*` 安全 payload；请求收窄后该来源将消失。
- 既有 compatible outbound transport 可以发送 raw `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`。
- 成功 `ModelFinalResult` 可携带 provider-reported `providerModelId`；`usage` 可以缺少部分或全部 token 数。
- production `NextAgentApp` 当前同时返回 `systemConfig`、`modelProfileRegistry` 和 `productModelProviderKind`；已归档的 app-composition baseline 与现有 composition/kernel/smoke tests 固定了这三个顶层投影。仓内全量 consumer 盘点显示 `productModelProviderKind` 没有 production reader，只被这些测试断言，且实际 provider selection/binding 由 composition input 与 provider registry 决定；在多 provider 目录下该单值摘要不能表达真实配置。当前 `systemConfig.modelProfiles` 与 registry 直接使用 legacy `profileId/providerKind/modelName/baseUrl/credentialRef/modelOptions` contract，且部分内部模型路径或测试把 registry 当作运行期权威。
- `ModelProfileRegistry.selectForAssembly()` 当前被 Context Engine/summary、workflow、memory extraction、suggested questions、Capability composition 和 model-provider health probe 消费；`modelInfoForAssembly()` 还被 contract tests 固定。若只删除 registry 的运行期选择方法而不逐一迁移这些 consumer，既可能留下平行模型选择，也可能让 health/readiness 路径重新引入 Gateway 启动依赖。

#### `ModelInvocationScope` 下游消费者盘点与兼容结论

按当前 production path 盘点字段级 consumer：

| consumer | 当前读取/传播的 scope facts | 目标影响与保持方式 |
|---|---|---|
| `agent-model` invocation preconditions | Agent 与 session/request/run coordinates，用于 accepted scope/run association | Owner/Agent 必填保持；run coordinates 改为 all-or-none optional，Core run-bound timeline wrapper 仍与 accepted run/context 原子校验 |
| `agent-model` lifecycle-hook wrapper | tenant/subject、Agent/version/assembly、optional session/request/run，构造 model hook context | configured runtime 对每次 concrete provider invocation 执行同一 model hook；runtime 以可信活跃/终态事实区分 run-bound/background，post-terminal causal coordinates 只用于关联 |
| OpenAI-compatible/OpenRouter HTTP transport | `agentId` 与 session/request/run，生成既有四个 correlation headers | 字段消费移入 `agent-model` 共用 composer；完整 run 三元组时生成既有四个 headers，无 run 时只生成 Agent header |
| `ModelGatewayProvider` / remote invocation client | 整体透传 canonical `ModelInvocationRequest` | 继续透传同一个 closed scope，把 optional run coordinates 作为关联事实，并通过 Gateway contract tests 固定 external interface shape |
| Core run-bound timeline wrapper | accepted run/context 与 owning step；目标需要从 scope 读取统一 operation | wrapper 由可信 composition 选择，校验完整 run coordinates 后把 `operationId` 原值投影为既有 timeline `stepId` |
| observability adapters | 当前没有直接读取 `ModelInvocationScope` 字段的公共 projection；但 timeline observation mapper 从 `MODEL_INVOCATION_*` payload 读取 `stepId/providerKind`，缺少任一值会丢弃 model observation，并把 `stepId/providerKind/modelProfileId` 作为低基数 diagnostic candidates；metrics projector 再从 `providerKind` 生成 `provider_kind` label | mapper 原子改为校验 `stepId/modelId` 并只把 `stepId` 用作进程内 duration/first-visible pairing，不把 `stepId/modelId/providerId` 写入 diagnostic candidates、trace/log/metric；保留 duration、usage、first-visible、failure 与 trace lifecycle。model metric descriptors 移除 `provider_kind` label，不以 canonical identity 或固定 `OTHER` 替代 |
| dev workbench projection | 不直接读取 scope；当前 server/browser projector、SQLite read port 和事件详情读取 timeline 的 `modelProfileId/providerKind/modelName` | 与 timeline 同一发布单元改为 `stepId/modelId`，不保留 alias、dual read 或 background recommendation event |

producer 的真实输入分为 run-bound 与 background 两类：Agent loop、summary、workflow 等 run-bound producer 持有 accepted run 与 owning step；memory extraction 持有 scheduler/cycle identity；recommendation service 在实际模型调用边界建立 fresh operation identity，并持有 completed-run causal coordinates。单一 closed scope 用 required `operationId` 统一承载关联 identity，以 all-or-none optional run coordinates 承载真实因果关联；可信 call path 继续拥有 lifecycle。现有字段消费者均可从该 shape 获得所需事实，模型推理、model selection、provider binding、routing、授权、幂等和 retry 不消费 `operationId`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| ready 后只有一个安全模型配置权威 | `agent-app` registry 同时承载配置、route 和选择 | `agent-model` 需要拥有模型目录，owning modules 需要消费窄化 query/selection |
| provider-specific 窗口与可用性由模型目录统一解释 | 全部窗口只接受 profile 静态值，Gateway 无模型信息能力 | 需要为 compatible 和 Gateway 定义唯一 metadata source；Gateway 查询失败只标记受影响 profile |
| 模型身份收敛为单一 `modelId` | `profileId`、`modelProfileId`、`providerKind` 和 `modelName` 同时传播 | 需要以唯一 `modelId` 收敛 profile、Agent 激活、选择、request、timeline 和 provider 调用身份，用父层 `providerId` exact lookup 可信 provider registration，并把同一 `modelId` 传给 provider |
| 调用方只提交 selected model 和动态输入 | 请求复制 provider identity、endpoint、credential；推理参数包在 `commonOptions` | 需要展开受控可选参数、保留 adapter 校验的 `providerOptions`，并在模型边界内部解析 access binding |
| lifecycle scope 表达真实关联事实且 lifecycle authority 留在可信调用路径 | scope optional，后台调用可能伪造 request-run coordinates | 需要 required single closed scope、all-or-none optional run coordinates 和受信任 call-path/scope 校验 |
| provider adapter 只暴露 provider-neutral 结果 | compatible path 包含 SDK 专属与自定义协议处理 | compatible 调用需要收敛到唯一 AI SDK 标准路径 |
| 同模型 recoverable failure 使用显式 retry 语义 | adapter 固定 `maxRetries: 0`，部分 caller 另有 retry loop | 需要模型边界作为唯一同模型 retry owner，使用请求值、profile 默认值或固定 `2`，全部 attempt/backoff 共享总 timeout，并与 cross-model fallback 分层 |
| HTTPS 身份处理可按运行环境定制 | 当前 adapter 具备测试用 `fetchImpl`，但环境差异没有 Gateway contract | 需要在 `agent-contracts/gateway` 定义环境中立的 optional `FetchGateway`，由 app 在 bindings 完成后装配给当前模型 consumer；LOCAL 缺省不装配，REMOTE 实现留在仓库外；其他 REST client 不在本 change 迁移 |
| compatible 成功结果尽量保留 usage | 当前 provider 路径的 usage 解析不统一 | 需要逐字段保留有效 provider usage；缺失、不支持或非法字段不得改变成功结果 |
| Agent App system config 与 canonical model contract 同步，Host projection 不保留平行模型事实 | `NextAgentApp` 暴露 config、legacy registry 和没有 production reader 的单 provider 摘要；`DefaultSystemConfig.modelProfiles` 当前直接引用旧 `agent-contracts/app.ModelProfile`，因此“模型 identity 原子迁移”与“嵌套 shape 完全不变”无法同时成立 | 只保留 `systemConfig` 且不新增 model API；删除 `modelProfileRegistry` 与 `productModelProviderKind`；把 system config 收敛为父层 provider access + 子层 models 的唯一 `modelProfiles[]`，并在同一冻结快照保留 validation evidence；provider selection/binding 只使用 exact `providerId`，通过 private composition 注入窄依赖 |
| 请求收窄后模型调用安全 payload 使用 canonical identity | payload identity 当前来自将被删除的 request access fields；observability mapper/metrics 与 workbench 仍依赖旧 payload 字段 | 需要从 accepted step 和 canonical selected `modelId` 原子生成 `stepId/modelId`，删除 provider descriptors；observability 只用 canonical identity 校验/pairing而不导出高基数维度，工作台从正式 timeline 显示 canonical identity |
| lifecycle scope 最小披露 | 旧 contract 由具体 adapter 生成 Agent/session/request/run headers，且没有 background 无真实 run、统一 operation 或集中 owner 规则 | 需要由 `agent-model` 集中生成固定的既有四个 correlation headers，按 scope 的完整 run 坐标决定后三个是否存在；`agentId` 作为非敏感 correlation fact 原值发送，本 change 不增加 header policy |

### 修改方案

#### 全局模型目录的启动索引与按需解析

`agent-app` 继续读取并校验 raw config，派生和冻结 `DefaultSystemConfig`，生成 `ConfigValidationEvidence`。模型配置只使用两层 `modelProfiles[]`：父项表达唯一 `providerId`、optional `baseUrl/credentialRef` 和 required `models[]`；子项表达唯一 `modelId`、模型画像、availability input、fallback policy、全部 optional provider-neutral inference fields、optional `providerOptions`、`timeoutMs` 和 `maxRetries`。子 profile 存在于配置中即进入 catalog bootstrap input，不建立 `enabled` 或 disabled 状态；只有通过本地 schema/security 校验并被接受的 typed child profiles 才能进入 catalog。`agent-model` 以父项唯一 `providerId` exact lookup 可信 provider runtime registration，并由命中的 registration 校验 access config、持有 provider implementation、credential resolver 或 `ModelGatewayProvider`；模型 adapter 使用的运行环境相关 custom fetch 只从 app 已完成的 optional `GatewayBindings.fetch` 装配。既有规则排除的非关键 fallback-only profile 保留 safe validation evidence，但不触发 provider metadata。

目标 frozen config 使用以下唯一模型配置分层：

```ts
interface DefaultSystemConfig {
  readonly modelProfiles: readonly ModelProviderProfile[];
}

interface ModelProviderProfile {
  readonly providerId: string;
  readonly baseUrl?: string;
  readonly credentialRef?: SecretReference;
  readonly models: readonly ModelProfile[];
}

interface ModelProfile {
  readonly modelId: string;
  readonly fallbackEligible: boolean;
  readonly displayName?: string;
  readonly contextWindowTokens?: number;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly thinking?: ThinkingOptions;
  readonly providerOptions?: JsonObject;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}
```

bundled `default-system.yaml` 的目标模型段固定为：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: env:OPENAI_BASE_URL
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: env:OPENAI_MODEL_NAME
        displayName: Default OpenAI Model
        contextWindowTokens: 128000
        fallbackEligible: false
        temperature: 0.2
        maxOutputTokens: 2048
        topP: 1
        timeoutMs: 120000
```

产品配置的 `providerId` 清单与 access shape 固定如下：

| `providerId` | Registration | `baseUrl` | `credentialRef` | 模型信息来源 |
|---|---|---|---|---|
| `openai-compatible` | framework-owned AI SDK compatible registration | required | optional；缺失时不发送 credential | 子 `ModelProfile.contextWindowTokens` |
| `model-gateway` | 可信 App composition 中恰好一个 `ModelGatewayProvider` | forbidden | optional；缺失时不发送 credential | ready 后首次 safe query 调用 provider-private model-information service |

custom fetch 不是 system config 或 model profile contribution；模型 adapter 只能从 optional `GatewayBindings.fetch` 取得该能力。`FetchGateway` 本身是可复用的环境 transport contract，不以模型命名；本 change 不迁移其他 REST client 或建立第二套 HTTP abstraction。父项 `providerId` 不在清单内、无法 exact lookup 到唯一 registration，或 access shape 不符合上表时，catalog 发布前失败；实现不按 `providerId` 字符串猜测 provider class，也不从环境或子 profile 隐式补齐 access 字段。

单一 `modelId` 取消了 `default-openai -> provider model name` 的双 identity 映射。Agent definition 省略 `modelIds` 时，通用 assembly compiler 必须从同一个 frozen `systemConfig.modelProfiles` 按 provider/profile 配置顺序解析全部已校验 canonical model ids；显式非空 `modelIds` 保持 Agent 自身的有序激活范围，显式空数组、重复或未知引用安全失败，不能按省略处理。该规则同等适用于 bundled、顶层 local Agent 和 parent subagent，runtime `AgentAssembly` 始终携带解析后的显式非空 `modelIds`；省略 `defaultModelId` 时不合成 global default，由 initial selection 使用第一个 eligible id。bundled Agent manifest 因此不硬编码部署模型，也不解析环境变量；builtin discovery 不再拥有模型 normalization 特例。构造 default Agent assembly 的测试 fixture 只从 `agent-app` testing surface 导出，物理实现归 testing 目录，名称显式表达 test fixture，调用方必须显式传入 fixture `modelId`；产品 assembly 模块不得保留 test model 默认值或该 fixture 的平行实现。

既有 fallback-only invalid-credential degrade 规则按父项 ownership 迁移：先取得该父项 `models[]` 的全部 configured profiles；只有 `credentialRef` grammar 非法、全部受影响 profiles 均为 fallback-eligible、且排除后仍有 viable non-fallback profile 时，validator 才可排除整个受影响集合并生成 provider/model-id safe evidence。父项包含 primary profile、排除后无 viable profile或错误属于其他字段/绑定时均 fail closed。这样不会因为 credential 从 child profile 提升到共享父项而只排除部分模型或形成同一 provider 的半有效状态。

Host 模型配置投影只保留 `NextAgentApp.systemConfig`。其 `modelProfiles` 保持两层配置顺序，`modelProfileValidationEvidence` 使用 frozen `modelId/code/message` items。扁平 profile 清单、fallback id 列表和 exact lookup 都是 Host 可从该快照按需派生的瞬时视图，不再维护 `modelProfileRegistry`、configured ids、membership 或其他重复 index。所有 in-repo runtime consumers 使用 model-owned query 或 Context Engine selection，诊断直接读取同一 config evidence。

`agent-app` preparation 先把 accepted nested definitions 与 trusted `ModelGatewayProvider[]` 交给 `agent-model` 的无副作用 provider-input preparation，由 model owner 执行需要 Gateway 时的 required-singleton 校验并返回 prepared input，以保持其他 Gateway composition 前的既有 fail-fast 语义；该阶段不创建 registration、model service、model-information service、compatible adapter 或 lazy catalog。validated `systemConfig.modelProfiles` 已由 app config 边界递归冻结，是 startup assembly compile、Capability graph validation 和受控 hot reload publication 的唯一模型引用校验来源；assembly compiler 直接读取该对象，不建立 configured ids、membership port 或另一份模型存在性权威，也不执行远程 I/O。

Gateway bindings 完成后，app 再把该 prepared input、credential resolver、optional injected model，以及由 optional `FetchGateway` 适配出的 private fetch function 交给 `agent-model` configured runtime factory；app 不创建、选择或持有 provider runtime registration。`agent-model` 按 configured `providerId` exact matching 构造唯一 registration 集合；每个 registration 私有持有 provider implementation、父层 access validator、endpoint、credential reference/resolver 和 metadata resolver。compatible registration 可持有 app 交付的 optional transport，Gateway registration 持有 invocation 与 model-information capability。configured runtime 内部复用同一 frozen definition/binding state，但只向 app composition 交付两个明确端口：供 Context Engine selection 和 deep health 使用的既有 `ModelCatalogQueryService(list/get)`，以及供 invocation authorization 使用的 `ModelInvocationService(complete/stream)`。app 只按 composition-root 职责把这两个 owning contracts 分发给对应消费者，不构造 registration，也不建立平行 catalog 名称或 mega-interface。Agent 激活目录外 `modelId` 时在 assembly publication 前失败；激活已知 Gateway 模型不依赖其运行期可用性。accepted Assembly 因此不需要在选择阶段重复校验 unknown activation；选择阶段通过 safe query 解析并排除 `UNAVAILABLE` 模型，全部候选被排除时返回显式安全失败。

catalog factory 在 ready 前对每个 locally valid configured profile 执行：

1. 按两层 closed schema 校验父项 `providerId` 唯一、子项 `modelId` 全局唯一，以及 profile 的可选推理默认值、可选 provider options、可选 timeout、可选 max retries 和 provider-specific context window 输入。
2. 根据父项 `providerId` exact lookup 恰好一个 provider runtime registration，由该 registration 校验父层 access config，并取得 provider implementation 与 metadata resolver。
3. 对 compatible profile 校验本地正整数 `contextWindowTokens` 并构造 frozen `AVAILABLE` entry；对 Gateway profile 建立尚未远程解析的 private slot，不调用 model-information service。
4. 构造 private provider binding 和逐模型 catalog slot；只有已经解析为 `AVAILABLE` 的 entry 包含 resolved configuration。
5. 按配置顺序建立 private model slot index 和 fallback index，并向 app-private composition 提供 `ModelCatalogQueryService`。

应用在上述本地步骤完成后即可进入 ready。首次 `get(modelId, signal)` 只解析目标 Gateway slot；首次 `list(signal)` 并发解析全部尚未解析的 Gateway slots。每个 slot 首次完成后冻结为 `AVAILABLE | UNAVAILABLE`，直到进程重启；受控 Agent hot reload 直接以当前 frozen `systemConfig.modelProfiles` 校验新 assembly 的 `modelIds`，失败时保留当前 active assembly 与现有 catalog。

#### 私有 catalog 数据结构

`agent-model` 内部从同一个 validated profile definition 生成两个投影：

```ts
interface ModelProviderBinding {
  readonly modelId: string;
  readonly providerId: string;
  readonly profileProviderOptions?: JsonObject;
}

interface ResolvedModelConfiguration {
  readonly modelId: string;
  readonly contextWindowTokens: number;
  readonly defaultTimeoutMs: number;
  readonly defaultMaxRetries: number;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly topP: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly thinking?: ThinkingOptions;
}

type ModelCatalogEntry =
  | {
      readonly availability: "AVAILABLE";
      readonly fallbackEligible: boolean;
      readonly displayName?: string;
      readonly configuration: ResolvedModelConfiguration;
    }
  | {
      readonly modelId: string;
      readonly availability: "UNAVAILABLE";
      readonly fallbackEligible: boolean;
      readonly displayName?: string;
      readonly unavailableReason: ModelUnavailableReason;
    };

type ModelCatalogSlot =
  | {
      readonly state: "UNRESOLVED";
      readonly definition: ModelProfileDefinition;
    }
  | {
      readonly state: "RESOLVING";
      readonly resolution: Promise<ModelCatalogEntry>;
    }
  | {
      readonly state: "RESOLVED";
      readonly entry: ModelCatalogEntry;
    };
```

`ModelProviderBinding` 只用于 `agent-model` 内部把 canonical `modelId` 绑定到 provider runtime registration；调用时同一 `modelId` 原值传给 provider。endpoint、credential reference/resolver 和 metadata resolver 由该 registration 私有持有；`agent-app` 持有 optional `FetchGateway` contract，并把其操作适配成 compatible registration 的 private fetch function，`agent-model` 不直接依赖 gateway contract subpath。该 port 属于通用环境 transport 能力；当前 change 只增加模型消费路径。binding、registration 与 fetch port 均不进入 public query、Context Assembly、Rendered Model Input、Model Invocation Request、日志、metric、trace 或 audit。`ModelCatalogEntry` 是安全查询投影；`AVAILABLE` entry 的唯一模型身份位于 required `configuration.modelId`，不在顶层重复；`UNAVAILABLE` entry 因不存在 configuration 而在顶层携带 required `modelId`。`unavailableReason` 使用低基数封闭 reason code，不包含 raw provider error。

`ModelCatalogSlot` 只存在于 `agent-model`。compatible profile 在 bootstrap 后直接处于 `RESOLVED`；Gateway profile 初始处于 `UNRESOLVED`。第一个查询把 slot 原子替换为 `RESOLVING`，并发查询复用同一个 promise；成功或 provider-neutral unavailable 结果原子替换为 frozen `RESOLVED`。owning query 取消时不生成 `UNAVAILABLE`，slot 回到 `UNRESOLVED`；仍有未取消 waiter 时，由其中一个 waiter 重新进入相同 single-flight 路径。`list()` 以同一个 required signal 并发解析全部未解析 slots，任一取消使该调用不返回部分数组；各模型的 provider-neutral unavailable 仍作为独立目录项返回。公共 contract 不增加 `UNRESOLVED` 或 `RESOLVING` 分支。

profile `providerOptions` 保存在 private binding；safe catalog query 不返回该对象。调用请求可以携带 inner `providerOptions`，但不能携带 provider namespace。adapter 对 profile 默认对象与调用对象执行顶层浅合并，同名嵌套对象整体替换，再执行 reserved-field validation 并交给 AI SDK 的 selected-provider namespace。未知 JSON 字段必须原样保留；只有与 model/messages/tools/stream、canonical inference/thinking controls、timeout/retry、identity/access/transport 等 authority 重复的 camelCase 或 provider-native keys 被拒绝。

通用默认值和调用值使用封闭的 NextAgent-owned flat fields：`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking`。profile 与调用请求中的这些字段均 optional。

optional fields 的 effective value 只有以下一套解析规则：

| Optional fields | 缺省语义 |
|---|---|
| `temperature` | profile → selected Prompt Template → governed Capability patch → trusted request → governed hook，后层优先；全部缺失时为 `0.55` |
| `maxOutputTokens` | 同一固定 precedence；全部缺失时为 `32,000` |
| `topP` | 同一固定 precedence；全部缺失时为 `1` |
| `topK`、`presencePenalty`、`frequencyPenalty`、`thinking` | 同一固定 precedence；全部缺失时保持缺失并使用 provider 缺省语义，不建立 NextAgent 固定默认值 |
| `providerOptions` | 使用相同层次顺序，但 Capability layer 只接受 governed Skill patch；执行顶层浅合并，后层同名字段覆盖前层且嵌套对象整体替换；全部缺失时不向 provider 传递该字段，也不合成空对象 |
| `timeoutMs` | governed hook 覆盖 trusted request，trusted request 覆盖 profile；全部缺失时为 `30,000 ms`，再与 execution budget 剩余时长取较小值 |
| `maxRetries` | governed hook 覆盖 trusted request，trusted request 覆盖 profile；全部缺失时为 `2` |
| `displayName` | 缺失时保持缺失，不从 model identity 合成 |
| `AgentAssembly.defaultModelId` | 缺失时 initial selection 使用 `modelIds` 顺序中的第一个 eligible model |
| selection `locale` | 缺失时不施加 locale-specific filter，继续使用既有 deterministic prompt fallback |
| selection `modelId` | 缺失时不施加显式 model-id filter；initial selection 优先合法 `defaultModelId`，否则使用 `modelIds` 顺序中的第一个 eligible model |
| Capability `contextPatch.modelId/modelOptions` | 缺失时不覆盖后续选择/参数；单个 model option 缺失时不覆盖该字段 |
| `BEFORE_MODEL_INVOKE` mutation optional fields | 缺失时保持 hook 前 effective value，不清空字段且不由 hook 合成默认值；后续仍按上述固定 precedence 与 fixed-default 规则解析 |

`contextWindowTokens` 不使用固定默认值：compatible profile 必须配置合法值，Gateway profile 必须从 trusted model-information 得到合法值。

固定推理默认值只由 `agent-model` catalog resolution 拥有并投影到 `ResolvedModelConfiguration`。`agent-app` config validation 只校验 optional profile 输入，Prompt Template、Skill、Capability 和 hook 只表达显式 override，均不得复制或自行填充这些默认值。配置 authoring surface 的 `RawModelProfileConfig` 必须复用 canonical `ModelProfile` 字段类型，向开发者提供明确的 string/number/boolean/`ThinkingOptions`/`JsonObject` 类型；不可信运行时入口仍只接收 `unknown`，model provider/profile parser 在 `Record<string, unknown>` 上逐字段收窄后才能构造 validated profile，不得用 authoring surface 的强类型替代 runtime validation，也不得用全字段 `unknown` 污染开发期类型。bundled `default-system.yaml` 在同一迁移中把 `modelProfiles[]` 改为父层 provider access + 子层 models，把 legacy `profileId/modelName` 收敛为单一 `modelId`，删除 `providerKind` 和 legacy `modelOptions` wrapper，并把原有显式 `temperature=0.2`、`maxOutputTokens=2048`、`topP=1` 与 `timeoutMs=120000` 原样迁入子 profile；固定 `0.55`、`32,000`、`1` 和 `30,000 ms` 只适用于 profile 确实省略对应字段的情形，不得在 shape 迁移时替换既有显式配置。原空 `providerOptions` 由 optional 字段缺失无损表达，原 `enabled=true` 由子 profile 存在即配置的目标语义无损表达。raw env projection 同步解析父项 `baseUrl` 和子项 `modelId`。

#### Provider-specific metadata resolver

每个 provider adapter 提供内部统一 resolver：

```ts
interface ModelMetadataResolver {
  resolve(
    definition: ModelProfileDefinition,
    signal: AbortSignal
  ): Promise<ResolvedModelMetadata>;
}
```

| `providerId` exact lookup 命中的 registration implementation | `contextWindowTokens` 唯一来源 | 目录解析行为 |
|---|---|---|
| `openai-compatible` | profile 静态正整数 | bootstrap 时解析；缺失或非法时启动失败 |
| `model-gateway` | trusted Gateway model-information capability | ready 后首次安全目录查询时解析；查询成功时 `AVAILABLE`，查询失败、模型不存在或返回非法值时 `UNAVAILABLE` |

Gateway 静态窗口不作为 fallback，避免同一字段有两个权威来源。Gateway profile 在 safe query 触发前只保留 validated definition 与 binding，不形成公共未解析目录项。本地已拒绝或由受控 degraded-ready 规则排除的 profile 不进入 slot map，因此始终不触发远程查询。

`ModelGatewayProvider` composition contract 增加 `createModelInformationService(): ModelGatewayModelInformationService`。该 provider-private service 的 `get(modelId, signal)` 只返回 specs 定义的封闭 `FOUND | NOT_FOUND | UNAVAILABLE` union；`FOUND` 携带 `{ modelId, contextWindowTokens }`，`UNAVAILABLE` 只携带 `MODEL_INFORMATION_UNAVAILABLE | MODEL_INFORMATION_AMBIGUOUS`。catalog 在首次安全目录查询时使用当前 configured profile 的同一 `modelId` 查询，并把 required caller signal 传给 resolver；不创建后台 refresh 或脱离 caller lifecycle 的 metadata request。transport/authentication failure 映射为 `MODEL_INFORMATION_UNAVAILABLE`，not found 映射为 `MODEL_NOT_FOUND`，歧义映射为 `MODEL_INFORMATION_AMBIGUOUS`，非法窗口映射为 `CONTEXT_WINDOW_INVALID`。vendor DTO、endpoint、credential 和 raw error 留在 remote adapter 内。

#### 公共模型配置查询

本 change 在 `agent-contracts/model` 新增 app-private composition 使用的 `ModelCatalogQueryService`，提供 specs 定义的 `list(signal: AbortSignal)` 和 `get(modelId, signal: AbortSignal)`。默认实现读取同一个 private model slot index，并在需要时通过对应 slot 的 metadata resolver 完成逐模型解析；它不进入 `NextAgentApp` public shape，调用方也不能依赖其私有状态表示。

- `list()` 并发解析全部尚未解析的 locally valid configured profiles，返回全部 safe catalog entries 并保持 profile configuration order；单个 unavailable entry 不使整体查询失败。
- `get()` 只解析已知 configured `modelId` 的目标 slot，并返回 `AVAILABLE | UNAVAILABLE` entry；对未知 id 直接返回 `undefined`，不调用 provider。
- 首次完成解析的 entry 逐模型冻结到进程重启；重复查询读取 frozen entry，并发查询复用同一 in-flight resolution。
- `AVAILABLE` entry 携带唯一 resolved configuration，且不在 `configuration.modelId` 外重复顶层模型身份；`UNAVAILABLE` entry 只携带 safe `modelId`、availability、fallback eligibility 和低基数 reason。
- resolved configuration 只包含单一 `modelId` identity；prompt-template compatibility、选择、授权、provider 调用和 exact matching 都使用该值。`providerId`、`providerKind` 和 provider registration class 不进入 safe catalog、selection、prompt input 或 timeline payload。
- `agent-capability` 的 `CapabilityProvider.providerKind` 属于 capability provider 分类契约，不在本 change 的删除范围内；本 change 只删除模型配置、模型选择、模型调用、prompt model match 与模型 timeline 中的 `providerKind`。
- 两个方法都不返回 access 配置、provider-private metadata 或 SDK 对象。
- `AVAILABLE`/`UNAVAILABLE` 是封闭判别联合；resolved configuration 与 unavailable reason 互斥，字段集合、默认值、null/unknown-field 行为和 reason vocabulary 全部以 canonical spec 为唯一来源。

`agent-app` 在 private composition 中把 frozen `systemConfig` 交给 startup assembly compile、Capability graph validation 和 hot reload publication；Gateway bindings 完成后，再把 configured runtime 的 `ModelCatalogQueryService` 注入 Context Engine 和 health，把独立 `ModelInvocationService` 注入 invocation authorization。Context Engine selection 只接收命名的 `ModelCatalogQueryService`，不得补入同步存在性方法或通过无意义改名建立平行接口；其他消费者只接收 owning contract。Context Engine selection、summary、workflow、memory extraction 和 suggested questions 统一经 selection service 使用 safe query；Capability startup graph validation 只读取 `systemConfig.modelProfiles` 校验模型引用，不解析 availability。model-provider health probe 不再读取 host-only registry：startup readiness 与 primary health 不运行 safe query；应用 ready 后显式执行 deep probe 时，使用 health evaluator 的 signal 对 default-route Agent 的 explicit default model（缺失时为第一个 activated model）调用 `get`，并只投影安全 availability/reason。这样 deep health 可以成为首次 Gateway metadata consumer，但不会形成启动依赖。

production `NextAgentApp` 的模型相关顶层 public shape 恰好为 `systemConfig`；`RuntimeModelProviderKind`、composition input `modelProviderKind`、public `modelProfileRegistry`、`productModelProviderKind` 及其 product/test consumer 原子删除，不保留 alias、重复 index 或等价 provider-class summary。`systemConfig` 使用上述两层 `modelProfiles` 和 frozen `modelProfileValidationEvidence`。catalog/query/binding 通过 app-private composition 注入 owning modules；该公共配置只服务可信 Host，provider selection/binding 只使用 exact `providerId`。

#### 收窄公共调用契约

公共字段和单一 closed `ModelInvocationScope` shape 以 `model-invocation-contract` 和 `ts-core-contracts` specs 为唯一来源。封闭请求 schema 的 required 字段恰好为 `invocationScope`、`modelId`、messages 和 tools；optional 字段恰好为 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking`、`providerOptions`、`timeoutMs` 和 `maxRetries`。scope required `operationId`，optional `sessionId/requestId/runId` all-or-none。locale 在 selection 和 prompt assembly 完成后停止传播；provider-specific locale 语义如确有需要，只能由 selected-adapter reserved-field validated provider option 表达，本 change 不新增 locale header。

`agent-contracts/model` MUST 拥有一个 canonical `ModelInferenceOptions` type/runtime schema，结构恰好为七个 provider-neutral fields 加 optional `providerOptions`。`CapabilityContextPatch.modelOptions`、compiled Prompt Template `modelOptions` 和 `SkillMetadata.modelOptions` MUST 复用该结构，不得各自维护平行字段集合或 range/null 规则；source authority 仍由各自 owner 单独校验，尤其 structural schema 接受 `providerOptions` 不等于任意 Capability result 获得该字段 authority。`ModelProfile` 和 `ModelInvocationRequest` 继续使用 flat fields，不新增 nested wrapper，但同名字段约束 MUST 复用该 canonical vocabulary。

owning run-bound orchestrator 在进入 accepted request-run orchestration step 时建立 `stepId`，并把同一值作为 `operationId` 与真实 session/request/run coordinates 一次性构造 scope；default Agent loop 和 summary 由 `agent-core` 构造，workflow model node 由持有 trusted `WorkflowNodeHandlerContext` 的 workflow orchestrator 构造。memory background scope 使用 scheduler/cycle owner 已冻结的 `cycleId` 并省略不存在的 run coordinates。recommendation service 只在 terminal 预计算或 Web 按需路径实际启动模型调用前建立 fresh `operationId`，同时把 completed session/request/run 作为真实 causal correlation。上游领域唯一保留自身既有 `stepId`、`cycleId` 与 request/run contract，进入模型边界后统一使用 `operationId`。optional run coordinates 只表达 correlation；可信调用路径拥有 lifecycle。

`agent-model` 在公共 invocation 校验后为 outbound model HTTP transport 使用一个共用 correlation-header composer。framework-owned header 名称集合恰好为既有 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`。composer 始终从 trusted `agentId` 生成 Agent header；完整 session/request/run coordinates 存在时原子生成其余三个 headers，三者缺失时全部省略。tenant/subject、agent version/assembly、operation 和其他 raw lifecycle coordinate 留在 trusted invocation envelope，不进入 provider-native body/model-visible input。request、hook、provider options、caller 和具体 adapter 均不接受或覆盖 header；`ModelGatewayProvider` 继续在 trusted invocation envelope 中接收完整 canonical request/scope，把 optional coordinates 只作为关联事实，也不把 scope 转成下游模型可见输入或 provider-native body。

Core run-bound timeline wrapper 由可信 composition/call path 显式选择，直接从 schema-valid `request.invocationScope.operationId` 读取 owning step 的同一值。wrapper 在 provider execution 前把 scope 中的 Owner/Agent/session/request/run/operation coordinates 与自身已经持有的 accepted run/context 作为同一组 facts 校验；可信调用路径提供 lifecycle authority。`ModelInvocationRequest.modelId` 独立提供 canonical selected model。default Agent loop 复用已建立的 `turn-${round + 1}` step，summary 复用 owning summary step，workflow model node 复用其 `workflow:${executionId}:${nodeId}` step，其他 run-bound consumer 复用 owning orchestrator 已建立的 step identity。`operationId` 在 model scope 中只用于 correlation/observability/audit，不是 logical invocation id，也不参与选择、provider routing、授权、幂等或推理；同一步骤内多个顺序模型调用复用该值，由各 timeline event 自身的 event identity 和 sequence 区分各 started/terminal pair。

started、completed 和 failed 三个事件都把同一 scope `operationId` 原值投影为既有 payload `stepId`，并使用 request 的 `modelId`。同模型 retry 在模型边界内完成，只形成一个 started/terminal event 对；Core 触发 cross-model fallback 时在 scope 复用该 orchestration step 的 operation value，但使用重新选择的 `modelId` 形成新的事件对。没有 accepted run step 的 consumer 使用 background path；background 调用即使携带 completed-run correlation，其 `operationId` 也不进入 Core run-bound timeline wrapper 或投影成 timeline `stepId`。producer、runtime/persisted schema、历史读取、`agent-observability` timeline mapper/trace/metric projector、dev workbench server/browser projector 和 tests 在同一发布单元删除 `modelProfileId`、`providerKind` 和 `modelName`，不提供 alias、dual write 或 dual read。

Observability mapper 要求 model timeline event 同时具有 `stepId/modelId` 才产生 model observation；`stepId` 只用于 mapper 进程内 started/terminal duration 与 first-visible pairing，`modelId` 只用于验证 canonical event identity。二者以及 `providerId` 都不进入 diagnostic candidates、structured log detail、trace attributes 或 metric labels。duration、usage、first-visible、failure mapping 与 stable run/timeline refs 保持。既有 model metric names、values、dedup 与 outcome/token labels 保持，6 个 model metrics 的 `provider_kind` label 从 descriptors/projector/tests 删除；不得合成 `OTHER` 或引入 `modelId/providerId` label。workbench 事件标签、详情和 SQLite/browser 投影继续从正式 timeline 使用 `stepId/modelId`。投影不泄漏 endpoint、credential、header 或 provider option value。

本 change 不定义 `ModelOutboundHeaderPolicy` 或任何额外 provider-facing header marker。`agentId` 是非敏感 correlation fact，直接进入固定 `X-NextAgent-Agent-Id` header，不需要 opaque mapping。若当前或后续部署由 OpenTelemetry/SDK transport instrumentation 传播 W3C context，该路径仍由 `agent-observability` 或运行环境 transport 独立拥有；本 change 不声明其 header shape，也不改变 model request contract、provider selection 或 retry 语义。

通用参数逐字段解析，调用值覆盖 profile 默认值；两者都缺失时，`temperature`、`maxOutputTokens` 和 `topP` 分别使用 `0.55`、`32,000` 和 `1`，`topK`、`presencePenalty`、`frequencyPenalty` 和 `thinking` 保持 absent 并由 adapter/provider 使用缺省语义。`providerOptions` 使用顶层浅合并，调用值覆盖同名 profile 顶层值，嵌套对象整体替换。

effective timeout 和 max retries 只有一个计算位置：

```text
requestedTimeoutMs =
  request.timeoutMs
    ?? profile.timeoutMs
    ?? 30_000

effectiveTimeoutMs =
  min(requestedTimeoutMs, remainingExecutionBudgetMs)

effectiveMaxRetries =
  request.maxRetries
    ?? profile.maxRetries
    ?? 2
```

effective timeout 在 logical invocation 开始时冻结为绝对 deadline。每次 provider attempt 和 backoff 只使用 `deadline - now` 的剩余时长，不能重算或重置；initial request、全部 retry 和 backoff 的总墙钟耗时不超过该值。runtime/core cancellation signal、effective deadline 和 effective max retries 一起交给 adapter，形成唯一的 cancellation/timeout/retry 执行机制。`maxRetries` 表示初始 provider request 之后的 retry 次数，只处理 SDK/provider 明确标记为 recoverable 的 failure。流式调用产生任何 public delta 后结束 retry eligibility。

固定值 `2` 是 NextAgent 显式拥有的可靠性策略：一次 logical invocation 最多形成一次 initial provider request 和两次 retry，在为瞬时可恢复错误保留两次恢复机会的同时限制 provider 工作量、成本和终态延迟放大，并继续受同一 effective timeout、cancellation 和 execution budget 约束。模型边界是同模型 retry 的唯一 owner；summary、memory、recommendation、workflow、Core 和其他 caller 删除外层 retry loop并只调用一次 `complete()` 或 `stream()`。该值当前与 AI SDK 6 默认重试次数一致，用于减少接入行为差异；后续 SDK 默认值变化不改变 NextAgent 的固定值。

inner `providerOptions` 只有五个授权来源：

1. 通过启动期 schema 和安全校验的 profile defaults，由 private binding 持有；
2. 已编译并为最终 selected model 选中的 Prompt Template `modelOptions.providerOptions`；
3. 已接受的受治理 `SkillMetadata.modelOptions.providerOptions`，由 Skill Tool 映射为 Capability context patch；
4. 可信 Agent 开发代码构造的 `ModelInputRenderRequest.providerOptions` 或 `ModelInvocationRequest.providerOptions`；
5. 已激活且具有 model-invocation transform authority 的 `BEFORE_MODEL_INVOKE` hook mutation，并通过 runtime mutation schema 校验。

Prompt compiler 和 Skill metadata parser 只执行 closed outer shape、null 与保留字段校验；最终模型确定后，Context Engine 按 selected Prompt Template → governed Skill patch → trusted request 的固定优先级组装 call-level `providerOptions`，不读取 private profile defaults。模型调用边界再把 private profile defaults 置于该 composite 之前、把 governed hook 置于其后，形成 profile → template → Skill → request → hook 的最终逻辑 precedence。各层之间执行顶层浅合并，同名嵌套对象整体替换，再由 selected adapter 执行 reserved-field validation；未知 JSON 字段保持开放并原样转交 AI SDK provider namespace。render、Capability patch 和 lifecycle wrapper 只 carry 已授权值，不因此成为新来源。history、Capability 参数、非 Skill Tool 的 Capability result、Skill input/body、Web/client、RuntimeCommand、模型输出和其他 metadata 均不得产生 inner `providerOptions`。

`BEFORE_MODEL_INVOKE` trusted mutation 只允许修改 messages、tools、已开放的可选通用参数、inner `providerOptions`、timeout 和 max retries；selected `modelId`、invocation scope、catalog defaults、provider binding 和 header authority 保持受保护。scope `operationId` 与 optional run coordinates 由 owning lifecycle 冻结；可信 invocation path 决定 hook 是否应用。prompt locale 在上游 selection/rendering 后停止传播。既有 public `RequestModelOptions.thinking.depth="OFF"` 仍按其 stable contract 进入可信 merge。

#### Invocation binding 与 Agent activation 校验

`ModelInvocationService` 按以下顺序处理：

1. 按 closed schema 校验 required request fields、单一 scope、messages、tools、全部 optional inference/execution fields、cancellation 和 execution budget；要求合法 `operationId`，optional session/request/run coordinates all-or-none，并拒绝 synthetic coordinates、unknown fields 和越权 metadata。
2. 用 scope 中的 `agentId`、`agentVersion`、`agentAssemblyRef` 读取同一个 accepted assembly；通用模型边界校验 trusted Owner/Agent scope，Core run-bound timeline wrapper 再与其持有的 accepted run/context 原子校验真实 session/request/run/operation coordinates；background path 不从 scope shape 推断 lifecycle。`operationId` 本身不作为 authorization、selection、routing 或 idempotency key。
3. 校验 `modelId` 属于该 assembly 的 `modelIds`。
4. 从 catalog 读取同 id entry 和 private binding；未知、`UNAVAILABLE` 或未激活时安全失败。
5. 根据 binding 的 `providerId` exact lookup 唯一内部 provider registration。
6. 在 adapter boundary 内解析 credential reference。
7. 解析 effective optional parameters、AI SDK total timeout 和 max retries；浅合并 provider options 并拒绝 reserved authority collision；集中生成既有 correlation headers。
8. 以 request 的同一 `modelId` 执行 selected model；只在明确 recoverable、尚未产生 public delta且总时限仍有剩余时按 effective max retries 重试，并归一化结果。

`agent-model` 对 assembly registry 的读取是 invocation authorization，不是模型选择；它不读取 Agent default 或候选顺序。

#### AI SDK 6 标准调用路径

仓库固定使用 `ai@6.0.235` 和 `@ai-sdk/openai-compatible@2.0.62`。唯一 compatible model factory 使用 `createOpenAICompatible({ name, apiKey, baseURL, fetch, includeUsage: true }).chatModel(modelId)`。其中 `name` 由 private provider binding 的 `providerId` 稳定派生，`modelId` 来自 selected model request，`apiKey` 与 `baseURL` 来自该 `providerId` exact lookup 命中的可信 provider runtime registration；optional `fetch` 只来自 app 在 Gateway bindings 完成后交付的 `FetchGateway` adapter。

非流式调用使用 `generateText(...)`；流式调用使用 `streamText(...)` 的 `onChunk` 只投影实时 `text-delta`、`reasoning-delta` 和完整 `tool-call`，并使用 SDK 的 `text`、`reasoningText`、`toolCalls`、provider-neutral `finishReason`、`totalUsage` 与 `response` Promise 构造唯一终态。adapter 不得请求或解析 raw chunks，也不得再次累计 content/reasoning/tool calls、读取 `rawFinishReason`、解释 `finish-step`/`finish` 或维护平行 usage/response state。流式与非流式 SDK 结果必须经同一个 terminal mapper 转为 `ModelFinalResult`。二者共用同一 prompt bridge：存在非 system message 时，NextAgent `SYSTEM` content 只进入 AI SDK `system` option，从 `messages` 排除，并设置 `allowSystemInMessages=false` 使未来回流安全失败；system-only 请求为保留既有合法调用 shape，以 `allowSystemInMessages=true` 继续交给 `messages`，该分支没有可被提升权限的低优先级 message。该 bridge 不改变发往 provider 的 system role 语义，也不得通过全局 warning suppression 掩盖混合消息映射错误。二者共同把 caller `abortSignal` 与 effective timeout 作为 AI SDK `abortSignal` 和 `timeout.totalMs` 传入；SDK total timeout 是 initial provider request、retry 和 backoff 的唯一执行时限机制，adapter 不再建立第二个 `AbortController`、timer 或 Promise race。caller signal 已取消时映射为 `MODEL_ABORTED`；非 caller 的 SDK timeout/abort 映射为 `MODEL_TIMEOUT`；SDK 报告无输出终态时映射为 `MODEL_STREAM_ABORTED`。若 SDK retry 不能同时满足“总 timeout 不重置、public delta 后不 retry、header marker 稳定”，adapter 必须把 SDK `maxRetries` 设为 `0` 并在唯一模型边界以受测 loop 实现 effective retry；不得同时启用两层 retry。adapter 用外层 `try/catch` 捕获 SDK 已归一化的 transport、abort、timeout 和 no-output failure。

标准适配边界固定为：

- AI SDK 构造 Chat Completions endpoint、request body 和 provider DTO；
- optional `FetchGateway` 通过 app composition 适配为 compatible factory 的 private fetch；缺失时省略该 SDK option；
- inner `providerOptions` 包装到 AI SDK 的 `openaiCompatible` provider namespace；SDK 已知字段由 SDK 解释，其他非保留字段由 SDK extension path 原样进入 provider-native body；
- AI SDK 接收 caller cancellation signal 与单一 `timeout.totalMs`，其 internal retry/backoff 共享该 total timeout，retry 只由模型边界一个位置拥有；
- AI SDK `onChunk` 是实时 provider-neutral delta 的唯一输入，SDK final-result promises 是 content、reasoning、tool call、finish、usage 和 response normalization 的唯一输入；
- NextAgent global catalog 独立拥有 Agent activation、模型可用性、窗口和 fallback eligibility；
- SDK message、tool、result 和 stream part 使用受约束类型 bridge。

兼容模型以 `<think>...</think>` 输出 text-level reasoning 时，registration 使用 AI SDK `extractReasoningMiddleware` 与 `wrapLanguageModel` 把标签内容转为 SDK reasoning；adapter 不维护自定义标签状态机，不读取 raw transport，也不覆盖 SDK 原生 `reasoning_content/reasoning` 归一化路径。

#### Thinking、tool 和 usage 映射

`ThinkingOptions` 保持 optional provider-neutral 调用字段。compatible adapter factory 在模型边界内提供一个明确的 `ReasoningCapability`，为每个支持的 depth 固定一种映射结果：

- thinking 缺失时不生成 provider option；
- `OFF` 的映射结果只能是生成 provider-native 显式关闭 option，或在 capability 能保证 selected model 省略 reasoning option 时不执行 reasoning 的条件下省略该 option；
- provider reasoning 为 mandatory、缺省可能开启或 capability 不能证明省略后关闭时，`OFF` 映射为 unsupported，并在 provider access 前安全失败；
- `LOW | MEDIUM | HIGH` 只在 capability 明确支持时映射，不用通用硬编码表猜测 provider-native 枚举；
- 顶层 `thinking` 是公共 thinking/reasoning input control 的唯一 authority；compatible adapter 在私有边界把它映射为 provider-native reasoning option。`providerOptions` 保持开放，但 reserved-field validation 拒绝 `reasoning`、`thinking`、`reasoningEffort`、`reasoning_effort` 或其他与顶层 `thinking` 重复的 provider-native reasoning control。

首个 compatible adapter 的 capability mapping 和 provider-options reserved-field set 由其 factory 与 request-level tests 固定，后续 provider adapter 使用各自 mapping；公共 spec 不承诺某个 provider-native reasoning 值，也不封闭未知 provider extension keys。

本 change 的 reasoning 处理范围固定为调用参数映射、输出归一化和既有展示/时间线交付。`ModelMessage` 输入、Agent Core 工具轮续接和跨轮上下文沿用当前契约，adapter 不形成可回传的 provider continuation state。需要把 reasoning text、signature 或其他 provider continuation metadata 回传给模型的兼容能力由独立 change 定义并验证。

公共 `ModelToolDescriptor.inputSchema` 先通过 JSON object/runtime schema validation，再通过窄类型 bridge 进入 AI SDK `jsonSchema` 与 `tool`。tool definitions 不提供 `execute`，也不启用 SDK multi-step tool loop；Capability authorization、Tool 执行、结果回填和迭代上限继续由 Agent Core 拥有。

非流式 usage 只取 `generateText().usage`；流式 usage 只取 `streamText().totalUsage`。adapter 对 `inputTokens`、`outputTokens`、`totalTokens` 逐字段校验：provider 报告的非负整数原样保留，缺失、不支持或非法字段省略；若没有任何有效字段，则省略整个 `usage`。usage 不完整不改变 content/tool/finish 已成功归一化的终态，也不补零、不估算、不推导。

`ModelInvocationRequest.modelId` 是一次调用的 canonical model identity，调用方和 timeline 持有该事实。`ModelFinalResult` 的 required field 是 `content`，optional fields 恰好为 `reasoning`、`finishReason`、`usage`、`toolCalls`、`providerResponseId` 和 `safeError`。provider response 中的 model identity 只作为 adapter 内部 normalization input；`providerResponseId` 只用于安全 response correlation。流式与非流式终态使用同一结果 shape。`ModelInvocationService.stream(request, signal, onDelta)` await callback 交付 delta，并用返回 Promise 单独交付 final；位置已表达终态，因此不需要 terminal marker、public discriminator 或跨 Core/Workflow/Gateway 重复的判别 helper。`agent-model` 的统一 lifecycle wrapper 校验 inner delta/final，并在 `AFTER_MODEL_RESULT` 前执行终态语义收敛：`content-filter` 固定映射为 non-retryable `POLICY_DENIED` 并移除 content/reasoning/tool calls；无 `safeError` 的 `error`、无 Tool call 的 `unknown`、无完整 Tool call 的 `tool-calls` 映射为 non-retryable 安全失败；`stop` 与非空 Tool calls 的组合保持合法并进入 Core Tool loop。已有 `safeError` 保留 provider/model boundary 已建立的 recoverability。该约束不改变 `ModelFinalResult` shape，也不修改既有 `length` 恢复流程。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Invocation scope represents real lifecycle coordinates`、`模型接入配置只在模型边界内解析`、`模型 transport 通过可选 Gateway fetch 装配`、`Provider options remain an open selected-provider extension`、`Failure exits are explicit and safe`、`可信 App Host 可读取配置快照但运行期模型功能不依赖它` | provider binding 与 correlation-header composer 只存在于 `agent-model`，optional fetch contract 属于 Gateway 并只由 app composition 交给 model；required scope、all-or-none run coordinates、Agent activation、provider-options reserved fields 和 safe query 在 provider access 前校验；framework-owned correlation header 集合固定为既有四个名称，raw access、option/header value 和 provider error 不离开模型边界 | contract negative、correlation-header exact projection、operation non-influence、secret leakage、provider-options source/reserved-field/unknown pass-through、optional fetch isolation、Agent Scope、safe error tests |
| 可靠性/恢复 | `可恢复错误按受控次数重试`、`Profile timeout constrains provider execution`、`Failure exits are explicit and safe` | 调用值、profile 默认值和固定 fallback 解析为唯一 timeout/max-retries；模型边界独占同模型 retry，所有 attempt/backoff 共享 absolute deadline且不越过 public delta，cancellation/budget 独立生效；usage 缺失或非法只省略字段 | retryable/non-retryable、default/override、stream-after-delta、total-timeout/cancel、caller retry absence、完整/部分/非法 usage、single terminal tests |
| 可维护性 | `Invocation semantics define one stable invocation capability`、`模型 transport 通过可选 Gateway fetch 装配`、`可信 App Host 可读取配置快照但运行期模型功能不依赖它` | 一个 flat NextAgent invocation contract、一个 model-owned catalog 和一个 AI SDK 标准 adapter path；optional fetch 只经 GatewayBindings → app → model registration 装配 | public export、dependency direction、唯一 adapter/retry path review |
| 可测试性 | 无新增黑盒质量目标；实现约束来自 `全局模型目录提供安全模型配置` 及本 Function 的 provider boundary | catalog query、metadata resolver、credential resolver 和 adapter factory 使用可注入 async/cancellable boundary，固定 provider-neutral fixtures | catalog/resolver unit、adapter request-level、contract tests |

## `FN-4.2 模型失败降级`

### 目标与规范依据

本 Function 需要满足 proposal 中“主 Agent loop 允许 fallback 时选择下一模型并重新装配”的目标。`Agent Core orchestrates model fallback explicitly` 定义可观察 fallback 行为，`Fallback is not owned by the model invocation boundary` 允许模型边界内受控的同 `modelId` recoverable retry，但禁止 adapter 隐式 cross-model fallback。

#### 本 Function 的目标 Requirements

canonical spec：`model-fallback-semantics`

- `ADDED`：`Agent Core orchestrates model fallback explicitly`
- `MODIFIED`：`Fallback is not owned by the model invocation boundary`
- `MODIFIED`：`Future fallback evaluation consumes stabilized candidates and safe failure facts`

### 当前实现

- Agent Core 同时拥有 fallback lifecycle gate 和 candidate route selection。
- fallback route 复制 provider access，并通过 route fields 反查 profile id。
- 切换模型后复用第一次 render 的 messages、prompt 选择与 context budget。
- visible-output、deadline、cancellation、attempted ids 和 evidence gate 已存在并必须保留。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Core 只判断是否允许再尝试 | Core 同时维护候选配置并选择 route | Core 需要仅消费 Context Engine 的 fallback selection result |
| 下一模型由统一选择规则确定 | fallback 通过 route descriptor 替换 | 需要把 attempted ids 交给 Context Engine trusted selection |
| fallback 使用新模型上下文 | 当前复用前一次 render | 需要重新 assemble、budget 和 render |
| adapter 不执行 cross-model fallback | provider path 固定不重试，异常分类与 Core fallback 混在一起 | 需要让模型边界先按 contract 完成同模型 recoverable retry，再向 Core 返回 non-recoverable 或 retry-exhausted safe failure |

### 修改方案

#### Fallback 通过 trusted reassembly 重新选择

模型调用边界先在 selected `modelId` 内按 effective max retries 处理明确 recoverable failure。仍失败时，Core 继续拥有 cancellation、remaining deadline/budget、visible-output、same-step replay gate、attempted model ids 和 evidence。gate 允许时，Core 使用相同 `ContextAssemblyRequest` 和累计 attempted ids 请求 Context Engine fallback assembly；Context Engine 返回新模型对应的 assembly/render 结果后，Core 构造下一次 model invocation。

fallback reassembly 继续读取 session authoritative active-context view，并遵守既有 active-context version/CAS 和 same-session lane。若重装配发生版本冲突、压缩冲突或安全失败，Core 记录 fallback-denied/exhausted safe evidence，不复用第一次 render，也不绕过 lane 发起第二次调用。

Core 只记录 fallback-applied、fallback-denied 或 fallback-exhausted evidence，不读取 endpoint、credential、raw provider error 或模型目录。secondary consumers 不因本 change 获得 fallback；未来若其 owning spec 允许重试，consumer 只拥有 lifecycle gate，下一模型仍由统一 selection service 选择。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirements 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；实现约束来自 `Agent Core orchestrates model fallback explicitly`、`Fallback is not owned by the model invocation boundary` | 模型边界先完成同模型 recoverable retry；Core 只保留 cancellation、deadline/budget、visible-output 和 cross-model replay gate，不选择模型、不查询 access route，也不允许 adapter 隐式切换模型 | same-model retry exhausted、fallback allowed/denied/exhausted、visible-output、deadline/cancellation tests |
| 审计/可追溯性 | 既有 `Routing evidence owns future fallback evidence` | Core 只记录 applied、denied 或 exhausted 及低基数安全 reason，不记录 endpoint、credential 或 raw provider error | evidence outcome、safe payload、redaction tests |

## `FN-4.3 装配上下文`

### 目标与规范依据

本 Function 需要满足 proposal 中“所有模型调用目的只在 Agent 激活且当前可用的模型中选择”和“conversation fallback 按新模型重新预算与 render”的目标。

#### 本 Function 的目标 Requirements

canonical spec：`context-engine`

- `ADDED`：`Model selection uses Agent-activated model configurations`
- `ADDED`：`上下文预算使用所选模型的已解析窗口`
- `ADDED`：`Fallback selection recomputes model-specific context`
- `MODIFIED`：`Context Engine separates assembly from rendering`

### 当前实现

- `DefaultContextEngine.resolveModelSelection(...)` 存在，但产品路径把最终选择委托给 app/core resolver。
- app composition 向 Context Engine 注入 `selectForAssembly(...)` 和 `promptModelCandidates`。
- Core capability patch resolver、memory、session、workflow 等路径各有 profile/default resolver。
- Context Engine 直接读取 app-owned profile registry，且假设全部 context window 来自 profile 静态字段。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 一个 async/cancellable selection contract 服务全部调用目的 | 多个模块各自选择 default/first profile | 需要统一 `ModelSelectionService` |
| 只从 accepted Agent 激活模型中选择 | resolver 可读取 app registry/global candidates | 需要以 accepted assembly 为候选根 |
| 选择使用 safe model configuration | Context Engine 读取 access-bearing profile | 需要只依赖 model-owned safe query |
| fallback 排除 attempted 且要求 eligibility | Core 直接选择 route | 需要 trusted mode/attempted input |
| 预算使用本次 selected model 窗口 | fallback 复用第一次 budget | 需要每次 selection 后重新预算/render |

### 修改方案

#### Context Engine 拥有唯一模型选择服务

`agent-contracts/context` 提供 specs 定义的 `ModelSelectionService.select(request, signal)`，由 `agent-context-engine` 实现。`ModelSelectionRequest` 复用既有 `IdentityContext` 并显式携带 accepted `agentId/agentVersion/agentAssemblyRef`；其 `INITIAL | FALLBACK` mode 只区分首次选择与显式跨模型 fallback，不表达 provider、stream 或 routing mode。`SELECTED` result 原样复用命中 available catalog entry 的 frozen `ResolvedModelConfiguration`，query 和 selection 只维护一种模型配置 shape。request、`SELECTED | FAILED` result、成功/失败 reason vocabulary 和 cancellation behavior 以 canonical spec 为唯一来源。由于 accepted Assembly 已在 publication 阶段通过 frozen system config 完成模型引用校验，selection 不保留 unknown-activation failure；`UNAVAILABLE` 通过候选排除和 `NO_AVAILABLE_MODEL` 表达。`ContextEnginePort.assemble(request, options, signal)` 与其私有实现或 facade 共同消费这一唯一选择服务。

selection request 只接受受信任的 Owner/Agent scope、purpose、locale、governed explicit `modelId`、string flow variables、mode 和 attempted model ids。Web body、RuntimeCommand、Capability arguments、model output 或任意 metadata 都不能直接构造该 request。

选择顺序固定为：

1. 按 accepted `AgentAssembly.modelIds` 声明顺序形成激活列表。
2. 按该顺序调用 safe catalog `get(modelId, signal)` 查询每个 activated id；只触发这些模型的 lazy metadata resolution，未知 id 安全失败，`UNAVAILABLE` entry 从候选中排除。
3. fallback mode 移除 attempted ids，并只保留 `fallbackEligible=true`。
4. 对剩余 `AVAILABLE` entries 应用受信任 customer availability。
5. 应用 prompt-compatible model ids；空集合表示 prompt 不约束模型。
6. 应用受治理的显式 `modelId`。
7. initial mode 优先合法 `defaultModelId`，否则选择第一项。
8. fallback mode 选择剩余第一项，不重新引入 default。
9. 返回同一个 immutable `ResolvedModelConfiguration` 与 closed reason code。

availability 是 Context Engine selection policy 的过滤阶段，不是调用方候选输入。customer availability 只通过窄 policy port 注入；返回值必须是当前 activated candidates 的子集，且不能包含 access 配置或目录外 id。

#### 直接模型调用方的迁移规则

| 调用目的 | selection 输入 | 调用方继续拥有 |
|---|---|---|
| 主 Agent loop | accepted request scope、`SYSTEM_PROMPT`、locale、flow variables、Capability 显式模型选择 | request/tool loop orchestration |
| summary generation | accepted request scope、`SUMMARY_GENERATION`、locale、当前 context assembly 的 trusted string-only flow variables | summary prompt、compression commit |
| memory extraction | active Agent scope、trusted maintenance identity、`MEMORY_EXTRACTION`、Agent locale | trajectory projection、candidate validation、memory lifecycle |
| suggested questions | terminal run scope、internal purpose、受控 options override | recommendation prompt、解析、空结果降级 |
| workflow model nodes | workflow accepted scope、compiled node purpose/constraint/options | node lifecycle、prompt/input/output schema |

AI SDK 的责任边界结束于一次 selected-model provider turn：compatible adapter 使用 SDK 完成 request mapping、transport、同模型 retry/timeout、provider stream normalization、reasoning extraction、tool-call fragment assembly 和 terminal aggregation。它不接管 NextAgent Agent loop。Core 对 public delta 的累计只服务可见输出限制、reasoning/timeline 投影、`length` recovery 和最终用户输出；非空完整 Tool calls 的授权、Capability 执行、结果回填、pending、sandbox 与下一轮 invocation 继续由 Core 拥有。Workflow 的 delta forwarding 与 complete fallback 只服务 node output projection；remote Gateway 对 delta/final 的 schema validation 只服务不可信远端边界。以上调用方不得读取 provider-native event、raw chunk、SDK result 或自行判别 stream terminal。

每个 consumer 对一次 logical invocation 只调用一次 `ModelInvocationService.complete()` 或 `stream()`。现有 summary generator 的 caller-level same-model retry loop 必须删除；memory、recommendation、workflow 和 Core 同样不得新增外层 retry。`maxRetries` 与总 timeout 只由模型边界解析和执行。

Core 在进入 Context Engine 前把 runtime `RequestContext.flowVariables` 浅投影为 trusted string-only map；非 string runtime state 和保存原始用户问题的 `input_question` 不跨越 prompt selection boundary。`input_question` 继续留在 runtime/core 执行上下文供既有受治理用途读取，不进入 `ContextAssemblyRequest.flowVariables`。一次 context assembly 中的主 prompt 和 summary compression 共用该 trusted projection。`TraceableSummaryGenerationRequest` required `flowVariables` 显式承接它，summary generator 将同一 map 交给 `ModelSelectionService` 与最终 `PromptTemplateAssembler`，不得 hard-code `{}`、维护第二份 match map 或为此 deep clone runtime context。

`DefaultTraceableSummaryGenerator` 是唯一 production summary generator，并在每次 `generate()` 中直接按 request Agent scope 完成 assembly lookup、model selection、prompt assembly 和 invocation request construction。`agent-app` 只把该实现所需端口装配一次；模型选择迁入该实现后，不再保留没有独立生命周期或行为的 `createRequestScopedSummaryGenerator` wrapper、重复 options type、public export 或平行测试入口。

调用方先获得 selection，再使用 selected `modelId`、catalog 的 effective 通用默认参数和自身受控可选参数构造 flat invocation input。resolved configuration 始终包含 `temperature`、`maxOutputTokens` 和 `topP` 的 effective 值，其余通用参数保持 optional。locale 在 selection 与 prompt template matching/rendering 中消费，完成后不进入 invocation request。resolved configuration 的单一 `modelId` 投影到 prompt compatibility，run-bound timeline identity 由独立 lifecycle wrapper 组合；provider access 不进入 invocation request，也不参与模型选择。调用级 inner `providerOptions` 只能来自已编译且选中的 Prompt Template、受治理 Skill metadata mapping、可信 Agent 开发代码构造的 render/invocation request 或受治理 hook；Context Engine 和 lifecycle wrapper 只传递并合并已经通过来源治理的值，最终仍由 selected adapter 校验。

主 Context Assembly 直接使用 selected configuration 的 resolved window 和七个 provider-neutral 默认参数，并按 profile defaults、selected Prompt Template options、governed Capability options、受治理 invocation request 的顺序逐字段合并；`BEFORE_MODEL_INVOKE` mutation 由后续模型 lifecycle boundary 作为最后一层应用。Context Engine 对 call-level `providerOptions` 的 Capability layer 只接受受治理 Skill patch，并按 Prompt Template → Skill → trusted request 顶层浅合并，同名嵌套对象整体替换，不读取 private profile defaults；模型调用边界再把 private profile defaults 置于该 composite 之前并应用 hook。全部层均未提供时，`temperature`、`maxOutputTokens` 和 `topP` 分别解析为 `0.55`、`32,000` 和 `1`，其他推理参数保持 optional，`providerOptions` 不合成空对象。summary、memory、session 和 workflow 在各自 prompt/invocation assembly 中完成同类合并；Context budget 必须使用最终 effective `maxOutputTokens`，不能把缺失值按 `0` 处理。

`contextPatch.modelId` 是 governed canonical model selection input；`contextPatch.modelOptions` 使用八字段 closed inference schema。`providerOptions` 只在当前 invocation target 是受治理 Skill Tool，且该值来自已接受 `SkillMetadata.modelOptions` 的内部映射时有效；Core 以已经持有的 capability/Skill resolution 事实校验该来源，不增加客户端或 Capability 可填写的 provenance 字段。其他 Capability result、Capability 参数或模型输出即使给出同形字段也必须安全失败。`modelId` 缺失不覆盖后续选择；`modelOptions` 或其中任一字段缺失不建立 Capability-specific 默认值。

#### Trusted fallback assembly options

`ContextEnginePort.assemble` 接受 specs 定义的 optional trusted `ContextAssemblyOptions` 和 required `AbortSignal`。options 缺失表示 initial；显式 options 必须携带 `mode`，initial 不得携带 attempted ids，fallback 至少包含一个唯一且有序的 attempted id，每个 id 都必须属于 accepted Agent 激活集合。所有 decorator、observability wrapper、facade 和 caller 透传同一个 options/signal。该 options 不进入 Web request、RuntimeCommand、RequestContext、Capability result、model output 或 persisted facts。

fallback 选择完成后，Context Engine 对新模型重新执行 prompt selection、effective optional model parameters、context-window budget、compaction 和 render。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirements 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；实现约束来自 `Model selection uses Agent-activated model configurations`、`上下文预算使用所选模型的已解析窗口`、`Fallback selection recomputes model-specific context` | selection 排除 unknown、`UNAVAILABLE`、已尝试或不具 fallback eligibility 的模型；每次选择后使用同一 selected configuration 重新预算、压缩和 render | candidate exhaustion、attempted exclusion、window recomputation、fallback reassembly tests |

## `FN-10.2 装配插件`

### 目标与规范依据

本 Function 只需要使 RESERVED model policy inventory 的责任描述与实际模型选择和 fallback 分工一致。`Policy plugins use an explicit open policy inventory` 是唯一规范依据；本 change 不改变可激活 policy point 集合。

#### 本 Function 的目标 Requirements

canonical spec：`agent-scoped-plugin-composition`

- `MODIFIED`：`Policy plugins use an explicit open policy inventory`

### 当前实现

- `modelSelectionPolicy` 和 `modelFallbackPolicy` 均为 `RESERVED`。
- inventory 中的 owner metadata 仍反映旧的选择与 fallback 责任边界。
- SDK 不为 RESERVED point 提供 implementation helper 或 executable。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| selection policy metadata 指向实际选择 owner | metadata 未反映 Context Engine 的统一选择责任 | owner 需要改为 `agent-context-engine` |
| fallback metadata 区分 lifecycle gate 与 model selection | metadata 未表达双 owner 分工 | 需要列出 Core gate 与 Context Engine selection |
| RESERVED point 不可激活 | 当前行为已满足 | 只保留并验证现有拒绝路径 |

### 修改方案

只更新 `agent-plugin-sdk` inventory metadata 和对应 contract tests：

- `modelSelectionPolicy` owner 为 `agent-context-engine`。
- `modelFallbackPolicy` owner 为 `agent-core` / `agent-context-engine`，前者只拥有 lifecycle gate，后者拥有 fallback model selection。
- 两个 point 继续为 `RESERVED`，其 contract 只包含 inventory status、owner 和 activation rejection。

## `FN-3.2 编译智能体装配`

### 目标与规范依据

该 Function 没有产品行为变化。触及的 legacy Requirements 同时描述配置、模型与 assembly，因此本 change 只把 assembly 的黑盒行为迁入既有 canonical spec，并把配置 freeze、evidence 和 dependency injection 保留为 design。

#### 本 Function 的目标 Requirements

canonical spec：`agent-package-assembly`

- `MODIFIED`：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`

### 当前实现

app 配置校验已经生成 frozen config/evidence，并在 startup 编译 `AgentAssemblyRegistry`；accepted request 只消费 assembly facts。legacy specs 同时夹带模型目录、assembly 与私有 package/file 细节。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 保留 startup compile 和 request path 不 reparse | 行为与模型目录写在 mixed legacy Requirements | 来源必须 `REMOVED`，assembly 黑盒迁入 `agent-package-assembly`，白盒配置流水线只留在 design |
| 省略 `modelIds` 时统一继承全部已校验系统模型 | 只有 builtin discovery 在硬编码模型不匹配时覆写模型引用，local Agent 省略字段会解析失败 | 缺省语义必须进入通用 assembly compiler，builtin manifest 与 discovery 不再拥有模型特例 |

### 修改方案

`agent-package-assembly` 完整保留现有 startup compile 与 request path 不 reparse 语义。Agent definition 可省略 `modelIds` 以继承 frozen system config 中全部已校验模型，显式配置保持 non-empty ordered unique 约束；assembly 始终以解析后的 non-empty ordered unique `modelIds` 和可选且必须属于该集合的 `defaultModelId` 表达模型激活范围。现有 frozen config、readiness、diagnostic、evidence 和其他窄依赖继续沿用，并由 app composition characterization 防回归。

## `FN-5.1 管理能力目录`

### 目标与规范依据

该 Function 没有产品行为变化。触及的 broad core Requirement 中，custom Capability provider 的可信 adapter registration 行为迁入 `capability-source-configuration`。

#### 本 Function 的目标 Requirements

canonical spec：`capability-source-configuration`

- `MODIFIED`：`Custom providers require explicit adapter registration`

### 当前实现

custom provider 通过 app composition 注册的 adapter support 进入 capability governance；该行为原先与模型和 secret 配置写在同一 Requirement。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 行为保持且归属明确 | 混合 Requirement 难以判断所属 Function | 来源 `REMOVED`，目标 canonical Requirement `MODIFIED`，不改 capability runtime |

### 修改方案

目标 Requirement 完整保留 custom provider 的 adapter 校验和 safe failure，只补充“模型 provider 已装配不等于 custom Capability adapter 已注册”。不修改 Capability catalog、provider registry 或 executable materialization；保留现有 contract/architecture tests。

## `FN-5.2 调用能力`

### 目标与规范依据

本 Function 需要把 `CapabilityInvocationResult.contextPatch` 的显式模型选择输入收敛到 canonical `modelId` identity，并保持 executor side-effect 禁止、request-local patch、safe failure、generated messages、allowed tools 和 opaque refs 等既有行为。

#### 本 Function 的目标 Requirements

canonical spec：`capability-catalog`

- `MODIFIED`：`Executors Return Results Without Owning Runtime Side Effects`

### 当前实现

- Capability result 使用 optional `contextPatch.modelName` 和 `contextPatch.modelOptions`。
- Core patch resolver 把 `modelName` 作为后续模型选择输入；stable prompt/model contracts 中同名字段既可能表示 provider model name，也可能被当作选择条件。
- `contextPatch.modelOptions` 尚未按本 change 的完整 inference field vocabulary 明确封闭，也没有区分受治理 Skill metadata 与其他 Capability producer 的 `providerOptions` 来源。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 所有选择权威使用唯一 `modelId` | Capability result 仍提交 `modelName` | 需要原子替换为 canonical `modelId`，不保留 alias 或反向 lookup |
| Capability model options 使用与模型配置一致的 inference fields | 既有 contract 未与目标 invocation field set 完整对齐 | 需要 exact closed schema；`providerOptions` 只接受受治理 Skill metadata 来源，并拒绝 access、timeout 和 retry |
| 合法 patch 只影响同一 request/run | 当前已有 request-local behavior | 迁移字段时保留 characterization，并通过统一 selection service 治理 |

### 修改方案

`CapabilityInvocationResult.contextPatch` 的模型字段使用 optional `modelId`，其 scalar constraint 与 canonical `ModelProfile.modelId` 相同。producer、runtime schema、Core consumer、fixtures 和 tests 从现有 `modelName` 在同一发布单元原子迁移；目标 closed schema 对未列出字段统一 fail closed，模型选择只消费 canonical `modelId`。

`contextPatch.modelOptions` 只接受 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions`，逐字段复用 invocation contract 的 shape/range/null rules；不接受 provider identity/access、timeout 或 retry control。`providerOptions` 必须是 non-null `JsonObject`，只能由已接受 `SkillMetadata.modelOptions` 经受治理 Skill Tool mapper 产生，并在最终模型确定后通过 selected adapter reserved-field validation；非 Skill Tool Capability result、Capability 参数、Skill input/body、模型输出或其他 metadata 不能取得该 authority。Core 使用已持有的 capability target 与 Skill resolution 事实校验来源，不给 public patch 增加自报 provenance 字段。`modelId` 缺失表示不覆盖后续模型选择；`modelOptions` 缺失表示不覆盖模型参数，单个 option 缺失表示不覆盖对应字段。通过 schema 和 Agent/request governance 后，Core 只把 model id/options 保存在 request-local state，并在后续 Context Assembly 中把显式 `modelId` 交给唯一 `ModelSelectionService`；非法 patch 仍产生 safe capability failure。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirement 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Executors Return Results Without Owning Runtime Side Effects` | capability result 不能提交 provider access 或越权 model id；`providerOptions` 只接受受治理 Skill metadata mapping，accepted patch 不持久化 | schema/source negative、unauthorized modelId、no-mutation tests |
| 可维护性 | 同上 | `contextPatch.modelId` 与目录/选择使用同一 identity；producer/schema/consumer 原子采用目标 closed shape | contract compile、producer/consumer atomic migration、closed-schema tests |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

本 Function 只迁移 `BEFORE_MODEL_INVOKE` 的 mutation vocabulary，使其与目标扁平 `ModelInvocationRequest` 同形；其他 stage、hook ordering、runtime reduction、pending、failure mode、timeline fact 和 startup composition 行为保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `MODIFIED`：`Stage-specific boundaries and mutations are minimal runtime contracts`

### 当前实现

- `BEFORE_MODEL_INVOKE` mutation 允许 `messages`、`tools`、`commonOptions`、`providerOptions` 和 `timeoutMs`。
- `commonOptions` 与目标调用 request 的扁平字段形成第二种通用参数 shape。
- hook mutation 还没有与本 change 新增的调用级 `maxRetries` 对齐。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 同形调用参数使用同一字段集合 | hook 使用 `commonOptions`，request 使用扁平字段 | 删除 wrapper，逐字段复用 request constraints |
| trusted hook 可受控覆盖同模型 retry | hook mutation 没有 `maxRetries` | 增加非负安全整数并继续受总 timeout/budget 约束 |
| mutation 不取得选择/接入权威 | hook 位于 provider execution 前 | 明确禁止修改 modelId、scope、provider access/transport 和 Owner/Agent scope |

### 修改方案

`agent-contracts/runtime` 的 `BEFORE_MODEL_INVOKE` mutation closed schema 删除 `commonOptions`，增加 `temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `maxRetries`；保留 `messages`、`tools`、`providerOptions` 与 `timeoutMs`。所有字段逐项复用目标调用 contract 的 range、null 和 unknown-field rules，不提供 alias 或自动 unpack，也不提供 header 字段。

Runtime 继续拥有 stage validation 与 mutation reduction。只有已激活且具有 model-invocation transform authority 的 hook 经该 schema 校验后，其 inner `providerOptions` 才进入模型边界的 profile/call shallow merge 与 selected-provider reserved-field validation。模型边界继续拥有 default resolution、provider capability、timeout、retry、budget 与 cancellation；selected `modelId`、`invocationScope`、provider access/transport、Owner/Agent scope 和 execution budget 保持受保护。scope `operationId` 与 optional run coordinates 已由 owning lifecycle 冻结；prompt locale 在上游 selection/rendering 后停止传播。configured runtime 对所有 concrete provider invocation 执行同一 model hook；runtime 只以可信 executing/terminal state 判断该调用是否拥有 active run lifecycle，不从 scope shape 推断。background hook 的合法 mutation 生效，`PEND` 在 provider access 前安全失败，且不创建 pending input、synthetic run coordinates 或 request-run hook/model timeline；safe observation 只记录 mutation kind 与字段名。

模型 stage owner 对 `messages`、`tools`、`thinking` 和 `providerOptions` 使用运行期 readonly copy-on-write/lazy view，阻断 hook 对 owner-owned nested references 的原地修改；不在每次 hook 调用前 deep-clone 整个 request graph。runtime reducer 已只对 mutation 中出现的 replacement fields 执行 canonical JSON detach，wrapper 对未替换字段继续复用原 request value。这样同时满足安全隔离和大 context 的容量约束：in-place mutation 不能污染 provider input，hook 返回 replacement 后继续修改原引用也不能产生 TOCTOU，而未发生 replacement 的 large messages 不承担全量复制成本。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirement 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Stage-specific boundaries and mutations are minimal runtime contracts` | stage schema 拒绝 identity、scope、access、transport 与 owner/agent authority；readonly runtime view + replacement-only detach 阻断 nested alias mutation；raw option value 不进入 observation | protected-field、unknown/null、nested in-place mutation、replacement TOCTOU、redaction negative tests |
| 可维护性 | 同上 | hook 与 request 使用同一扁平字段 vocabulary 和约束；未替换字段 structural share | `commonOptions` absence、contract compile、wrapper/reducer、no-full-deep-clone tests |
| 可测试性 | 同上 | closed mutation schema 与模型边界 validation 分层 | valid flat fields、maxRetries、selected-provider option validation、other-stage characterization |

## `FN-10.4 自定义工具和提示词`

### 目标与规范依据

本 Function 保留既有 prompt manifest、source priority、specificity、complete-template selection、rendering 和 fallback 行为，把模型兼容性与本 change 的 canonical identity 和唯一 selection owner 接通。Prompt authoring 直接把 canonical `modelId` string 赋值给 `match.model`，并以该值做 exact matching，不为单一字段保留 nested object。Template `modelOptions` 支持与模型配置一致的八个 optional inference fields：`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 `providerOptions`；省略只表示不覆盖，不在 template compiler 中合成默认值。`providerOptions` 必须是 non-null `JsonObject`，不得包含 provider namespace、identity、access、timeout、retry、transport authority 或与 canonical 顶层字段重复的 control；compiler 校验 closed outer shape，最终模型确定后由 selected adapter 拒绝 reserved collision，其他未知 JSON fields 保持开放。

#### 本 Function 的目标 Requirements

canonical spec：`prompt-template-assembly`

- `MODIFIED`：`Prompt assembly has one decision boundary`
- `MODIFIED`：`Prompt assembly boundary guardrails`
- `MODIFIED`：`Prompt template selection is deterministic`

### 当前实现

- prompt compatibility 从 `AgentAssembly.modelProfileIds` 和 profile registry 构造候选。
- 多候选时可按 `capabilityContextPatch.modelName`、`AgentRuntimeSettings.defaultModelProfileId` 和 profile 顺序选择。
- summary 等消费者可从各自 invocation config 投影 safe model descriptors，形成与统一 selection service 平行的实际模型来源。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| canonical model identity 只使用 `modelId` | compatibility 和 tie-break 仍使用 profile id / model name | compatibility 必须只产出 canonical compatible ids，禁止反向 lookup |
| 最终模型只有一个 selection owner | prompt helper 和辅助消费者可形成平行选择路径 | 全部 purpose 先消费 `ModelSelectionService` 结果，再装配最终 prompt |
| authoring identity 与 canonical contract 对齐 | manifest 仍使用 ambiguous `providerKind`/`modelName` descriptors | 原子迁移为 canonical `modelId` string 直接赋值的 `match.model` |

### 修改方案

Context Engine 的私有 prompt compatibility evaluator 只消费 accepted Agent 的有序 `modelIds`、对应 safe catalog entries、purpose、trusted locale、string-only flow variables 和 frozen template facts，并只返回 compatible canonical model ids。scalar `match.model` 与 safe entry 的 canonical id 精确匹配。空集合继续表示 prompt 不约束模型；非空集合由唯一 `ModelSelectionService` 作为 hard filter 消费。该 evaluator 不选择/渲染最终模板，不合并 options，也不暴露 candidate 或 provider access。

当 selection 返回 `ResolvedModelConfiguration` 后，main、summary、memory 和 custom purpose 均从该同一结果投影 closed `selectedModel: { modelId }` 进行最终模板匹配。最终 prompt assembly request 不携带 candidate list 或 provider access；模型选择、compatibility 和 final matching 只消费 canonical `modelId`，`displayName` 只用于展示。

被选中的完整 Prompt Template 将八个显式 inference fields 交给 Context Engine。前七个字段逐字段参与统一 precedence；`providerOptions` 作为该已编译模板的授权来源参与顶层浅合并，并在 provider 执行前由 selected adapter 校验。模板不得配置 `timeoutMs` 或 `maxRetries`，因为二者是模型执行控制，不是推理参数。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirements 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Prompt assembly boundary guardrails` | final prompt request 只携带 selected canonical id 和已编译 inference options，不携带 provider access 或候选集；不可信输入不能覆盖选择 | schema/source negative、provider access non-leakage、selected-provider option validation |
| 可维护性 | `Prompt assembly has one decision boundary` | compatibility 只产出 canonical ids，最终模型统一来自 selection result | no profile-id/modelName selector、secondary consumer tests |
| 可测试性 | `Prompt template selection is deterministic` | safe candidate projection、compatibility filter 和 final template selection 各有单一输入/输出 | compatible subset、empty subset、specificity、conflict tests |

## `FN-1.20 查看推荐问题`

### 目标与规范依据

本 Function 保留推荐的 terminal guard、prompt variable/Skill context、output cleaning/parsing、API、cache 和 frontend 行为，只迁移模型选择与 invocation projection。

#### 本 Function 的目标 Requirements

canonical spec：`question-recommendation`

- `MODIFIED`：`Model Invocation for Recommendations`

### 当前实现

Suggested-question service 从 Agent assembly 的主 model profile 复制 `modelName`/`providerKind` 构造调用，并继续使用旧 invocation shape；service 以 completed run coordinates 和顶层常量 `stepId="suggested-question"` 伪装 request-run invocation。terminal 预计算由 runtime 的三参数 `postTerminalCallback` 触发，Web cache miss 也可直接进入 `suggestedQuestions.generate()`；两条路径共享现有 `SuggestedQuestionRequest`，其 closed fields 是 tenant/subject/agent/session/request/run coordinates。callback 同时承载 attachment cleanup 并覆盖全部 terminal status，唯一 production consumer 不只包含推荐逻辑。既有 terminal guard、prompt variables、Skill context、结果清洗/解析和失败/空结果行为已有测试覆盖。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 推荐使用当前 accepted Agent 的统一 selected configuration | 推荐服务读取主 profile 并复制 descriptors | 需要改为 `ModelSelectionService`，删除平行模型权威 |
| 调用使用 canonical model identity 与真实 background scope | service 复用 completed run coordinates 并伪造 step；terminal 与 Web 两条实际生成路径都没有统一的可信 operation owner | 需要从同一 selection result 构造 `modelId`，由推荐服务在每次实际模型调用边界建立 fresh `operationId`；completed run 坐标只保留为 causal correlation，不扩展 callback 或 Web request contract |
| 推荐 identity 不改变无关 lifecycle contract | `postTerminalCallback` 同时承载全部 terminal status 和 attachment cleanup；Web on-demand path 不经过 callback | callback 与 `SuggestedQuestionRequest` 保持既有 closed shape，推荐服务在自身模型调用边界生成可信 UUID；App composition 不注入或感知该业务 identity，缓存命中和没有实际模型调用的路径不生成 identity |
| 推荐业务行为保持不变 | 清洗、解析、API、cache 和 frontend 已成立 | 迁移时保留 characterization，不扩大产品行为 |

### 修改方案

`RequestLifecycleDependencies.postTerminalCallback(command, run, status)` 与 `SuggestedQuestionRequest` 保持既有 contract。terminal `COMPLETED` 预计算与 Web cache miss/on-demand 调用汇入同一个 service model-invocation boundary。只有在 selection/prompt assembly 已完成且确实要启动 `ModelInvocationService.complete()` 时，suggested-question service 才在自身业务边界通过平台加密安全 UUID generator 建立 fresh `operationId`；App composition 不注入 generator 或 operation identity。缓存命中、非 `COMPLETED` terminal status、attachment cleanup 和其他 callback consumer 不建立虚假 recommendation identity。Web/client、模型输出、Capability 参数和其他不可信输入没有提供或覆盖该值的字段。

Port 以已完成 run 的 trusted Owner/Agent scope、purpose 和 `mode=INITIAL` 调用 `ModelSelectionService`，使用 selection result 的 canonical `modelId` 构造 background `complete()` request，`tools=[]`，把 service-owned identity 写为 scope `operationId`，并把 completed session/request/run 作为 all-or-none 的真实 causal correlation。推荐与其他模型消费者使用 configured runtime 返回的同一个 `ModelInvocationService`，因此当前 Agent 已激活的 model hook 正常执行；runtime 的可信 terminal state 保证该调用不创建 request-run hook/model timeline、pending 或 workbench action，optional run coordinates 不改变 lifecycle。adapter 发起 outbound model HTTP request 时，`agent-model` 集中生成固定的既有四个 correlation headers。service-owned UUID generation 失败、selection cancellation/failure，或 background `BEFORE_MODEL_INVOKE` hook 返回 `DENY`、`BLOCK`、`PEND` 时，provider 均不启动并沿用既有失败/空结果语义。Port 不读取 main/default/first profile、catalog 或 binding，不提交 provider descriptors/access，也不选择全局或其他 Agent 模型。

characterization 必须 grep 并覆盖 `postTerminalCallback` 全部 caller/consumer，直接断言三参数 contract、terminal status 与 attachment cleanup 行为不变；推荐服务测试同时覆盖 terminal 预计算和 Web on-demand 两条实际生成路径、每次实际调用的 fresh identity，以及缓存命中不生成 identity。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirement 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Model Invocation for Recommendations` | Owner/Agent scope 与 causal run coordinates 来自 completed run；推荐服务只在实际模型调用前通过 service-owned cryptographically secure UUID generator 建立 scope `operationId`，App composition 与 request/callback 均不暴露 identity 或 generator，服务也不拥有 model/access/header authority；统一 model hook 生效但不能为 background `PEND` 或时间线合成 run truth | untrusted identity injection absence、composition generator absence、fresh UUID、completed-run correlation exactness、background hook execution、pending/timeline/workbench absence、profile bypass、provider field absence |
| 可维护性 | 同上 | 推荐与其他消费者复用同一 selection/invocation path | exact selected modelId、non-stream、tools empty、cleaning regression |

## `FN-8.3 记忆提取和老化`

### 目标与规范依据

本 Function 保留 scheduler、RULE_FIRST、prompt safety、candidate quality、observability、failure 和 memory lifecycle，只迁移 LLM extraction 的 model selection/prompt/invocation path。

#### 本 Function 的目标 Requirements

canonical spec：`memory-extraction`

- `MODIFIED`：`Extraction strategy and configuration`

### 当前实现

Memory extraction 从 active Agent assembly 的 default/first profile 选择模型并直接依赖 profile registry。现有 scheduler、RULE_FIRST、prompt safety、candidate、observability 和 degraded/failed behavior 已形成产品路径。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 后台 extraction 复用统一模型选择 | 当前按 default/first profile 选择 | 需要接入 `ModelSelectionService`，不再读取 profile registry |
| prompt 与 invocation 使用同一 selected configuration | 当前路径没有统一 availability、compatibility 和 selection result | 需要向 prompt 与 invocation 投影同一 canonical `modelId` |
| 后台调用使用真实 scope 并安全降级 | extraction cycle 已有 cycle identity，但 LLM strategy 尚未把其 owner/source 写入统一 scope contract | scheduler/cycle owner 冻结 `cycleId`，LLM strategy 同值映射为唯一 scope `operationId`，省略不存在的 run coordinates，并保留既有 degraded/failed 语义 |

### 修改方案

每个 accepted extraction cycle 在进入 extraction strategy 前由 owning trigger lifecycle 冻结一个 `cycleId`。cron-triggered extraction 使用 memory scheduler/cycle owner 为该次运行建立的 identity；受控管理/测试触发可以注入满足同一 contract 的 cycle identity。`MemoryExtractionLlmStrategy` 把收到的 `cycleId` 同值映射为 scope 的唯一 `operationId`。Background extraction 以 active accepted Agent scope、trusted background owner scope、`purpose=MEMORY_EXTRACTION`、assembly default locale、空 flow variables 和 `mode=INITIAL` 调用 `ModelSelectionService`。Prompt assembly 使用同一 selected configuration 的 `modelId`；locale 在 prompt render 后停止传播，invocation 使用同一 `modelId`、已渲染 messages 与省略 session/request/run coordinates 的 schema-valid scope。adapter 发起 outbound model HTTP request 时，framework-owned correlation header 集合恰好为既有 Agent header。Memory 不读取 catalog/binding 或 default/first profile；缺失/非法 cycle identity 或 selection failure 不启动 provider，并沿用既有 degraded/failed semantics。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirement 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Extraction strategy and configuration` | trigger-owned cycle identity 同值映射为 trusted background scope 的唯一 `operationId`，模型配置与接入仍由 owning boundaries 提供 | cycle-to-operation mapping、missing/invalid identity、scope、descriptor projection、no catalog/binding dependency |
| 可靠性/恢复 | 同上 | selection cancellation/failure 不启动 provider，保留既有 degraded/failed result | unavailable/exhausted/cancel tests、scheduler regression |
| 可维护性 | 同上 | background consumer 与 main/summary/workflow 复用唯一 selection contract | same selected configuration for prompt/invocation |

## `FN-5.9 调用技能`

### 目标与规范依据

本 Function 保留 Skill resolution、disclosure、inline body、tool-result settlement、budget 和安全失败，只迁移模型 patch producer vocabulary。

#### 本 Function 的目标 Requirements

canonical spec：`skill-tool`

- `MODIFIED`：`Skill tool is the model-facing Skill execution entry`

### 当前实现

- Skill Tool 将 `SkillMetadata.model` 投影为 `CapabilityContextPatch.modelName`。
- `agent-capability` 现有 implementation-local `SkillDocumentService` 统一提供 `parseMetadataView(...)`、`loadCanonicalBodyView(...)`、frontmatter slicing 和 consistency token；Skill Tool 通过 resolved descriptor 的 provider id 查询已注册 source/discovery，再由同一 document service family 加载 canonical body。
- 现有 runtime resolver、context disclosure、inline body、tool-result settlement、budget 和安全失败路径已有 characterization，并继续由既有模块边界承载。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Skill producer 使用 canonical model identity | `modelName` 可能表示 provider model、display name 或 hint | 需要原样映射为 `modelId`，禁止反向 lookup |
| patch 进入统一 Capability/selection governance | 当前 producer 输出旧字段 | producer/schema/consumer 必须在同一发布单元原子迁移 |
| 其他 Skill 执行语义保持不变 | 既有执行路径已成立 | 仅迁移模型 patch scenario 并保留其余 characterization |

### 修改方案

Skill Tool 把 `SkillMetadata.model` 值原样投影为 `modelId`；值必须满足 canonical model-id scalar，并由 Capability result schema、accepted Agent activation 和 `ModelSelectionService` 治理。系统不按 provider model name/display name 反查，不读取 provider access。Skill manifest parser、`SkillMetadataSchema`、typed metadata 和 Skill Tool mapper 的 `modelOptions` 从开放 `JsonObject` 原子迁移为八字段 closed inference schema：`temperature`、`maxOutputTokens`、`topP`、`topK`、`presencePenalty`、`frequencyPenalty`、`thinking` 和 non-null `providerOptions`。省略只表示不覆盖，Skill 层不合成默认值；provider identity/access、timeout、retry、outer unknown field 或 non-object `providerOptions` 安全失败。只有 source-admitted、manifest-validated、已接受的 Skill metadata 可以授权该 `providerOptions`，Skill input/body、模型输出和其他 Capability result 不可注入；最终模型确定后由 selected adapter 执行 reserved-field validation，inner 未知 JSON fields 保持开放。

实现只替换 metadata-to-patch mapper、相关 result schema fixtures 和 consumer assertions。既有 `SkillDocumentService`、source/discovery lookup、resolver、disclosure、inline body load/injection、settlement 和 context-budget 路径保持不变，并由现有 characterization tests 防回归。

#### 质量属性影响

下列机制由本 Function 的功能性 Requirement 派生，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Skill tool is the model-facing Skill execution entry` | Skill producer 不能提交 provider access/options 或越权 model id | invalid/not-activated id、legacy modelName、no mutation |
| 可维护性 | 同上 | Skill metadata 与所有 Capability producer 使用同一 patch identity | verbatim mapping、no reverse lookup、existing Skill behavior regression |

## `FN-6.9 引用密钥`

### 目标与规范依据

该 Function 的 Secret grammar、解析和 non-leakage 行为没有变化。`Configuration And Secret Reference Baseline` 与 `Secret references are used instead of raw credentials` 分别把 Secret 行为混在 broad core contract 和 legacy model profile 中，来源 Requirements 需要整体迁移；其中 `credentialRef` 字段 owner 从 legacy flat model profile 改为两层 `modelProfiles[]` 父项，secret reference、最底层 encrypted-envelope 处理、独立 key source 和 raw secret 不泄漏行为原样归并到 `secret-configuration-boundary`。

#### 本 Function 的目标 Requirements

canonical spec：`secret-configuration-boundary`

- `MODIFIED`：`Product credentials use the frozen SecretReference grammar`

### 当前实现

配置使用 `env:`/`file:` reference，credential resolver 在 adapter 边界解析；当前 model profile 直接携带 `credentialRef`，两个来源 Requirements 还同时定义模型与 provider 配置。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Secret 行为保持且规范归属唯一 | 规范归属与模型、Gateway、Capability provider 行为混合，且 `credentialRef` 位于将被删除的 legacy flat model profile shape | 两个来源 Requirements `REMOVED`，目标 canonical Requirement `MODIFIED`；field owner 迁移到 `modelProfiles[]` 父项，Secret resolver/grammar/non-leakage 不产生生产代码 delta |

### 修改方案

目标 Requirement 完整保留 `env:`/`file:`、raw-secret 禁止、引用内容在公共边界保持 opaque，以及 encrypted envelope 只由最底层 resolver/adapter 使用独立 key source 处理的既有语义。`agent-app` schema/mapping 只把 optional `credentialRef` 从 legacy child profile 搬到两层 `modelProfiles[]` 父项；缺失字段表示 no credential，不允许环境自动发现。实施阶段不修改 Secret resolver、adapter、envelope vocabulary、decryptor 或 key configuration；以 characterization 证明合法/非法 reference、active validation 和最底层解析行为没有因字段 owner 迁移发生变化。`FN-4.1` 减少 credential reference 在模型调用链中的传播范围。

## `FN-10.5 集成外部系统`

### 目标与规范依据

该 Function 保持既有 Gateway selection/freeze/defaults，并新增一个环境中立、可选且可复用的 `FetchGateway` transport contract。该 port 不形成新的 adapter kind、selection entry、LOCAL default 或 readiness requirement；当前 change 只在跨 Function composition 中让 OpenAI-compatible adapter 成为首个 consumer。Model Gateway 的模型信息局部降级仍只由 `FN-4.1` 定义。

#### 本 Function 的目标 Requirements

canonical spec：`gateway-configuration`

- `MODIFIED`：`Gateway configuration is loaded and stabilized during startup`

### 当前实现

Gateway adapter 使用稳定 identity、连接配置、timeout/retry 与 credential reference；该行为原先与模型和 Capability provider 混合。`GatewayBindings` 目前没有通用 fetch transport port；OpenAI-compatible adapter 只有私有测试 fetch 注入，运行环境差异无法通过 Gateway boundary 可选装配。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Gateway 通用配置行为保持 | mixed Requirement 归属不清 | 来源 `REMOVED`，目标 canonical Requirement 明确 model-information capability 不改变既有语义 |
| 运行环境 fetch 通过 Gateway boundary 隔离 | 没有通用 port，模型测试 fetch 也不经过 Gateway bindings | 需要新增 `FetchGateway` 与 optional `GatewayBindings.fetch`，保持 LOCAL 缺省并对重复 binding fail closed；不得以模型命名或顺带迁移其他 REST client |

### 修改方案

目标 Requirement 完整保留既有 Gateway startup selection、freeze 和 LOCAL defaults，并增加两项最小 delta：

- model-information capability 的装配不改变既有 adapter readiness/fallback 语义，也不在 ready 前发起模型信息查询；模型目录只在首次安全查询时调用该 capability，并把 metadata 失败归一化为 model-scoped `UNAVAILABLE`；
- `agent-contracts/gateway` 定义单一异步 `FetchGateway.fetch(...)` 和 optional `GatewayBindings.fetch`。Gateway merge 恰好保留一个非空 binding，多个 selected providers 同时提供时以安全 conflict fail closed。LOCAL provider 不实现或默认装配该 port，仓库内不新增 REMOTE 实现，不新增 adapter kind、selection entry、全局 HTTP client abstraction 或 header policy。

app-to-model 的首次消费路径属于跨 Function composition：`agent-app` 在 Gateway bindings 完成后把该 port 适配为 model registration 的 private fetch function；`agent-model` 不依赖 gateway contract。其他 REST client 保持现状，后续只能由其 owning change 明确定义迁移。

composition 命名按边界分层：`ProductCompositionOutcome`、`ProductHostCompositionInput` 和 `runProductComposition*` 只用于唯一的顶层产品装配入口；只选择 channel auth 与 frontend hosting 变体的内部 contract 使用 `HostCompositionSelection`，默认 helper 使用 `defaultHostCompositionSelection`，不得以 `ProductCompositionSelection` 或 `defaultProductSelection` 暗示模型选择或完整产品选择。model 子层统一使用 `PreparedModelComposition`、`prepareModelComposition`、`composeModelRuntime` 和 `resolveConfiguredModelGatewayProvider`，不重复无区分度的 `Product` 限定词，也不保留旧名称 alias。`PreparedCompositionInputs` 只把 model-owned provider preparation 作为一个 `model: PreparedModelComposition` 整体携带，不得拆散 provider preparation，也不得携带最终 `ModelInvocationService` 作为 configured runtime 的反向输入。Gateway bindings 完成后，app 必须把 frozen `AgentAssemblyRegistry`、runtime-owned lifecycle-hook invocation port、credential resolver 和 optional fetch 与 prepared providers 一起交给 `agent-model` configured runtime factory；factory 内部完成 assembly authorization、model hook、catalog availability 与 provider invocation，并只向 app 返回命名的 `modelCatalog` 与 `modelInvocationService`。app 只分发这两个端口，不得导入 authorization/hook wrapper factory，不得建立 configured/raw/authorized/run-bound 等第二个 invocation service；authorization 与 hook helper 不从 `agent-model` package root 导出。

`agent-model` 内部按 SOLID 分离变化原因：provider runtime abstraction 只定义 registration/runtime capability；model runtime registry 只校验 provider registration、建立唯一 model binding 与保持配置顺序；model catalog 只拥有 catalog slot、lazy model-information resolution、single-flight/freeze 和 `list/get` 安全投影；catalog-backed invocation service 只拥有 availability lookup、effective request 合并与 provider invocation dispatch；configured runtime factory 只完成上述组件以及 hook/authorization 的装配。catalog 不按 `providerId` 判断静态或 lazy resolution，而按 provider runtime 是否提供 model-information resolver 决定 resolution path；新增 provider resolution 实现不得要求修改 catalog policy。内部组件不得形成第二份 model membership authority，registry 的 binding map 是唯一成员关系与 provider binding 来源，catalog slot 只保存 resolution state。

production composition surface 只导出真实 provider 路径的 `createNextAgentApp`/`createNextAgentAppAsync` 与 production host entrypoints。`CreateNextAgentAppOptions`、production host options、internal composition options、`PreparedModelComposition` 和 configured runtime factory 均不得接收最终 `ModelInvocationService`；该 service 只作为 configured runtime 输出和 consumer port 存在。`agent-app/testing` 保留既有 positional model 参数以兼容测试调用面，但必须在 testing surface 内把脚本化 service 包装为 `agent-model/testing` 提供的测试 `ModelGatewayProvider`，并把测试 system config 无歧义地投影为相同 model ids 的 `model-gateway` profiles；随后复用正常 provider preparation 和产品 composition。测试 app 暴露的 frozen config 必须与实际测试 provider binding 一致，不得以 `openai-compatible` config 隐式执行 injected service。`create-app.ts`、`create-local-configured-app.ts` 与 `agent-model` production source 不保留 injected-model option、registration、wrapper、re-export 或优先级分支。

OpenAI-compatible catalog entry 由启动时已校验的 configured profile 静态解析，其唯一 production runtime registration 只提供 invocation service，不实现 Gateway-only lazy model-information resolver，也不为缺失 context window 合成不可达默认值；`ModelProviderRuntime.resolveModel` 仅由需要 lazy metadata 的 Gateway registration 提供。测试脚本化模型通过测试 `ModelGatewayProvider` 的 model-information service 返回原测试 profile 已冻结的窗口，不建立 injected OpenAI-compatible registration。

## `FN-10.11 开发工作台`

### 目标与规范依据

该 Function 只消费 runtime canonical timeline、Agent assembly 与既有安全事实。模型 identity 迁移后，工作台必须显示 runtime timeline 的 `stepId/modelId`，不得为兼容旧 payload 建立平行 read model。

#### 本 Function 的目标 Requirements

canonical spec：`dev-agent-workbench`

- `MODIFIED`：`Run-bound model invocations use one runtime timeline boundary`
- `MODIFIED`：`Workbench exposes a reconstructed run effective view`

### 当前实现

`agent-dev-workbench` 的 SQLite read port、server/browser projector、事件标签、详情和 effective view 读取 `modelProfileId/providerKind/modelName`；Agent assembly view 使用 legacy model profile identity。`add-ts-dev-agent-workbench` 已完成实现但尚未归档，stable 尚未形成这两个 Requirement 的迁移来源。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 工作台与 canonical timeline 使用同一模型 identity | projector 和 browser 仍读取旧 payload 字段 | producer、persisted schema、history、SQLite read、server/browser projection 必须原子迁移为 `stepId/modelId` |
| effective view 使用 canonical Agent activation identity | view 使用 model profile terminology/field | 需要改读 assembly `modelIds/defaultModelId`，并以 node `modelId` 展示实际选择 |
| background 调用不冒充 run-bound action | recommendation 可能携带 completed-run causal coordinates | 只有正式 `MODEL_INVOCATION_*` timeline event 可形成工作台 model action |

### 修改方案

`add-ts-dev-agent-workbench` 先归档为 stable baseline，本 change 再应用 `dev-agent-workbench` 两个 `MODIFIED` Requirements。实现原子更新 SQLite read port、process graph、action detail、effective view 与 browser projection；旧模型 identity 字段在 model-event product/test fixtures 中一并删除，Capability action 的既有 provider/source classification 保持。工作台只读取正式 timeline event，不根据 completed-run coordinates、observability log 或 recommendation call 推断 model node。验证同时覆盖 server projection、browser smoke、workbench package build 和 model action 旧字段 negative assertions。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 审计/可追溯性 | `Run-bound model invocations use one runtime timeline boundary` | runtime timeline 与 workbench 使用 `stepId/modelId`，background 调用只按正式 timeline fact 投影 | SQLite/server/browser identity exactness、background non-projection |
| 可维护性 | `Workbench exposes a reconstructed run effective view` | assembly 与 invocation 均使用 canonical model identity，不维护 legacy alias | effective view、event label/detail、旧字段 negative assertions |

## `FN-7.5 采集指标`

### 目标与规范依据

模型配置只保留 canonical `providerId/modelId` 后，指标系统不再拥有一个可信、固定低基数的 provider kind。model metrics 必须继续表达调用 outcome、duration、usage 和 stream timing，同时避免把模型/provider identity 变成高基数 label。

#### 本 Function 的目标 Requirements

canonical spec：`agent-runtime-metrics`

- `MODIFIED`：`Metric inventory 必须声明来源、标签和增强需求`
- `MODIFIED`：`Metric labels 必须低基数且固定`

### 当前实现

`timeline-observation-mapper` 要求 payload 包含 `providerKind`，并把 `stepId/providerKind/modelProfileId` 标记为低基数 diagnostic candidates。trace 与 structured-log projector 会导出这些 candidates；metrics projector 从 `providerKind` 生成 `provider_kind=OPENAI | MODEL_GATEWAY | LOCAL | OTHER`，当前 6 个 model metric descriptors 均依赖该 label。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| model observation 不丢失 duration/usage/failure | mapper 把将删除的 `providerKind` 当作 required input | required identity 改为 `stepId/modelId`，但只用于 event validation 与进程内 pairing |
| trace/log/metric 维度保持低基数 | `stepId/modelProfileId` 被错误标记为低基数，canonical `modelId/providerId` 也不适合作为维度 | model identity 不进入 diagnostic candidates；使用 stable run/timeline refs 做关联 |
| model metrics 不依赖第二套 provider 分类 | descriptor 与 projector 要求 `provider_kind` | 从 6 个 model metrics 删除该 label 和 vocabulary，保留 name/value/dedup/outcome/token labels |

### 修改方案

`timeline-observation-mapper` 从每个 `MODEL_INVOCATION_*` event 读取 `stepId/modelId`；字段缺失时继续安全丢弃不完整 observation。mapper 使用 `runId + stepId` 维护进程内 started/terminal 与 first-visible pairing，但生成的 observation 不携带 step/model/provider diagnostic candidates。trace/log 继续依赖 stable run、request、timeline refs；duration、usage、safe failure 和 first-visible facts 不变。

`metrics-registry` 的 model descriptors 与 projector 原子移除 `provider_kind`：invocation count/duration 只含 `outcome`，token usage 含 `token_type/outcome`，TTFT 与 total stream latency 含 `outcome`，chunk latency 没有 label。registry validation、dedup、sink、metric names 和 values 不变。依赖旧 label 的 dashboard/alert 属于 release migration consumer，不能用 `OTHER`、`modelId` 或 `providerId` 兼容。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `Metric labels 必须低基数且固定` | model metrics 删除无 canonical low-cardinality 来源的 provider label，不引入模型/provider identity 维度 | descriptor exact labels、invalid identity label rejection、cardinality tests |
| 可维护性 | `Metric inventory 必须声明来源、标签和增强需求` | metric names、values、dedup 与 observation sources 保持，label schema 唯一 | metrics projector/registry、local/remote sink non-regression |

## 跨 Function 协作与端到端流程

### 唯一责任边界和依赖方向

| 边界 | owner | 输入 | 输出 | 明确非职责 |
|---|---|---|---|---|
| 原始配置与 composition | `agent-app` | YAML/env、provider contributions、compiled assemblies | frozen config/evidence、catalog bootstrap input、credential resolver、provider runtime、assembly registry | 不拥有 ready 后模型目录或模型选择，不向内部模块传完整配置 |
| 全局模型目录与 provider boundary | `agent-model` | typed profile definitions、metadata resolvers、credential resolver | lazy safe model query、model invocation | 不校验 Agent assembly 模型引用，不选择本次模型，不执行 cross-model fallback |
| Agent 模型激活 | `AgentAssembly` | Agent package config | activated `modelIds`、optional `defaultModelId` | 不复制 profile defaults、`providerId`、endpoint、credential、provider options 或 transport |
| 模型选择与模型相关预算 | `agent-context-engine` | accepted assembly、safe configurations、trusted constraints/options | selected configuration、reason、conversation model info/render | 不解析 credential、不调用 provider SDK |
| 主 Agent loop fallback gate | `agent-core` | retry-exhausted/non-recoverable safe failure、visible output、deadline/budget、cancellation、attempted model ids | cross-model replay decision、fallback evidence | 不维护模型目录、不选择模型、不拥有同模型 retry |
| Capability result 模型 patch | `agent-capability` contract + `agent-core` request-local consumer | schema-valid canonical `modelId`、八字段 closed `modelOptions`、受治理 Skill source fact | 后续 Context Assembly 的 trusted model id/options | 不按 `modelName` 反查、不提供 provider access、不接受非 Skill `providerOptions`、不修改 assembly/catalog/session |
| plugin policy metadata | `agent-plugin-sdk` | frozen open policy inventory | RESERVED owner metadata | 不执行 model policy |

依赖方向：

```text
agent-app
  -> constructs agent-model catalog/runtime
  -> validates Agent activation directly against frozen systemConfig.modelProfiles
  -> injects safe query and selection dependencies into agent-context-engine
  -> injects ModelInvocationService into governed consumers

agent-context-engine
  -> ModelCatalogQueryService
  -> AgentAssemblyRegistry

agent-core
  -> ContextEnginePort.assemble/render
  -> ModelInvocationService
  -> projects governed Capability contextPatch.modelId into later Context Assembly

agent-memory / agent-session / agent-workflow
  -> ModelSelectionService
  -> ModelInvocationService

agent-model
  -> AgentAssemblyRegistry for invocation authorization only
  -> provider SDK / trusted ModelGatewayProvider
```

### 启动与 ready 流程

```text
raw config
  -> agent-app validation / frozen DefaultSystemConfig / ConfigValidationEvidence
  -> canonical two-level modelProfiles
  -> accepted model profile definitions
  -> unique provider runtime registrations
  -> agent-model local validation
  -> compatible static metadata + unresolved Gateway catalog slots
  -> immutable private model slots/order/provider binding keyed by unique modelId
  -> initial Agent assembly model-reference validation against frozen systemConfig.modelProfiles (unknown fail; known Gateway model allowed)
  -> accepted AgentAssemblyRegistry
  -> model invocation authorization composition
  -> ready without Gateway model-information I/O

first safe model configuration query
  -> Context Engine selection or explicit post-ready deep model-provider health
  -> get(modelId): resolve only the requested unresolved slot
  -> list(): resolve all unresolved slots concurrently
  -> provider-neutral AVAILABLE or model-scoped UNAVAILABLE
  -> freeze each completed entry until process restart
```

`NextAgentApp.systemConfig` 指向同一个 frozen config，供可信 App Host 处理启动、部署、打包、readiness/release evidence 和测试生命周期。`systemConfig.modelProfiles` 与 `modelProfileValidationEvidence` 按 canonical target 原子迁移；内容重复的 `modelProfileRegistry` 以及没有 production reader且无法表达多 provider 目录的 `productModelProviderKind` 删除，不保留 alias。本 change 不新增公共 model catalog/query/binding API。内部功能模块只接收窄配置投影或 owner-owned port；该 Host 配置不是 ready 后模型 query、selection source、context-window/timeout resolver、credential resolver 或 invocation binding。完整 config 不进入 Web、stream、模型/Capability input、持久化运行事实或 observability payload。

### 主调用与 fallback 流程

```text
accepted Agent/run scope
  -> Context Engine queries Agent-activated configurations, lazily resolving Gateway metadata
  -> selects from AVAILABLE configurations
  -> prompt compatibility + model window budget + render
  -> flat invocation request with selected modelId, optional inference/provider options and real lifecycle scope
  -> agent-model verifies activation and resolves private binding
  -> selected provider adapter + app-adapted optional fetch
  -> same-model recoverable retry within effective timeout/budget
  -> provider-neutral success or safe failure

retry-exhausted or non-recoverable fallback-eligible failure
  -> Core lifecycle gates and attempted ids
  -> trusted Context Engine fallback reassembly
  -> next selected configuration + new budget/render
  -> next flat invocation request
```

### 相关 Function 的目标态用法示例

本节只解释前述 Requirements 和设计的组合结果，不建立第二套契约。示例使用本 change 完成后的 target-state contract；当前代码基线仍使用 `providerKind/modelName/modelProfileIds`、现有 flat profile 和既有 prompt match object，实施时必须按 tasks 原子迁移，不能把 target 示例误读为当前已存在 API。示例与受影响 Function 的覆盖关系如下：

| 示例 | 主要说明 | 覆盖 Function |
|---|---|---|
| A. 配置到推理的主链路 | 两层模型配置、Secret、Host projection、Agent 激活、选择、预算和调用 | `FN-4.1`、`FN-4.3`、`FN-3.2`、`FN-6.9` |
| B. Gateway 模型信息按需解析 | ready 零远程依赖、safe `get/list`、局部降级 | `FN-4.1`、`FN-10.5` |
| C. 确定性模型选择 | initial/default/order、prompt compatibility、显式选择 | `FN-4.3` |
| D. Prompt、Skill、Capability 与 hook 参数覆盖 | canonical `modelId`、八字段 options、固定 precedence、来源治理 | `FN-10.4`、`FN-5.9`、`FN-5.2`、`FN-10.1` |
| E. 同模型 retry 与跨模型 fallback | 单一 retry owner、fallback gate、重新选择和 render | `FN-4.1`、`FN-4.2`、`FN-4.3` |
| F. 推荐、记忆、summary 与 workflow 调用 | run-bound/background scope、统一 selection、header 差异 | `FN-1.20`、`FN-8.3`、`FN-4.3` |
| G. Timeline、工作台和 metrics | canonical `stepId/modelId`、background exclusion、低基数 metrics | `FN-10.11`、`FN-7.5` |
| H. Capability provider 与 plugin policy 边界 | model registration 不冒充 Capability adapter，RESERVED policy 不激活 | `FN-5.1`、`FN-10.2` |

#### 示例 A：模型配置、激活、选择与推理主链路

以下四步使用同一组 canonical identity，展示配置事实如何进入一次模型调用。

1. Agent App 读取并冻结模型配置。父层只表达 provider registration 与接入信息，子层表达模型画像和可选执行参数：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://api.example.com/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: openai/gpt-5.2
        displayName: GPT 5.2
        contextWindowTokens: 128000
        fallbackEligible: false
      - modelId: openai/gpt-5-mini
        displayName: GPT 5 mini
        contextWindowTokens: 128000
        fallbackEligible: true
        timeoutMs: 20000
        maxRetries: 1
```

配置通过校验后，两个子模型进入 immutable private model slot index；`providerId=openai-compatible` exact lookup 命中 framework-owned compatible provider registration。产品配置的 `providerId` 清单恰好为 `openai-compatible | model-gateway`；其他值在目录发布前失败。compatible 窗口来自本地配置，因此两个 entry 在 bootstrap 时即可冻结为 `AVAILABLE`；第一个模型省略的固定参数由 catalog 解析为 `temperature=0.55`、`maxOutputTokens=32000`、`topP=1`、`defaultTimeoutMs=30000` 和 `defaultMaxRetries=2`。Gateway profile 则只建立未解析 slot，由首次安全目录查询取得窗口。

配置产物具有以下边界：

- `credentialRef` 只存在于 provider 父项，并通过既有 SecretReference validation；子 `ModelProfile`、safe catalog entry、Agent assembly 和 invocation request 都不复制它。
- `providerId=openai-compatible` exact lookup 对应 framework-owned provider registration；provider binding 不需要另一个 provider 分类字段。
- `NextAgentApp` 的模型相关顶层投影恰好为 `systemConfig`，供可信 Host 查看冻结的两层配置与 validation evidence；Host 派生扁平清单或 lookup 不触发 Gateway metadata 查询。

2. Agent package 只激活 canonical model ids，并可声明其中一个为默认模型：

```yaml
modelIds:
  - openai/gpt-5.2
  - openai/gpt-5-mini
defaultModelId: openai/gpt-5.2
```

assembly publication 直接遍历同一个 frozen `systemConfig.modelProfiles` 校验这两个 id，不生成 configured ids 或 membership 对象，也不触发 provider metadata；startup compile、Capability graph validation 和 hot reload 复用这一来源，不建立第二份存在性权威。assembly 不复制 provider access、profile defaults 或 transport。unknown `modelId` 在 publication 前失败，并且不会为判断该 id 而调用 Gateway。

Agent config 的 `modelIds` 可省略以继承 frozen system config 中全部已校验模型；显式提供时必须是非空、有序且无重复的集合，不存在 singular `modelId` 字段。编译后的 assembly 始终携带解析后的显式 `modelIds`。`defaultModelId` 可省略，但存在时必须属于解析后的 `modelIds`。若上例省略 `defaultModelId`，initial selection 直接从 `modelIds` 顺序中选择第一个 eligible model，不读取或合成 global default。

3. Context Engine 使用 accepted assembly 和可信 request facts 选择模型：

```json
{
  "identityContext": {
    "tenantId": "tenant-a",
    "subjectId": "user-42",
    "displayName": "NOC Operator"
  },
  "agentId": "network-diagnosis-agent",
  "agentVersion": "2026.07",
  "agentAssemblyRef": "sha256:assembly-1",
  "purpose": "SYSTEM_PROMPT",
  "flowVariables": {
    "networkDomain": "5g-core"
  },
  "mode": "INITIAL"
}
```

没有更高优先级的显式 model id，且默认模型满足 availability、prompt compatibility 和 policy 时，selection result 为：

```json
{
  "status": "SELECTED",
  "reason": "AGENT_DEFAULT",
  "configuration": {
    "modelId": "openai/gpt-5.2",
    "contextWindowTokens": 128000,
    "temperature": 0.55,
    "maxOutputTokens": 32000,
    "topP": 1,
    "defaultTimeoutMs": 30000,
    "defaultMaxRetries": 2
  }
}
```

4. Prompt render 完成后，调用方使用 selected `modelId` 和真实 lifecycle scope 构造封闭调用请求。示例中的 `temperature` 来自 selected Prompt Template，`providerOptions` 是经过来源治理和浅合并后的 call-level 值：

```json
{
  "invocationScope": {
    "tenantId": "tenant-a",
    "subjectId": "user-42",
    "agentId": "network-diagnosis-agent",
    "agentVersion": "2026.07",
    "agentAssemblyRef": "sha256:assembly-1",
    "operationId": "step-7",
    "sessionId": "session-9",
    "requestId": "request-15",
    "runId": "run-15"
  },
  "modelId": "openai/gpt-5.2",
  "messages": [
    {
      "role": "USER",
      "content": [
        {
          "type": "text",
          "text": "分析 AMF 注册失败原因"
        }
      ]
    }
  ],
  "tools": [],
  "temperature": 0.2,
  "thinking": {
    "depth": "MEDIUM"
  },
  "providerOptions": {
    "serviceTier": "auto"
  }
}
```

`agent-model` 校验 Agent activation 后，通过私有 binding 解析 `providerId=openai-compatible`，应用 profile → template → Skill → request → hook 的有效参数，校验 selected-provider options，并把 `openai/gpt-5.2` 原样传给 provider。顶层 `thinking` 由 adapter 私下映射为 provider-native reasoning option，`providerOptions` 不再提供第二套 reasoning control。该请求使用 `timeoutMs=30000`、`maxRetries=2`；framework-owned outbound headers 恰好为 `X-NextAgent-Agent-Id`、`X-NextAgent-Session-Id`、`X-NextAgent-Request-Id` 和 `X-NextAgent-Run-Id`；终态返回 closed provider-neutral `ModelFinalResult`。

#### 示例 B：Gateway 模型信息在消费者查询时解析

同一个 system config 可以增加一个由 Gateway 提供模型信息的 provider；其子 profile 不配置本地 context window：

```yaml
modelProfiles:
  - providerId: model-gateway
    credentialRef: env:MODEL_GATEWAY_TOKEN
    models:
      - modelId: telecom/network-diagnosis-v3
        displayName: Network Diagnosis V3
        fallbackEligible: true
        temperature: 0.4
        timeoutMs: 45000
        maxRetries: 1
```

应用进入 ready 前，对 `telecom/network-diagnosis-v3` 只建立 configured definition、provider binding 和私有未解析 slot：

```text
configured model: telecom/network-diagnosis-v3
catalog slot:     UNRESOLVED
Gateway calls:    0
app ready:        true
```

Context Engine 首次需要该模型，或应用 ready 后显式执行 deep `model_provider` health 时，通过 app-private safe query 查询：

startup readiness、Agent assembly publication 和 primary health 都保持 `Gateway calls: 0`；只有上述 post-ready consumer 会触发解析。

```ts
const entry = await modelCatalogQuery.get(
  "telecom/network-diagnosis-v3",
  signal
);
```

`agent-model` 使用同一个 canonical id 调用 provider-private service：

```ts
await modelGatewayInformation.get(
  "telecom/network-diagnosis-v3",
  signal
);
```

Gateway 返回：

```json
{
  "status": "FOUND",
  "information": {
    "modelId": "telecom/network-diagnosis-v3",
    "contextWindowTokens": 64000
  }
}
```

safe query 返回并冻结：

```json
{
  "displayName": "Network Diagnosis V3",
  "availability": "AVAILABLE",
  "fallbackEligible": true,
  "configuration": {
    "modelId": "telecom/network-diagnosis-v3",
    "contextWindowTokens": 64000,
    "temperature": 0.4,
    "maxOutputTokens": 32000,
    "topP": 1,
    "defaultTimeoutMs": 45000,
    "defaultMaxRetries": 1
  }
}
```

后续 `get` 或 `list` 直接复用该 frozen entry，不再次访问 Gateway。同一模型的并发首次查询共享一个 in-flight resolution。若查询被取消，调用按 cancellation 结束，slot 保持可再次解析；取消不产生 frozen `UNAVAILABLE`。

若 Gateway 返回 `NOT_FOUND`，safe entry 为：

```json
{
  "modelId": "telecom/network-diagnosis-v3",
  "displayName": "Network Diagnosis V3",
  "availability": "UNAVAILABLE",
  "fallbackEligible": true,
  "unavailableReason": "MODEL_NOT_FOUND"
}
```

该结果只影响这个模型并冻结到进程重启。应用仍为 ready，Agent assembly 仍保持已发布；后续选择排除该模型。`list(signal)` 会解析所有尚未解析的 configured entries，并按配置顺序同时返回 available 与 unavailable entries，不因单个模型不可用丢失其他模型。

#### 示例 C：统一模型选择和上下文预算

accepted Agent 激活顺序为：

```text
1. openai/gpt-5.2                 default
2. telecom/network-diagnosis-v3  fallback eligible
```

一次 `INITIAL` selection 的处理顺序为：

```text
accepted Agent modelIds
  -> safe get 每个实际需要判断的 activated model
  -> availability filter
  -> prompt-compatible modelId filter
  -> governed Capability/request constraint
  -> explicit modelId（存在时）
  -> Agent defaultModelId（可用时）
  -> modelIds 中第一个剩余模型
```

假设 `openai/gpt-5.2` 可用且匹配 `SYSTEM_PROMPT` template，selection 返回它。Context Engine 使用它的 `contextWindowTokens=128000` 和 effective `maxOutputTokens=32000` 计算 input budget，再完成 compaction 与 render。调用方不能提交另一个 context window，也不能自行读取 first/default profile。

如果显式 governed `modelId=telecom/network-diagnosis-v3`，系统先校验该 id 属于当前 accepted Agent、当前为 `AVAILABLE`、满足 prompt/capability constraints，再使用其 `64000` 窗口重新预算。display name `Network Diagnosis V3` 不参与 exact matching。

#### 示例 D：Prompt、Skill、Capability 与 hook 的参数合并

Agent Prompt Template 可以声明 canonical model match 和八字段 inference options：

以下 `providerOptions` keys 仅用于说明合并方式；它们是 selected OpenAI-compatible provider 的 native extension keys，不构成跨 provider 的公共字段。adapter 不维护 allowlist，只拒绝与 canonical 顶层字段或 identity/access/transport authority 冲突的 keys。

```yaml
match:
  model: openai/gpt-5.2
modelOptions:
  temperature: 0.2
  topP: 0.95
  providerOptions:
    service_tier: auto
```

Skill metadata 使用同一字段集合：

```yaml
model: openai/gpt-5.2
modelOptions:
  temperature: 0.1
  thinking:
    depth: HIGH
  providerOptions:
    parallel_tool_calls: false
```

Skill Tool 只把 accepted metadata 映射为 request-local Capability patch：

```json
{
  "contextPatch": {
    "modelId": "openai/gpt-5.2",
    "modelOptions": {
      "temperature": 0.1,
      "thinking": {
        "depth": "HIGH"
      },
      "providerOptions": {
        "parallel_tool_calls": false
      }
    }
  }
}
```

Core 校验 `modelId` 已被当前 Agent 激活后，只把 patch 保存到同一 request/run 的 request-local state。它不修改 Agent assembly、session、catalog 或 provider configuration。普通 Capability result、Capability 参数、Skill body 或模型输出提供同形 `providerOptions` 时被拒绝。

本次调用还可以携带 trusted request override：

```json
{
  "topP": 0.9,
  "providerOptions": {
    "prompt_cache_key": "network-diagnosis",
    "vendor_cache_mode": "ephemeral"
  }
}
```

已激活且具有 transform authority 的 `BEFORE_MODEL_INVOKE` hook 可以返回：

```json
{
  "temperature": 0.05,
  "maxRetries": 0,
  "providerOptions": {
    "safety_identifier": "network-diagnosis-agent"
  }
}
```

effective merge 顺序固定为：

```text
profile -> selected Prompt Template -> governed Skill patch
        -> trusted request -> governed BEFORE_MODEL_INVOKE hook
```

前七个 provider-neutral inference fields 逐字段覆盖。`providerOptions` 按同一层级做顶层浅合并；同名嵌套对象整体替换。因此本例最终 `temperature=0.05`、`topP=0.9`、`thinking.depth=HIGH`、`maxRetries=0`，并同时保留 `service_tier`、`parallel_tool_calls`、`prompt_cache_key`、未知的 `vendor_cache_mode` 和 `safety_identifier` keys。最终对象由 `providerId=openai-compatible` registration 执行 reserved-field validation 后包装到 AI SDK provider namespace；未知 key 不导致拒绝，显式 `null` 仍由上游 JsonObject/authoring contract 处理，provider access、header、transport 或与 canonical 顶层字段重复的 control 会在 provider execution 前安全失败。

各层省略字段只表示“不覆盖”。只有 catalog 会在 profile 缺失 `temperature/maxOutputTokens/topP/timeoutMs/maxRetries` 时分别解析 `0.55/32000/1/30000/2`；Prompt、Skill、Capability 和 hook 都不复制这些默认值。

#### 示例 E：同模型 retry 后再跨模型 fallback

第一次 selection 选择 `openai/gpt-5.2`，一次 logical invocation 的边界如下：

```text
timeoutMs = 30000
maxRetries = 2

attempt 1 -> recoverable 429
attempt 2 -> recoverable 503
attempt 3 -> recoverable 503
```

三个 attempts、两次 backoff 和 provider execution 共享同一个 30 秒 absolute deadline。调用方和 Core 不再包裹同模型 retry，也不重置 timeout。若 retry 耗尽前已经产生 public stream delta，则不再 retry。

retry exhausted 且尚无用户可见输出时，Core 根据 cancellation、deadline、budget、safe failure 和 attempted ids 判断允许 fallback，然后请求：

```json
{
  "mode": "FALLBACK",
  "attemptedModelIds": [
    "openai/gpt-5.2"
  ]
}
```

Context Engine 排除 attempted ids，从当前 Agent 激活、`AVAILABLE` 且 `fallbackEligible=true` 的模型中选择 `telecom/network-diagnosis-v3`，使用其 `64000` 窗口重新执行 prompt compatibility、budget、compaction 和 render，再生成新的 flat invocation request。Core 不自行构造 provider route。

如果第一模型已经产生用户可见输出、请求已取消、deadline/budget 不足，或没有剩余 eligible model，Core 分别记录 fallback denied 或 exhausted，并且不调用第二个模型。

#### 示例 F：不同调用目的使用同一模型契约

run-bound 主 Agent、summary 和 workflow model node 使用 owning orchestration step 的真实 identity；以下只展示 scope 的 lifecycle-coordinate 片段，owner/agent coordinates 同时按 canonical scope contract 写入：

```json
{
  "operationId": "step-7",
  "sessionId": "session-9",
  "requestId": "request-15",
  "runId": "run-15"
}
```

它们先通过 `ModelSelectionService` 选择，再用对应 purpose 装配 prompt。adapter 对 outbound model HTTP request 生成 Agent/Session/Request/Run 四个 framework-owned correlation headers。Core run-bound timeline wrapper 把 `operationId=step-7` 投影为 timeline `stepId=step-7`。

memory extraction cron 在进入 strategy 前冻结真实 cycle identity：

```json
{
  "tenantId": "tenant-a",
  "subjectId": "memory-owner",
  "agentId": "network-diagnosis-agent",
  "agentVersion": "2026.07",
  "agentAssemblyRef": "sha256:assembly-1",
  "operationId": "memory-cycle-20260729-001"
}
```

该 background scope 没有虚构 session/request/run coordinates；adapter 只生成 Agent correlation header。memory consumer 使用 `purpose=MEMORY_EXTRACTION`、Agent default locale 和空 flow variables 请求 selection/prompt，不读取全局 default profile。

推荐问题的 `SuggestedQuestionRequest` 仍只有既有 tenant/subject/agent/session/request/run fields。terminal 预计算或 Web cache miss 真正启动模型调用前，推荐服务建立 fresh operation identity；以下同样只展示 lifecycle-coordinate 片段：

```json
{
  "operationId": "recommendation-op-42",
  "sessionId": "session-9",
  "requestId": "request-15",
  "runId": "run-15"
}
```

completed-run 三元组只表示 causal correlation。推荐调用使用 `complete()`、`tools=[]` 和 selected canonical `modelId`；即使携带三元组，也执行统一 model hook，但不产生 request-run hook/model timeline，也不允许 `PEND` 创建 pending truth。缓存命中时不建立 operation identity，也不调用模型。

#### 示例 G：Timeline、工作台、observability 和 metrics

一次 run-bound 模型调用产生的安全 timeline identity 片段为：

```json
{
  "type": "MODEL_INVOCATION_STARTED",
  "stepId": "step-7",
  "modelId": "openai/gpt-5.2"
}
```

terminal event 使用同一个 `stepId/modelId`，并可以携带 safe finish reason、usage 或 safe error。timeline、history 和 dev workbench 不再使用 `modelProfileId/providerKind/modelName`。

工作台据此显示：

```text
Step:  step-7
Model: openai/gpt-5.2
Agent activated models:
  - openai/gpt-5.2
  - telecom/network-diagnosis-v3
Default:
  openai/gpt-5.2
```

background recommendation 没有 run-bound `MODEL_INVOCATION_*` event，因此不会显示为 request/run process graph 中的 model action。

observability mapper 可以在进程内使用 stable run/timeline refs 和 `stepId` 完成 duration/first-visible pairing，但 trace、structured log 和 metric labels 不导出 `stepId`、`modelId`、`providerId` 或 provider category。不同 provider 的成功调用产生同形 metric：

```text
model_invocation_total{outcome="success"} 1
```

不存在 `provider_kind`、`modelId` 或替代 provider-category label；metric name、value、dedup、usage 和 timing 语义保持不变。

#### 示例 H：Capability provider 与 plugin policy 保持独立

模型 provider registration：

```text
providerId = openai-compatible
registration = OpenAI-compatible model provider
```

不会让下面的 custom Capability provider 自动合法：

```yaml
capabilityProviders:
  - providerId: network-oss-tools
    type: custom
    adapter: oss-tool-adapter
```

若 app composition 没有显式注册 `oss-tool-adapter`，Capability provider resolver 仍返回 `CUSTOM_ADAPTER_UNREGISTERED`；模型目录或模型 adapter 不能冒充 Capability adapter registration。

plugin policy inventory 中：

```text
modelSelectionPolicy -> RESERVED, owner agent-context-engine
modelFallbackPolicy  -> RESERVED, owner agent-core / agent-context-engine
```

插件 manifest 或 Agent activation 尝试启用这两个 policy point 时仍安全失败。本 change 只让 owner metadata 与实际 selection/fallback 责任一致，不开放新的 plugin executable、helper 或运行期扩展路径。

### 最小代码落点

| 模块 | 最小 delta |
|---|---|
| `agent-contracts/model` | unique `modelId`/`providerId` profile identity、safe catalog query、单一 scope 的 required `operationId` 与 all-or-none optional run coordinates、flat optional request fields、受控 provider options、retry/timeout、Gateway metadata SPI |
| `agent-contracts/context` | selection service、trusted assembly options、flat optional model parameters 与可信内部 provider options carry |
| `agent-contracts/app` | app contract 引用 model-owned canonical profile contract；不再拥有 legacy profile/access shape |
| `agent-contracts/runtime` | trusted lifecycle mutation 只允许已开放可选参数/provider options，不允许修改 model/provider/access/transport；`SuggestedQuestionRequest` 与 `postTerminalCallback(command, run, status)` 保持既有 closed contract |
| `agent-contracts/capability` | `contextPatch.modelName` 原子替换为 `modelId`；`modelOptions` 使用八字段 closed inference schema，`providerOptions` 只接受受治理 Skill metadata mapping |
| `agent-model` | private model slot index、逐模型 lazy catalog slot/single-flight metadata resolver、safe-query-backed deep model-provider health probe、providerId binding dispatcher、集中式既有 correlation-header composer、app-projected optional SDK fetch adapter、compatible SDK adapter、same-model retry、usage normalization |
| `agent-context-engine` | safe query、唯一 selection service、fallback reassembly、model-specific budget/render |
| `agent-core` | cross-model fallback gates/evidence，下一模型由 Context Engine selection result 提供；Capability model patch 只保存在 request-local state 并交给 Context Engine；run-bound invocation 从 accepted step 和 selected `modelId` 生成 canonical timeline identity |
| `agent-observability` | 更新 `ContextEnginePort.assemble` wrapper/decorator 以原样透传 options 和 cancellation signal；timeline observation mapper 从 `stepId/modelId` 校验 event 并完成进程内 duration/first-visible pairing，删除 `stepId/modelId/providerId/providerKind/modelProfileId/modelName` diagnostic projection，保留 duration、usage、first-visible、failure 和 stable refs；trace/log 不导出模型 identity，6 个 model metric descriptors/projector 删除 `provider_kind` label，不改变 metric name/value/dedup |
| `agent-dev-workbench` | 原子迁移三个 `MODEL_INVOCATION_*` event 的 persisted payload/history、SQLite read port、server/browser projector、事件标签与详情到 `stepId/modelId`；不保留旧字段、alias、dual read 或平行 read model |
| `agent-app` | 拥有 raw/validated 两层 `modelProfiles` config、env projection、evidence、Assembly 模型引用校验和 composition，向 `agent-model` 提供可信 provider input，装配 catalog query、invocation、Gateway capability、Context consumers 与 post-ready deep model-provider health；不感知 recommendation operation identity 或其 generator；`NextAgentApp` 的模型相关顶层字段只保留含冻结配置/evidence 的 `systemConfig`，删除 `modelProfileRegistry` 与 `productModelProviderKind` 且不新增 model API，内部 consumers 不读取 Host projection 作为运行期模型 authority |
| `agent-platform-gateway-remote` | Gateway model-information adapter 与 safe normalization；invocation client 继续透传完整 canonical request/scope，把 optional run coordinates 作为关联事实 |
| `agent-runtime`、`agent-session` | runtime callback contract 和 terminal/attachment-cleanup 语义不变；session recommendation service 只在 terminal 或 Web 路径实际启动模型调用前通过 service-owned cryptographically secure UUID generator 建立 fresh `operationId`，并保留 completed-run causal coordinates；callback 全 caller/consumer 由 inventory + characterization 覆盖 |
| `agent-memory`、`agent-workflow` | 改用 context-owned selection，保留各自业务 prompt 与 lifecycle；memory scheduler/cycle owner 冻结 `cycleId`，LLM strategy 同值映射为 scope `operationId`并省略不存在的 run coordinates |
| `agent-plugin-sdk` | 只更新 RESERVED model policy owner metadata |
| `migration/model-authoring-v2` | 独立于 workspace packages 的单文件 Python 标准库迁移入口、同目录行为/故障恢复测试与使用说明；只处理 developer-owned source assets，不被 runtime 或 package exports 引用 |

现有 request lifecycle、same-session lane、terminal commit、timeline event kind vocabulary、Web DTO、gateway persistence 和 frontend 不修改；仅 model-invocation event payload identity 字段按上述原子迁移。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-4.1` 的 `模型接入配置只在模型边界内解析`、`模型 transport 通过可选 Gateway fetch 装配`、`Provider options remain an open selected-provider extension`、`Invocation scope represents real lifecycle coordinates`；`FN-4.3` 的 `Context Engine separates assembly from rendering`；`FN-5.2` 的 `Executors Return Results Without Owning Runtime Side Effects`；`FN-3.2` 的 `Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`；`FN-6.9` 的 `Product credentials use the frozen SecretReference grammar` | app 在 Gateway bindings 完成后向 model composition 交付已校验 profiles、resolver 与 optional `FetchGateway`；assembly 只保存 `modelIds`；Context Engine 只读取 safe configuration；Capability patch 只提交 governed model id/inference options，且 provider options 仅接受 selected Prompt Template、受治理 Skill metadata、可信 Agent request 或 hook 等明确来源；credential/transport/correlation-header composer 只在 provider 最底层解析；framework-owned correlation header 集合固定为既有四个名称；Secret 行为原样保留 | composition/contract negative、correlation-header exact projection、Capability patch closed-schema/provider-access/source rejection、provider-options precedence/reserved-field/unknown-field pass-through、optional fetch isolation、Secret characterization、secret leakage、Agent Scope、architecture dependency tests |
| 可靠性/恢复 | `FN-4.1` 的 `全局模型目录提供安全模型配置`、`可恢复错误按受控次数重试`、`Profile timeout constrains provider execution`、`Failure exits are explicit and safe`；`FN-4.2` 的 `Agent Core orchestrates model fallback explicitly`；`FN-4.3` 的 `Model selection uses Agent-activated model configurations`、`Fallback selection recomputes model-specific context`；`FN-10.5` 的 `Gateway configuration is loaded and stabilized during startup` | assembly publication 只读取 frozen system model definitions，ready 与 primary health 只消费本地 binding，不访问 Gateway metadata；首次 Context Engine selection、显式 post-ready deep health 或其他安全目录查询逐模型解析并把局部失败冻结为 model-scoped `UNAVAILABLE`；模型边界先在同一 logical-invocation timeout/budget 内完成同模型 recoverable retry，caller 不叠加 retry；仍失败后 Core gate 才请求可信 cross-model 重装配；新模型重新预算/render 后调用 | ready/assembly publication/primary health 零 metadata I/O、deep health lazy get、catalog lazy get/list、single-flight/cancellation/freeze、retry default/override/exhaustion、total timeout、caller retry absence、selection exhaustion、fallback allowed/denied、model-specific reassembly integration tests |
| 审计/可追溯性 | `FN-4.1` 的 `Failure exits are explicit and safe`、`模型调用时间线使用 canonical identity`；`FN-4.2` 的既有 `Routing evidence owns future fallback evidence` | Model scope 统一用不参与推理/选择/routing/授权/幂等的 `operationId` 做 correlation；run-bound boundary 把 owning step 的同值 operation 投影为 timeline `stepId`，memory owner 映射 cycle identity，recommendation service 在实际调用边界建立 fresh operation；optional run coordinates 只表示 causal correlation；timeline/workbench 使用 `stepId/modelId`，observability mapper 校验该 identity 后只通过 stable run/timeline refs 关联，不把模型或 operation identity 投影为 trace/log/metric 维度；Core 将 failure 与 replay decision 组合为 applied、denied 或 exhausted evidence；framework-owned correlation header set 恰好为既有四个名称，raw provider error、endpoint、credential、header value 和 lifecycle coordinate 不跨越边界 | operation mapping/non-influence、safe failure-to-evidence integration、timeline/workbench canonical identity、observability high-cardinality non-projection、correlation-header exactness、redaction、background non-projection tests |

## 验证策略（Verification Strategy）

- contract tests 覆盖 unique `providerId`/`modelId`、两层 closed `modelProfiles`、provider registry exact lookup、同一 `modelId` 在 catalog/request/provider handoff/timeline 中的一致性、resolved `temperature=0.55`/`maxOutputTokens=32,000`/`topP=1`、catalog/query 与 selection 的封闭判别联合/签名/reason/cancellation、ready/assembly publication/primary health 零 Gateway metadata I/O、显式 post-ready deep health safe query、逐模型 lazy resolution/single-flight/freeze、单一 scope required `operationId`、optional run coordinates all-or-none、run-step/background-cycle 同值映射、operation identity 不影响 selection/routing/authorization/idempotency/inference、封闭 flat optional request fields、provider-options trust/reserved-field 与未知字段透传、Context Assembly options、Gateway metadata SPI 与 invocation request passthrough、通用 optional `FetchGateway` composition 到当前模型 consumer、SDK type non-leakage、null 和 outer unknown field rejection。
- catalog unit tests 覆盖 configured-profile inclusion、closed schema、compatible bootstrap resolution、Gateway `get` 单模型解析、`list` 全目录解析、unknown get 零 provider call、并发 single-flight、取消后可重试、Gateway failure → `UNAVAILABLE`、逐模型 freeze、app ready/primary health/Agent model-reference validation 不访问 Gateway 和 safe query，以及显式 post-ready deep model-provider health 可用同一 query/signal 触发目标模型解析。
- Context Engine tests 覆盖 Agent default/order、显式 model id、prompt/capability compatibility、unknown activation、unavailable 排除与候选耗尽、attempted exclusion、fallback eligibility、窗口/模板/options 重算和 secondary consumers。
- Prompt template tests 覆盖 canonical compatible model ids、空集合不约束、selected configuration 的单一 `modelId` 投影、closed `match.model`、八字段 closed inference-options authoring/handoff/no-override、`providerOptions` selected-adapter validation、schema/priority/specificity，以及 prompt assembly 不接收 candidate/provider access/timeout/retry。
- Lifecycle hook tests 覆盖 `BEFORE_MODEL_INVOKE` closed flat fields、`maxRetries`、unknown-field rejection、protected authority rejection、provider-option reserved collision、nested boundary 原地修改隔离、replacement-only detach 和 safe field-name-only observation，并保持其他 stage characterization。
- Capability result contract/Core tests 覆盖 `modelId` accepted/unauthorized、closed context patch、八字段 closed `modelOptions`、受治理 Skill `providerOptions` 正路径、非 Skill Capability 同形注入拒绝、optional-field no-override semantics、request-local no-mutation 和后续 selection handoff。
- Skill manifest/Tool tests 覆盖 canonical `modelId` 原值映射、八字段 closed `modelOptions`、`providerOptions` 来源与 selected-adapter validation、optional no-override，以及 unknown/provider-access/timeout/retry/null/non-object rejection。
- Core characterization/integration tests 固定 visible-output、deadline/budget、cancellation、attempted ids、evidence 和 canonical `MODEL_INVOCATION_*` safe identity，并验证 timeline `stepId` 是 run-bound scope `operationId` 的原值投影、Core timeline wrapper 由可信调用路径选择、下一模型及其输入来自 Context Engine selection result。Observability mapper/trace/log tests 固定 `stepId/modelId` event validation、duration/usage/first-visible/failure 保持、stable refs，以及 step/model/provider identity 不进入 diagnostic/trace/log；metrics tests 固定 6 个 model metrics 的 exact label schema 不含 `provider_kind`、`modelId` 或 `providerId`；workbench SQLite/server/browser tests 固定 canonical model identity、model action 旧字段不存在、Capability action 分类保持和 background recommendation 不投影。
- adapter request-level tests 覆盖 `chatModel(modelId)`、Chat Completions URL、capability-driven thinking、flat optional parameters、provider-options shallow merge/reserved rejection/unknown pass-through、messages/tools、complete tool call、closed terminal result、完整/部分/缺失/非法 usage、max-retries default/override、retryable/non-retryable、stream-after-delta、optional Gateway fetch 与平台默认 fetch、logical-invocation 总 timeout/cancel、caller-level retry 移除、full-run 与 no-run 的 framework-owned correlation header exact sets和 safe failures。
- recommendation/runtime tests 覆盖 `postTerminalCallback` 全部 production/test caller/consumer并固定既有三参数与 terminal/attachment-cleanup 语义；service/Web tests 固定 terminal 预计算与 Web on-demand 两条实际生成路径的 service-owned fresh UUID、App composition generator absence、缓存命中不生成 identity、completed-run causal correlation、background hook execution 和 pending/timeline/workbench absence；memory tests 固定 cron/cycle owner `cycleId` 到唯一 operation identity 的同值映射、run coordinates omission 与统一 model hook execution。
- plugin contract tests 证明 model policy points 仍为 RESERVED，owner metadata 与 Function 设计一致。
- architecture tests 断言 provider SDK/transport 只由 `agent-model` 拥有、模型选择只由 Context Engine 提供、Core 只负责 fallback gate，且 compatible 调用只经过目标 AI SDK adapter。
- Secret characterization tests 固定现有 env/file grammar、raw secret 不泄漏和最底层 resolver/adapter 行为；实施 diff 必须证明没有修改 Secret production path，也不新增 ENC 支持。
- `migration/model-authoring-v2/test_migrate.py` 使用 Python 标准库临时项目覆盖默认和显式 discovery、JSON/受限 YAML、Agent/Prompt/Skill 同一映射、dry-run、write/backup/journal、幂等、BOM/newline/Skill body 保真、并发变化、写入回滚与显式恢复；`--help` 和 source scan 证明工具没有进入 `packages/` 或 runtime composition。developer docs stale-field scan 固定目标 authoring 示例不再保留旧模型字段。
- workspace gates 覆盖 build、unit/integration、contract、architecture 和 OpenSpec strict validation。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：归并全局目录、父层 `providerId`/子层单一 `modelId`、model-scoped availability、单一 scope 的 `operationId` 与 all-or-none optional run correlation、集中式既有四个 correlation headers、canonical timeline identity、provider access、消费 optional 通用 Gateway fetch、Chat Completions、stream、best-effort usage、logical-invocation 总 timeout 和安全失败，作为 `FN-4.1` canonical spec。
- `openspec/specs/model-provider-configuration/spec.md`：应用全部 7 个 `REMOVED`；确认目标 specs 完整承载、来源清空且导航同步后退役该 stable spec。
- `openspec/specs/app-config-schema/spec.md`：移除触及的混合 Requirement；其中 canonical Agent App model/provider system config、host projection 和 assembly 黑盒行为分别由目标 canonical specs 承载，通用配置 freeze、evidence 与 dependency injection 白盒事实归并到长期 design。
- `openspec/specs/agent-package-assembly/spec.md`：完整保留 startup compile 与 request path 不 reparse；归并 Agent definition 省略 `modelIds` 时从 frozen system config 继承全部已校验模型的统一规则，并移除 builtin model-profile normalization 例外；补充 assembly 只保存解析后的模型激活引用、不复制全局模型配置或接入事实。
- `openspec/specs/model-profile-contracts/spec.md`：应用 2 个 REMOVED；确认清空后退役该 stable spec。
- `openspec/specs/model-info-contracts/spec.md`：应用 2 个 REMOVED；确认清空后退役该 stable spec。
- `openspec/specs/model-provider-adapter/spec.md`：移除迁往 canonical spec 的 5 个 Requirements，保留未触及 safe failure Requirement。
- `openspec/specs/model-stream-normalization/spec.md`：移除迁往 canonical spec 的 3 个 Requirements，保留未触及通用 stream Requirements。
- `openspec/specs/model-fallback-semantics/spec.md`：更新 fallback owner 分工。
- `openspec/specs/routing-evidence-and-fallback/spec.md`：移除已迁入 fallback canonical spec 的 orchestration Requirement，保留通用 evidence 行为。
- `openspec/specs/context-engine/spec.md`：归并统一模型选择、availability filter、resolved window budget 和 model-specific reassembly，作为 `FN-4.3` canonical spec。
- `openspec/specs/capability-catalog/spec.md`：把 Capability result 的模型 patch identity 原子迁移为 `modelId`，封闭 `modelOptions`，保留 request-local/no-side-effect 行为。
- `openspec/specs/lifecycle-hook-execution/spec.md`：应用 `Stage-specific boundaries and mutations are minimal runtime contracts` 的 MODIFIED；只迁移 `BEFORE_MODEL_INVOKE` mutation vocabulary，其他 stage 与 lifecycle semantics 不变。
- `openspec/specs/agent-scoped-plugin-composition/spec.md`：更新 RESERVED model policy owner metadata。
- `openspec/specs/capability-source-configuration/spec.md`：在 custom provider adapter registration Requirement 中明确模型 provider 装配不构成 Capability adapter registration。
- `openspec/specs/secret-configuration-boundary/spec.md`：把混合来源 Requirement 的 SecretReference、最底层 encrypted-envelope 处理、独立 key source 和 raw-secret 禁止语义原样迁入 canonical Requirement；不改变 Secret 行为。
- `openspec/specs/gateway-configuration/spec.md`：在 Gateway startup canonical Requirement 中明确 model-information capability 的装配不改变既有 selection、freeze、defaults 或 adapter readiness/fallback 语义，也不在 ready 前发起模型信息查询。
- `openspec/specs/ts-core-contracts/spec.md`：移除 4 个触及的混合 Requirements；模型、Context、Capability result patch、secret 与 Gateway 黑盒行为均迁入各自 canonical specs，白盒 coordinates/transaction/CAS 归并到长期 design。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：移除 3 个已由 `model-invocation-contract`、`context-engine`、`agent-package-assembly` 或其他既有 canonical Requirements 承载的 bridge Requirements。
- `openspec/specs/prompt-template-assembly/spec.md`：应用 3 个 MODIFIED Requirements；authoring 使用 canonical `modelId` string 直接赋值给 `match.model`，template `modelOptions` 收敛为八字段 closed inference schema，保留 priority、specificity 和 rendering 语义，把 compatibility 候选迁移为 canonical model ids，并使最终 assembly 只消费统一 selection result。
- `openspec/specs/question-recommendation/spec.md`：应用 `Model Invocation for Recommendations` 的 MODIFIED；保留 `SuggestedQuestionRequest`、三参数 `postTerminalCallback`、terminal guard、attachment cleanup、prompt variables、Skill context、结果清洗/解析、API、cache 和 frontend 行为，迁移到 context-owned selection、selected configuration invocation projection；terminal 与 Web 实际生成路径由同一推荐服务在调用边界建立 fresh `operationId`，保留 completed-run causal correlation但不改变 background lifecycle。
- `openspec/specs/memory-extraction/spec.md`：应用 `Extraction strategy and configuration` 的 MODIFIED；把 memory-local default/first profile resolution 更新为 context-owned selection，并明确 scheduler/cycle owner 冻结 `cycleId`、LLM strategy 同值映射为 scope `operationId`且省略不存在的 run coordinates，不改变 scheduler 触发语义、prompt safety、candidate、observability、failure 或 memory lifecycle。
- `openspec/specs/skill-tool/spec.md`：应用 `Skill tool is the model-facing Skill execution entry` 的 MODIFIED；把 Skill metadata 的模型值原样映射为 canonical `modelId`，并把 manifest/parser/runtime/mapper 的 `modelOptions` 收敛为八字段 closed inference schema，其中 `providerOptions` 仅来自已接受的受治理 Skill metadata；不保留 `modelName` alias 或名称反查，其他 Skill 执行行为不变。
- `openspec/specs/dev-agent-workbench/spec.md`：在 `add-ts-dev-agent-workbench` 已归档的 stable baseline 上应用 `Run-bound model invocations use one runtime timeline boundary` 与 `Workbench exposes a reconstructed run effective view` 的 MODIFIED；工作台 timeline、SQLite/server/browser projection 和 effective view 使用 `stepId/modelId/modelIds/defaultModelId`，background recommendation 不形成 run-bound action。
- `openspec/specs/agent-runtime-metrics/spec.md`：应用 `Metric inventory 必须声明来源、标签和增强需求` 与 `Metric labels 必须低基数且固定` 的 MODIFIED；6 个 model metrics 删除 `provider_kind` label，保留 metric name/value/dedup 与其他 inventory。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：更新 catalog、request、adapter 和 usage。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.2-模型失败降级.md`：更新 fallback gate/selection/reassembly。
- `openspec/designs/functions/D4-模型与上下文/D4.2-上下文管理与压缩/FN-4.3-装配上下文.md`：更新 selection 和 window source。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.2-装配插件.md`：更新 RESERVED model policy owner metadata。
- `openspec/designs/functions/D3-Agent装配与主链路/D3.1-智能体装配/FN-3.2-编译智能体装配.md`：同步 assembly 只携带模型激活引用的目标 Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.1-能力治理/FN-5.1-管理能力目录.md`：同步 custom Capability adapter registration 的 canonical Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.1-能力治理/FN-5.2-调用能力.md`：同步 canonical `modelId`、closed model options 和 request-local patch governance。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：同步 model-invoke flat mutation fields、`maxRetries` 与 protected authority。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.4-自定义工具和提示词.md`：同步单一 `modelId` authoring、canonical compatible model ids、唯一 selection owner 和 final projection。
- `openspec/designs/functions/D1-会话与流式交互/D1.4-智能输入辅助/FN-1.20-查看推荐问题.md`：同步推荐生成的统一模型选择、selected configuration invocation projection 与 post-terminal background scope。
- `openspec/designs/functions/D5-Capability能力体系/D5.3-Skill与检索/FN-5.9-调用技能.md`：同步 Skill model metadata 到 canonical `modelId` 的原样映射和治理 handoff。
- `openspec/designs/functions/D8-数据与记忆/D8.2-记忆/FN-8.3-记忆提取和老化.md`：同步后台 extraction 的统一模型选择、safe prompt projection 和真实 background scope。
- `openspec/designs/functions/D6-安全与治理/D6.3-交互与信息安全/FN-6.9-引用密钥.md`：同步 `credentialRef` 从 legacy flat model profile 移到两层 `modelProfiles[]` 父项，以及规范归属迁移；SecretReference、最底层 encrypted-envelope 处理、独立 key source 和 raw secret 边界保持不变。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.5-集成外部系统.md`：同步 Gateway canonical Requirement 的防回归边界。
- `openspec/designs/features/D4-模型与上下文/D4.1-模型调用与降级/F-4.1-接入多种模型.md`：更新统一目录、canonical/provider-native identity、model-scoped availability、受控调用/header 扩展、总时限同模型 retry 和 best-effort usage 保证。
- `openspec/designs/features/D4-模型与上下文/D4.1-模型调用与降级/F-4.2-模型失败降级.md`：更新 fallback 重装配保证。
- `openspec/designs/features/D4-模型与上下文/D4.2-上下文管理与压缩/F-4.3-自动管理上下文窗口.md`：更新 provider-normalized window。
- `openspec/designs/features/D5-Capability能力体系/D5.1-能力治理/F-5.1-统一能力治理.md`：更新 Capability result 模型 patch vocabulary。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.1-扩展生命周期钩子.md`：更新 `BEFORE_MODEL_INVOKE` mutation vocabulary 与 authority guardrails。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.2-装配插件.md`：更新 RESERVED model policy responsibility 说明。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.4-自定义工具与提示词.md`：更新 prompt authoring identity 字段、内部 canonical model identity 与 selection owner 说明。
- `openspec/designs/features/D1-会话与流式交互/D1.4-智能输入辅助/F-1.9-智能问题推荐.md`：更新推荐生成消费统一 selected configuration 与真实 post-terminal lifecycle 的保证。
- `openspec/designs/features/D5-Capability能力体系/D5.3-Skill与检索/F-5.6-Skill系统.md`：更新 Skill 模型选择使用 canonical `modelId` 的保证。
- `openspec/designs/features/D8-数据与记忆/D8.2-记忆/F-8.2-长期记忆.md`：更新后台 extraction 的统一模型选择与真实 lifecycle scope 保证。
- `openspec/overview.md`：仅在存在 `model-profile-contracts` 或 `model-info-contracts` 导航时清理；当前检查无直接导航。
- `openspec/designs/architecture/model-provider-boundary.md`：更新 catalog、selection、invocation 和 fallback owner。
- `openspec/designs/architecture/core-contracts.md`：更新 model query、invocation 与 Context Assembly options。
- `openspec/designs/architecture/ts-backend-architecture.md`：更新模块职责和端到端模型流。
- `openspec/designs/modules/agent-model.md`：更新 catalog、metadata、binding 和 adapter。
- `openspec/designs/modules/agent-context-engine.md`：更新 selection owner。
- `openspec/designs/modules/agent-core.md`：更新 fallback orchestration owner。
- `openspec/designs/modules/agent-capability.md`：更新 Capability result context patch 的 canonical model identity 与 closed options。
- `openspec/designs/modules/agent-app.md`：更新 config/composition 与 public app projection。
- `openspec/designs/modules/agent-memory.md`：更新 memory extraction selection dependency。
- `openspec/designs/modules/agent-session.md`：更新 suggested questions selection dependency。
- `openspec/designs/modules/agent-workflow.md`：更新 model node selection dependency。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：删除退役的 `model-profile-contracts`、`model-info-contracts` 行，刷新 canonical specs 及相关 Functions 导航；不新增 Function。

## 风险与取舍（Risks / Trade-offs）

### 归档后一致性归并

归档同步同时修正了四个未形成独立新行为、但与 canonical delta 结果冲突的旧基线表述：`agent-package-assembly` 的 `Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields` 和 `ts-core-contracts` 的 `Agent assembly and request routing baseline` 改用 `modelIds/defaultModelId`；`ts-backend-architecture` 的 `composition refactor 保持产品行为` 删除已经由本 change 明确移除的 `modelProfileRegistry/productModelProviderKind` 投影；`e2e-spec-shall` 的 Model and Context 清单删除三个已退役 legacy specs。这些归并只消除 stable baseline 内部矛盾，不增加 proposal、Function 或实现范围外的新行为。

- Gateway metadata 不参与 app ready 或只引用已知 configured profile 的 assembly publication；首次安全目录查询会承担远程解析延迟，任一失败会使对应 profile 在本进程中保持 `UNAVAILABLE`。该取舍移除启动时序依赖并避免用猜测窗口调用模型；恢复需要重启。
- fallback 重新装配增加失败路径延迟。该取舍保证下一模型使用自己的窗口、prompt compatibility 和 options。
- 开放 `providerOptions` 会把未来 provider-native JSON 交给外部服务。该取舍保留 Agent 开发者扩展能力；模型边界只维护稳定的 reserved authority set，不维护易过期 allowlist，并通过来源治理、值不进入观测和 provider access 前冲突拒绝控制风险。
- optional `FetchGateway` 改变模型注册时序：app 必须先完成 Gateway bindings、再建立模型 catalog/adapter。该 port 使用通用名称，允许后续 change 让其他 outbound HTTP consumer 复用同一环境隔离能力；当前 change 只装配模型 adapter，不迁移其他 REST client。该取舍保证预装配 bindings 与仓库外 REMOTE provider 走同一 composition path；LOCAL 缺失时仍使用平台默认 fetch，不新增本地实现。
- 同模型 retry 可能增加 provider 工作量、成本和终态延迟。NextAgent 默认值 `2` 将单次调用限制为至多三次 provider request；实际 retry 只处理明确可恢复且尚未发布 public stream delta 的失败，并始终受 cancellation、timeout 和 runtime budget 约束。
- 全局唯一 `modelId` 不支持用多个 profile identity 表达同一 provider model 的固定参数变体；调用差异应由 profile 默认值与业务调用参数表达。
- public contract 变化面大于单纯 SDK 替换，release unit 涉及 16 个 Functions 与 25 个 delta specs。全部直接调用方必须作为一个 release unit 更新，不提供双写或 alias；model contract/boundary、selection/secondary consumers、composition/observability/workbench 三条 seam 分别提供集成证据。
- recommendation 同时存在 terminal 预计算与 Web on-demand 两条实际模型生成路径；若 identity 在 callback 或 Web request 层建立，会造成 path-specific contract 和不可信输入歧义。因此 identity 只在共享推荐服务的实际模型调用边界建立，并通过 characterization 固定 callback/request 非回归。
- `productModelProviderKind` 是 frozen public field 删除。当前仓内没有 production consumer，但外部可信 Host 仍可能编译依赖；群内确认与 release note 必须明确迁移到 `systemConfig.modelProfiles[].providerId`，不得静默保留歧义 alias。
- model metric `provider_kind` label 删除会影响依赖该维度的 dashboard/alert query。release coordination 必须同步消费者改为按 metric name、`outcome` 和 `token_type` 聚合；系统不提供 `OTHER`、`modelId` 或 `providerId` 兼容 label。
- `add-ts-dev-agent-workbench` 是本 change 的归档硬前置，不得以临时 compatibility 绕过。
- AI SDK 6 不是最新 major，但能把领域边界重构与 SDK major 升级风险分离。
- 无依赖 Python 工具只支持 authoring 所需的受限 YAML 子集，不能安全保留 comment、anchor、tag 或多文档语义。该取舍避免自研通用 YAML parser；遇到不受支持结构时在写入前阻塞并要求开发者先手工简化，绝不猜测转换。

## 迁移与回滚（Migration / Rollback）

### Developer source asset 离线升级

本 change 原子修改 system config、Agent、Prompt Template 和 Skill 的模型 authoring shape；目标 runtime 只接受目标格式，不提供旧字段 alias、dual read 或 startup auto-migration。仓库因此在 `migration/model-authoring-v2/` 提供一次性离线升级入口，供 Agent 开发者在切换 runtime 版本前处理自己的项目源码；该目录独立于 `packages/`，不属于 `FN-4.1` 的运行时 contract，也不被 runtime package、package export、runtime composition 或 startup path 引用。Agent 开发者从目标 NextAgent release/tag 的源码复制单个 `migrate.py` 后可在任意位置运行，脚本位置不参与资产发现，只有显式 `--root` 与分类路径参数决定 developer-owned source scope；不要求把脚本复制到 Agent 项目或部署包。

工具形态固定为一个 Python 3.11+ 标准库脚本 `migrate.py`，同目录放置 `test_migrate.py` 和 README。默认 `--root .`、默认 dry-run，并按开发者项目的公开目录检查 `application.yaml`、`agents/**/agent.yaml`、Agent prompts、Agent-local Skills 和 project Skills；`--system-config`、`--agent-root`、`--prompt-root`、`--skill-root` 可显式覆盖不使用默认布局的分类。全部输入必须位于同一可信 root 内；工具不得扫描 NextAgent framework source、依赖/build/cache 目录，不得读取 config 中的任意路径扩大 scope，也不得跟随 symlink；扫描范围内遇到非排除目录 symlink 或目标资产 symlink时必须失败，不能静默漏迁移。

同一次 plan 使用 system config 建立唯一跨文件 model identity mapping，并原子应用以下转换：

| asset | source shape | target shape |
|---|---|---|
| system config | flat `profileId/providerKind/modelName/modelOptions` | parent `providerId` + child `models[].modelId`，canonical inference fields 展开到 child |
| Agent definition | `modelProfileIds`、`runtimeSettings.defaultModelProfileId` | `modelIds`、top-level `defaultModelId` |
| Prompt Template | object `match.model.{providerKind,modelName}` | scalar `match.model: modelId` |
| Skill | top-level、JSON 或 `metadata.nextagent.*` 中的 legacy identity/options | 受支持的 `model` / `metadata.nextagent.model` authoring 值统一为 canonical `modelId`，options 使用 closed inference shape；额外 selected-provider 扩展归入 `providerOptions` |

无依赖工具只解析 JSON 和明确记录的受限 YAML/SKILL frontmatter 子集。旧 `modelName` 是 `env:` 引用且系统恰好只有一个已启用模型时，Agent 的同一显式引用 MUST 改为省略 `modelIds/defaultModelId` 并继承唯一系统模型；Prompt、Skill 或多模型 Agent 的动态模型引用不能无损表达，MUST 阻塞人工固定 canonical id。duplicate identity/key、冲突 provider access、disabled/unknown reference、source/target mixed shape、无法无损表达的 Model Gateway access，以及 comment、anchor/alias、tag、multi-document、folded/keep-chomping block 等不支持 YAML 结构，必须在任何写入前以稳定 reason code 失败；工具不得猜测转换。报告只允许相对文件标识、change reason 和 model identity mapping，不得包含 endpoint、credential 或 provider option value。

`--write` 必须先完成全项目 plan，再在 `<root>/.nextagent-migration/model-authoring-v2/<run-id>/` 创建 root-contained backup 与 journal；每个替换前重新核验 source SHA-256，并用同目录临时文件加原子 replace 写入。任一写入失败时立即回滚已替换文件；自动回滚发现目标既非该 run 的 source 也非 target hash 时 MUST 保留开发者并发修改并标记 `rollback_failed`，不能用备份覆盖。进程中断留下的 prepared/applying/rollback-failed run 通过显式 `--recover <run-id>` 恢复。recovery MUST 在任何写入前完整校验 journal、全部 backup/source/target hash 和 root scope；当前目标既非该 run 的 source 也非 target hash 时 MUST 以 `RECOVERY_TARGET_CHANGED` 阻塞，不能覆盖开发者后续修改。成功迁移后再次运行应得到 `NO_CHANGES`。恢复目录包含原始 developer source，只用于本地恢复，文档 MUST 要求把 `.nextagent-migration/` 排除在版本控制和发布包之外。

迁移验证由 Python 标准库 `unittest` 在临时开发者项目中覆盖 CLI discovery、JSON/受限 YAML、跨资产映射、dry-run、write、backup/journal、幂等、BOM/newline/Skill body 保真和安全报告；并使用受控 fault injection 覆盖并发变化、部分写入失败、进程中断和显式恢复。开发者文档同步只展示 target authoring shape，并说明 dry-run、write、backup/recovery、路径 override、YAML 支持边界和需要人工处理的阻塞情况。

实施顺序固定为：

1. 建立目标 contract、Function 行为和 architecture gate。
2. 实现 `agent-model` private model slot index、逐模型 lazy catalog slot、single-flight metadata resolver 和 safe query。
3. 通过 frozen `systemConfig.modelProfiles` 校验并发布 Agent assemblies，再注入 invocation authorization；验证 ready 前不调用 Gateway model-information service。
4. 原子迁移 Capability result producer/schema/consumer（包括 Skill Tool mapper）的 `modelName → modelId`，固定八字段 closed inference `modelOptions`，并只为受治理 Skill metadata mapping 开放 `providerOptions`。
5. 迁移 Context Engine selection、prompt compatibility、memory extraction、question recommendation、workflow 等 secondary consumers 和 Core fallback reassembly。
6. 收窄 invocation request 与 `BEFORE_MODEL_INVOKE` lifecycle mutation，迁移到唯一 `modelId`、扁平可选参数和受控 `providerOptions`。
7. 原子迁移 run-bound `MODEL_INVOCATION_*` producer、persisted schema、历史读取、`agent-observability` timeline mapper/trace/log/metric projector 和 dev workbench server/browser projector：timeline/workbench 使用 `stepId/modelId`，observability 只用它们做 event validation/pairing并通过 stable refs 关联；删除 `modelProfileId/providerKind/modelName` 与 model metric `provider_kind` label。
8. 在 Gateway bindings 完成后装配目标 compatible SDK adapter、固定既有四个名称的集中式 correlation-header composer、optional `FetchGateway` 和总时限内受控同模型 retry；删除 outbound header policy 和全部 caller-level same-model retry，并接通 model-owned catalog、context-owned selection 与 Core fallback gate。其他 REST client 保持不变。
9. 在采用目标 runtime 前对 developer-owned system config、Agent、Prompt Template 和 Skill assets 运行独立迁移工具 dry-run；计划无误后显式写入并保留备份/journal，再以目标 runtime parser 验证启动。同步发布只展示目标格式的开发者文档。

部署发布单元原子启用目标 request contract、catalog、selection、adapter 和 fallback flow。全部 Agent 激活 id 必须在 frozen `systemConfig.modelProfiles` 中有效；Gateway metadata 只由 ready 后首次安全目录查询触发，失败产生 model-scoped degradation evidence，compatible endpoint 不返回 usage 时仍完成成功调用。归档时以已经包含 `add-ts-dev-agent-workbench` 的最新 stable `Run-bound model invocations use one runtime timeline boundary` 与 `Workbench exposes a reconstructed run effective view` 为来源应用本 change 的两个 `MODIFIED` deltas。

runtime 回滚必须整体恢复上一发布单元的 contracts、composition、context/core consumers、provider dependency 和 default configuration；不得只回滚 SDK package 或只恢复 request fields。developer-owned assets 若需回到升级前状态，必须使用对应 run journal 的 `--recover` 或备份，而不是依赖 runtime dual read。回滚后运行上一版本 contract、kernel、fallback 和 provider smoke tests。

## 群内确认

本 change 修改的 frozen `agent-contracts` 目标 shape、明确不变边界和确认状态记录在 `references/model-provider-options-contract-confirmation.md`。2026-07-28 已确认原范围继续有效；2026-07-29 已对 ready/assembly publication/primary health 前零 Gateway metadata I/O、逐模型 lazy resolution/single-flight/freeze、产品 `providerId` 封闭清单、catalog/selection configuration 同形复用、selection request scope/mode、Prompt model scalar 和 thinking 单一 authority 完成补充确认，全员同意且无异议；2026-07-30 本任务需求方明确确认开放 provider-options、环境中立的 optional Gateway fetch、删除 header policy、raw agent id 不拒绝和 hook 低复制隔离。目标范围包括：

- `ModelProfile`、required non-empty Agent activation model references、产品 `providerId=openai-compatible | model-gateway` 清单及 access shape、safe catalog/query 的逐模型 lazy resolution/single-flight/freeze、available entry 不重复顶层 `modelId`、selection 原样复用 frozen configuration、ready/assembly publication/primary health 前零 Gateway metadata I/O、显式 post-ready deep health safe-query path、Gateway model-information port 和 canonical binding；
- `ModelInvocationRequest`、既有 flat closed scope 的 required `operationId` 与 all-or-none optional run coordinates，以及 operation identity 不参与推理/选择/routing/授权/幂等；
- optional/default resolution：`temperature=0.55`、`maxOutputTokens=32,000`、`topP=1`，其余通用推理字段沿用 provider 缺省，`providerOptions` 缺失时不发送、`timeoutMs=30,000 ms`、`maxRetries=2`，以及 Prompt/Skill/Capability/hook 的“省略即不覆盖”语义；
- Context-owned selection/assembly、`ModelSelectionRequest.identityContext + explicit Agent fields`、`INITIAL | FALLBACK` mode、Capability result canonical `modelId`、`BEFORE_MODEL_INVOKE` mutation、scalar `match.model` prompt compatibility identity；
- `TraceableSummaryGenerationRequest` 的 required trusted string-only `flowVariables`，以及同一次 context assembly 中 summary selection/prompt assembly 的一致消费；runtime 原始用户问题 `input_question` 不进入该投影；
- `SuggestedQuestionRequest` 与三参数 `postTerminalCallback` 保持不变，推荐服务在 terminal/Web 的实际模型调用边界通过 service-owned cryptographically secure UUID generator 建立 scope `operationId`，App composition 不感知该 generator；
- 顶层 `thinking` 是 thinking/reasoning input control 的唯一 authority；reasoning 输出仍只覆盖归一化和既有展示/时间线用途，模型输入消息、工具轮续接、跨轮上下文和 provider continuation 回传不进入本 change；
- `agent-contracts/gateway` 的环境中立 optional `FetchGateway` 与 `GatewayBindings.fetch`、Gateway bindings 完成后的 app-to-model composition、当前 change 不迁移其他 REST client、LOCAL 缺省平台 fetch、仓库内不提供 REMOTE fetch，以及不引入额外 header policy；
- `providerOptions` 对未知 JSON 扩展开放，只拒绝 canonical 顶层与 identity/access/transport reserved authority collision；`agent-model` 集中生成固定的既有四个 correlation headers、same-model retry/timeout、closed provider-neutral `ModelFinalResult`、timeline/workbench canonical model identity、observability 高基数 identity non-projection、model metric `provider_kind` label 删除、Agent App system config canonical migration，以及重复 `NextAgentApp.modelProfileRegistry` 与 `productModelProviderKind` 删除。

确认状态、参与者、日期、异议条目和 follow-up 只在该记录中维护。
