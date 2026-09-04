## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.3 自定义路由策略` | 增加从当前 Agent bound Skill/Workflow 中进行模型语义选择的官方 routing policy | `agent-routing-core` | `FN-10.3 自定义路由策略` |
| `FN-10.2 装配插件` | 通过 plugin API `1.2` factory host 提供 closed runtime services，保持 routing policy 三参数 contract，并把官方 artifact 纳入 backend-capable 本地 runtime 包 | `agent-scoped-plugin-composition` | `FN-10.2 装配插件` |
| `FN-10.4 自定义工具和提示词` | 把既有 template assembly 提升为唯一公共 resolver，并为 router 增加 well-known purpose 与显式无匹配结果 | `prompt-template-assembly` | `FN-10.4 自定义工具和提示词` |

### 新增目录架构评审

评审结论：`PASS`（2026-08-11）。

| 新增目录 | owner | 职责边界 | 生命周期 | 构建、打包和运行时影响 |
|---|---|---|---|---|
| `openspec/changes/add-agent-router-plugin/specs/prompt-template-assembly/` | active change `add-agent-router-plugin` | 只承载 `FN-10.4 自定义工具和提示词` 对 canonical spec `prompt-template-assembly` 的 delta Requirements；不承载实现、fixture、生成物或长期 stable spec | 随 active change 创建；归档时按 OpenSpec 流程合并到同名 stable spec并随 change 进入 archive | 不进入 TypeScript build、runtime package 或请求路径；只影响 OpenSpec validation 与归档同步 |

## `FN-10.3 自定义路由策略`

### 目标与规范依据

本 Function 在显式路由未先行决策时，只从当前 Agent 显式绑定且当前请求治理可用的 Skill/Workflow 中选择一个目标；optional RAG 只缩小候选，模型输出不能扩大候选，no-match 进入模型循环，依赖失败安全拒绝。

#### 本 Function 的目标 Requirements

canonical spec：`agent-routing-core`

- `ADDED`：`agent-router-plugin仅选择当前Agent绑定的可用能力`
- `ADDED`：`agent-router-plugin按配置限制目标类型`
- `ADDED`：`agent-router-plugin可通过受治理RAG Tool预筛候选`
- `ADDED`：`agent-router-plugin使用当前Agent初始模型执行一次受控选择`
- `ADDED`：`agent-router-plugin依赖失败时安全拒绝`

本 change 顺序依赖 `add-routing-explicit-priority` 的显式路由先行语义，并保持其三参数 policy executable contract；不修改 directive、trusted target、policy rule 或下游 Skill/Workflow 处理语义。

### 当前实现

- `decideAgentRoutingPolicy()` 已先执行 `DefaultAgentRoutingPolicy.resolveExplicitRouting()`，未命中时通过 `AgentPolicyResolverPort` 取得 assembly-scoped executable；resolver 同时返回 exact accepted assembly。
- `AgentRoutingPolicyExecutable.decide()` 当前收到 `run/context/signal`；该 shape 已能携带 accepted request facts，但 plugin factory host 尚未提供执行路由算法所需的公共 runtime ports。
- `AgentAssembly.capabilityBindings` 保存 capability id/type/provider/enabled/description；`CapabilityCatalog.resolve()` 可按 trusted Owner Scope、session 与 accepted assembly 取得唯一治理结果。
- builtin `Rag` 已通过统一 Capability invocation 接收 query、optional indexes 与 topK，并返回有界 results；不支持 request-local 临时建索引。
- 现有模型调用边界接受 accepted invocation scope 与 model id。Agent 初始模型顺序为 request explicit model、`defaultModelId`、`modelIds` 首个 eligible；routing 选择不改变后续模型 fallback。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| bound 且治理可用的 Skill/Workflow 候选 | plugin 收到 accepted facts，但 factory host 无 assembly/catalog services | 缺少 startup-injected public runtime ports |
| optional RAG 预筛 | Capability invocation 已是统一受治理 Tool 边界 | plugin 尚不能从 factory host 获得该 port |
| 当前 Agent 初始模型终选 | model selection/invocation 与 prompt resolver 已有 public ports | plugin 尚不能从 factory host 获得这些 ports |
| 官方可配置 policy | SDK 只有通用 helper | 缺少稳定 ids、config schema、policy/artifact helper |
| 旧 plugins 不回归 | executable 为三参数 | 必须保持该 contract，不增加 router-specific 参数 |

### 修改方案

唯一实现路径是 plugin API `1.2` factory host 提供 closed `runtime` services，官方 plugin 捕获这些 public ports并在自己的三参数 `decide()` 中完成完整选择。`agent-core` 保持 policy point owner，只负责调用、timeout、result validation 和 failure boundary；不创建 router-specific runtime context、operations 或 selector。

1. `agent-contracts/core` 恢复并保持 `AgentRoutingPolicyExecutable.decide(run, context, signal)`，删除本 change 引入的 selection options、`AgentRoutingPolicyOperations` 与 `defaultSelectionTask`。
2. `agent-plugin-sdk` 增加 plugin API `1.2`。`PluginFactoryHostV1_2.runtime` 是 closed required object，包含 `AgentAssemblyRegistry`、`CapabilityCatalog`、`CapabilityInvocationPort`、`ModelSelectionService`、`ModelInvocationService` 与 `PromptTemplateResolverPort` 六个 public ports；没有 `extensions`、index signature、dynamic lookup 或 implementation imports。
3. `agent-app` 在 plugin preload 前创建 deferred runtime services host，把稳定 facade 提供给 API `1.2` factory；在 assembly、capability、model 与 prompt composition 完成后一次性绑定六个 targets。未绑定调用与重复绑定都 fail closed。该 deferred binding 只解决启动拓扑，不拥有路由语义。
4. plugin 按 assembly binding 顺序筛选 `enabled !== false` 且被 selection mode 允许的 `SKILL|WORKFLOW`。逐项通过 `CapabilityCatalog.resolve()` 解析，只有 descriptor `availabilityStatus=AVAILABLE` 且 kind 与 binding type、provider 与 binding 一致的条目进入候选；重复 kind+id 只保留第一次，不调用全局 `listAvailable()`。
5. 候选为空直接返回 `MODEL_DRIVEN_LOOP + AGENT_ROUTER_PLUGIN_NO_MATCH`。候选仅包含 kind、capability id、display name 和 description，不投影 provider、schema、path 或完整 assembly。
6. 未配置 `ragPrefilter` 或候选数不超过 effective topK 时跳过 RAG。配置且 N>topK 时，plugin 要求当前 assembly enabled-bind `Rag`，再通过 catalog resolve 验证其为 available `TOOL`，使用同一 request scope、原 signal 与 `maxRetries=0` 直接调用 runtime `CapabilityInvocationPort`。
7. RAG query 使用 `acceptedInputText.trim()` 前 256 个 Unicode code points。结果 `source` 只接受 `capability/SKILL/<capabilityId>` 或 `capability/WORKFLOW/<capabilityId>`；按结果顺序去重并与原候选求交，至多保留 topK。完整成功零命中返回 no-match；失败、无合法 degraded chunk、取消或 unavailable 抛出安全错误，不回退完整候选。
8. plugin 使用 accepted scope、purpose `AGENT_ROUTING_SELECTION`、trusted string flow variables 和同一个 signal 调用 runtime `ModelSelectionService` 的 `INITIAL` 模式；不得自行复制 default/first-eligible 或 prompt-model compatibility 规则。selection failure 由 core 既有 policy failure boundary 安全拒绝。
9. model selection 成功后，plugin 将 selected canonical `modelId` 投影给 runtime `PromptTemplateResolverPort.resolve()`。resolver 从 app 启动期冻结的同一 Agent-scoped registry 选择并渲染 Agent template；匹配时返回 `RESOLVED`，无匹配时返回 `NOT_FOUND`。候选为空或 RAG 零命中时直接 no-match，不执行 model selection 或 template resolution。
10. plugin 在 resolver 返回 `RESOLVED` 时使用 `renderedContent`，返回 `NOT_FOUND` 时使用插件私有 `defaultSelectionTask`；两者都作为模型请求 `task`。完整 accepted input 和 effective final candidate JSON 继续作为分离字段；`tools=[]`、`toolChoice=NONE`、`temperature=0`、`maxOutputTokens=128`、`maxRetries=0`，不合并 template `modelOptions`。parser 只接受单个 exact JSON object：`{kind:'NONE'}` 或 `{kind:'SKILL'|'WORKFLOW',name:string}`；未知字段、多目标、空 name、kind/name 不匹配或候选外目标均失败。
11. 合法 Skill/Workflow 分别映射既有 `DETERMINISTIC_FLOW` 与 `skillName/recipeName`；合法 NONE 映射 `MODEL_DRIVEN_LOOP`。core executor只附加 accepted assembly并使用既有异常/非法结果 `REJECT` boundary；本 change 不修改通用 timeout helper。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `agent-router-plugin依赖失败时安全拒绝` | accepted run/assembly一致性校验、binding/catalog 交集、受治理 Tool 调用、RAG 再求交、strict output membership | unbound、disabled、wrong-kind、foreign source、非法模型输出均不能形成目标选择；公共诊断不含原文 |

## `FN-10.2 装配插件`

### 目标与规范依据

本 Function 需要扩展 plugin factory host，使插件可捕获实现完整路由策略所需的公共 runtime ports，同时保持 routing policy 的三参数 contract，并生成可由既有 plugin mechanism 加载的官方 artifact。

#### 本 Function 的目标 Requirements

canonical spec：`agent-scoped-plugin-composition`

- `ADDED`：`插件 factory host 提供受治理 runtime services`
- `ADDED`：`本地runtime包携带agent-router-plugin但不默认激活`

### 当前实现

- `agent-plugin-sdk` root 支持 plugin API `1.0|1.1`，导出 `defineAgentRoutingPolicy()`；SDK 允许依赖 `agent-common` 与 `agent-contracts` public subpaths，不允许依赖实现 packages。
- plugin loader 已支持 object export、config schema、assembly-scoped `configure(config)`、manifest/import scan 和 activation validation。
- `AgentRoutingPolicyExecutable` 位于 `agent-contracts/core`，`agent-core` 是调用 owner；SDK re-export durable type，runtime registry只存储/解析 executable。
- `scripts/pack-local-runtime.mjs` 已通过 SDK artifact helper 把官方插件暂存到 backend-capable package 的 `config/plugins/<pluginId>/`；当前只包含 `developer-hook-trace` 与 `context-monitor`，尚未包含 `agent-router-plugin`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 官方 router artifact | SDK 无对应 subpath/helper | 缺少 plugin object、schema、ids 和 artifact bundle |
| plugin独立执行受治理选择 | factory host无runtime services | 缺少API `1.2` closed runtime services |
| 旧 plugin兼容 | JS/TS 三参数实现已存在 | 必须保持decide shape与API `1.0|1.1` host shape |
| 默认发行包可直接配置router | SDK helper已能生成artifact，但pack flow未调用 | 缺少`config/plugins/agent-router-plugin/` staging与未激活断言 |

### 修改方案

1. `agent-contracts/core` 不增加第四参或 router-specific public type；selection mode、RAG config与runtime实现类型归 `agent-plugin-sdk/agent-router-plugin`。
2. SDK root 增加 `PluginFactoryHostV1_2` 与 closed `PluginRuntimeServices`，保留API `1.0`只含`externals`、API `1.1`增加developer diagnostics的既有shape；loader按effective API version注入精确host。
3. SDK `agent-router-plugin` subpath 导出 stable ids、config types/schema、`createAgentRouterPlugin(runtime)` 与 `createAgentRouterPluginArtifact()`。plugin code持有immutable `defaultSelectionTask`和完整选择算法；policy `configure(config)` 只冻结validated selection/RAG options。
4. artifact helper沿用既有安全目录/overwrite约束，生成API `1.2` factory default export、空 `hostExternals` 和自包含bundle，不写system/Agent config。
5. runtime policy registry 保持只负责校验、冻结与解析 executable；plugin loader 按 API `1.2` 注入精确 factory host，app composition 只创建并绑定 runtime services，不包含 router 选择算法。
6. runtime services只提供当前明确需要的六个public ports。后续新增host service必须OpenSpec先行并升级plugin API version；不得添加`extensions`、index signature、动态lookup、inventory或占位方法。
7. `scripts/pack-local-runtime.mjs` 在 backend-only 与 with-frontend staging 中从已构建的 `agent-plugin-sdk` 导入 `createAgentRouterPluginArtifact()`，并写入 `config/plugins/agent-router-plugin/`。pack flow 不修改 `createReleaseConfigSample()`，不向 `nextAgent.system.plugins[]` 增加 router，也不修改默认 Agent `policies[]`。

#### 质量属性影响

无新增黑盒质量目标。实现通过版本化 factory host、SDK到contracts的单向依赖和不变三参数policy shape控制兼容性；由 contract/architecture tests验证。

## `FN-10.4 自定义工具和提示词`

### 目标与规范依据

canonical spec：`prompt-template-assembly`

- `MODIFIED`：`Prompt templates are assembled by purpose`
- `MODIFIED`：`Prompt assembly has one decision boundary`
- `MODIFIED`：`Prompt assembly boundary guardrails`

### 当前实现与GAP

Context Engine 已有唯一 `PromptTemplateAssembler` 实现及 Agent-scoped frozen registry，app 已在启动装配时注册 builtin 与 Agent package `prompts/`。但该 assembler 类型位于 private implementation package，外部 consumer 无法通过跨 package public contract 使用；router 因此在 core 中硬编码终选 task。

### 修改方案

1. `agent-contracts/context` 只新增 `PromptTemplateResolveRequest`、closed `RESOLVED | NOT_FOUND` `PromptTemplateResolveResult`、rendered section DTO、对应 TypeBox schemas 与 `PromptTemplateResolverPort.resolve(request, signal)`。request 仅含 purpose、Agent scope、locale、string-only flow variables、closed selected model 和 optional `memoryEnabled`；`RESOLVED` 仅含 safe template identity、rendered sections/content 与 optional canonical model options handoff，`NOT_FOUND` 不携带模板事实。
2. `agent-context-engine` 用现有 assembler/registry 实现该 port，并在调用前后检查 cancellation；不增加第二个选择算法、request-time file loader 或公共 registry/compiler contract。既有内部 consumer 可继续复用同一实现边界。
3. `agent-app` 创建 registry-backed resolver，并把同一实例绑定到需要该 public port 的 composition consumer；对 router 仅通过 API `1.2` runtime host 提供该实例，app 不拥有 router 的 model/template sequencing。
4. `agent-router-plugin` 只通过 plugin runtime services 中的 public resolver 与 model selection ports消费 rendered content和safe template identity，保留自身固定的无Tool、有界模型控制，不应用模板model options；`agent-core`不依赖prompt resolver。
5. framework well-known purpose 增加 `AGENT_ROUTING_SELECTION`，Context Engine builtin root 不提供该 purpose 的默认内容。Agent package 可通过现有 `prompts/{templateId}/template.yaml`、purpose 与 match 规则注册 override；无匹配候选时 resolver 返回 `NOT_FOUND`，官方插件使用自身内置 default task。

#### 质量属性影响

无新增黑盒质量目标。单一 resolver contract 消除 core 对实现 package 的依赖和硬编码 prompt，同时保持 template source、registry、model compatibility 与 rendering authority 归 Context Engine。公共 contract 不携带文件路径、raw request context、候选模型或调用方指定 template id。

## 跨 Function 协作与端到端流程

```text
backend-capable package stages config/plugins/agent-router-plugin (inactive)
  -> operator declares trusted plugin config + Agent policy activation
  -> existing loader / policy registry
  -> explicit routing first
  -> core calls configured agent-router-plugin.decide(run, context, signal)
  -> plugin uses factory-captured runtime services
  -> binding + catalog governance
  -> optional builtin Rag prefilter
  -> ModelSelectionService(INITIAL, AGENT_ROUTING_SELECTION)
  -> PromptTemplateResolverPort.resolve(selected model) -> RESOLVED Agent override | NOT_FOUND
  -> resolved task | plugin-owned defaultSelectionTask
  -> current Agent model final selection
  -> existing AgentRoutingDecision downstream path
```

`FN-10.2` 只定义 plugin authoring/executable contract；`FN-10.3` 拥有候选治理、模型/RAG 路由语义和结果翻译；`FN-10.4` 拥有通用 template selection/rendering contract。`agent-app` 只装配通用 model selection 与 template resolver，不增加 plugin-specific routing service。

## 验证策略

- contract tests固定三参数policy不变、API `1.2` closed runtime host与API `1.0|1.1`兼容。
- SDK tests覆盖ids、config schema/defaults、三种selection mode、optional RAG、runtime未绑定fail closed、完整黑盒选择与artifact shape/overwrite。
- packaging boundary tests覆盖backend-capable package生成`plugin.json + index.js`，并断言package config sample与默认Agent不声明/激活router。
- SDK router tests覆盖binding/catalog交集、selection modes、RAG skip/N>topK/source交集、initial model调用、strict output、no-match与安全失败；core tests只覆盖三参数policy调用、显式路由优先级、结果校验及既有timeout/failure boundary。
- context contract/engine tests覆盖resolver `RESOLVED | NOT_FOUND` schema、Agent override、selected-model match、string flow variables、cancellation与安全identity；SDK/router tests覆盖插件内置 default task、Agent override优先、空候选跳过resolver、selected model先于resolver、固定模型控制不被template options覆盖。
- integration tests通过现有 policy registry激活官方 plugin，断言显式路由仍先行且 Skill/Workflow进入既有下游决策字段。
- architecture tests确认 SDK/core不依赖context-engine实现package、app只做composition、公共resolver不暴露registry/compiler/loader或动态扩展逃逸面。

## 长期基线刷新计划

- stable specs：归档前同步 `agent-routing-core` 与 `agent-scoped-plugin-composition`。
- Functions：刷新 `FN-10.3 自定义路由策略`、`FN-10.2 装配插件`。
- Features：刷新 `F-10.2 装配插件`、`F-10.3 自定义路由策略` 与 `F-10.4 自定义工具与提示词`。
- overview：补充官方模型驱动 router plugin能力摘要。
- architecture：保持 `core-contracts.md` 的三参数 `AgentRoutingPolicyExecutable`，补充plugin独立执行与app composition ownership。
- modules：刷新 `agent-plugin-sdk`、`agent-context-engine`、`agent-app` composition；`agent-core`不新增router runtime owner。
- packaging architecture：刷新本地 runtime package 的官方插件 staging 清单与默认未激活边界。
- ADR：无。
- spec-to-design-map：补充官方 router plugin验证入口。

## 风险与取舍

- plugin API `1.2` runtime host 是 public contract expansion；已由发起者确认，必须以 contract tests 固定 closed shape，并回归 API `1.0|1.1` factory host 与三参数 policy。
- 直接传完整 Agent config会扩大插件权限并耦合装配结构，因此 API `1.2` 只提供六个具名 public runtime ports；官方 plugin 必须从 accepted `run/context` 和 assembly lookup 重新校验 scope，host 不提供 router-specific operations 或第二套 request context。
- RAG依赖预建 capability source索引；缺失或错误source产生no-match或安全失败，不在请求热路径建立第二套索引。
- 不改通用policy timeout helper避免把无关可靠性重构混入本change；request cancellation继续通过原`AbortSignal`传播到RAG和模型调用。
- artifact 随包可用不等于启用；保持 config 与 Agent policy 显式声明可避免发行包扩大默认路由行为。
