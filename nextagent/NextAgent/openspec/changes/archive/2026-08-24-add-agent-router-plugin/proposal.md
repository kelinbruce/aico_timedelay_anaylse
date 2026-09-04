## Why

Agent 开发者已经可以激活自定义 `agentRoutingPolicy`，但系统尚未提供一个可直接使用的模型驱动路由插件。现有 plugin factory host 只提供构建期 external 与开发诊断能力，插件无法通过宿主提供的公共 runtime services 读取当前 Agent assembly、使用受治理 Capability、选择当前 Agent 模型或解析 prompt template。若系统在 policy 调用边界代替插件完成这些选择，插件就只剩配置转发职责，无法作为可独立实现的 routing policy 使用。

系统需要提供 `agent-router-plugin`：显式路由没有先行决定处理路径时，插件通过宿主注入的公共 runtime services 独立完成当前 Agent 候选解析、optional RAG Tool 调用、prompt 解析和模型终选。既有 policy 调用方只按兼容输入调用 policy 并消费 `AgentRoutingPolicyResult`，不为该插件增加专用选择能力。

## 目标与非目标

**目标：**

- 提供可按既有插件机制加载和按 Agent 激活的 `agent-router-plugin`。
- 路由候选只来自 accepted Agent assembly 中 enabled 且类型为 `SKILL` 或 `WORKFLOW` 的显式 binding，并同时通过当前 Owner Scope 与 Agent Scope 的可用性治理。
- 使用当前 Agent 初始模型对 accepted user input 与候选描述做一次有界选择，结果只能是一个 Skill、一个 Workflow 或 no-match。
- `selectionMode` 支持 `SKILL`、`WORKFLOW`、`SKILL_OR_WORKFLOW`，默认 `SKILL_OR_WORKFLOW`。
- `ragPrefilter` 为可选配置；未配置时跳过 RAG，配置且候选数超过 `topK` 时，通过当前 Agent 已绑定的 builtin `Rag` 预筛后再由模型终选；`topK` 默认 5、范围 1–10。
- Skill、Workflow 和 no-match 继续进入既有受治理下游路径；依赖失败、非法输出或越界选择安全拒绝。
- 保持既有 `AgentRoutingPolicyExecutable.decide(run, context, signal)` 三参数 contract 不变；插件在创建时捕获宿主注入的 runtime services，执行时使用 accepted `run/context` 构造受治理请求。
- 将 plugin API 提升到 `1.2`，通过 factory host 增加 closed `runtime` services；后续能力通过新的 plugin API version 和具名 service 扩展，不提供 `extensions`、index signature 或动态 service lookup。
- 本地 runtime 的 backend-capable 发行包默认携带可直接配置的官方 router plugin artifact，使 operator 无需另行生成插件文件即可显式启用。
- 将 Context Engine 既有 prompt template assembly 能力提升为唯一、实现无关的 `PromptTemplateResolverPort`，供 router 与其它 model-facing consumer 通过 public context contract 复用。
- 默认终选提示词由 `agent-router-plugin` 代码内置；Context Engine 只解析 Agent-scoped override template，不注册或持有该插件的默认提示词。

**非目标：**

- 不改变 `$skill:`、`$workflow:`、trusted target 或 `routing.mode=policy` 显式路由的既有优先级。
- 不把 raw Agent definition、credential、provider route、workspace、gateway implementation 或其它私有 composition 对象交给插件。
- 不让客户端、模型输出、Capability 参数或插件配置提供或覆盖 Agent Scope、Owner Scope、候选 binding 或模型身份。
- 不把 default-visible、搜索发现但未显式绑定的 Skill 或 Workflow 纳入候选。
- 不新增 routing decision kind，不实现多选、boot-recipe 路由、`CLARIFY` 或 `HUMAN_HANDOFF` 翻译。
- 不修改模型 fallback、RAG provider 或索引治理边界，不在 routing policy 调用时增加 Tool、Prompt 或模型服务专用第四参数。
- 不修改通用 plugin timeout helper；policy timeout 的既有 failure boundary 保持不变。
- 不预埋 service inventory、占位方法、`extensions`、index signature 或 `execute(operation, payload)`。
- 不因随包携带 artifact 而向 package config sample 注入该插件，也不修改默认 Agent policy activation。
- 不向公共 contract 暴露 prompt registry、compiler、template source、文件路径、模型候选或 runtime `RequestContext`，也不新增 router 专用 template loader/resolver。
- 不为 plugin default task 新增 Context Engine builtin template、plugin prompt contribution 注册机制或 request-time file loading。

## What Changes

- 提供具有稳定 plugin/policy 标识、严格配置契约和自包含交付 artifact 的官方 `agent-router-plugin`。
- 保持既有 routing policy 的 accepted request、request context 与 cancellation 输入兼容；router 不增加调用时专用第四参数。
- plugin API `1.2` factory host 增加封闭的受治理 runtime service 集合，使插件可使用当前 Agent 装配、Capability、模型与 Prompt Template 公共能力。
- 增加三种候选类型模式、optional RAG 预筛、严格候选成员校验、模型输出校验与安全失败行为。
- backend-capable 本地 runtime 包默认携带官方 artifact，但 package config sample 与默认 Agent 不加载或激活该 policy。
- Prompt Template 公共契约增加唯一 resolver 与显式 `RESOLVED | NOT_FOUND` 结果，router 使用 purpose `AGENT_ROUTING_SELECTION` 读取 Agent override；无匹配模板时使用插件自有默认提示词。

## Feature 影响

### 修改的 Feature

- `F-10.2 装配插件`
  - 插件开发者可使用 plugin API `1.2` 的封闭 runtime service host，运维人员可直接引用随本地 runtime 包交付且默认未激活的官方 router artifact。

- `F-10.3 自定义路由策略`
  - Agent 开发者可以直接部署并激活受治理的模型驱动 `agent-router-plugin`，并按 Agent 配置候选类型与 optional RAG 预筛。
  - 用户可依赖模型只从当前 Agent 显式绑定且当前请求可用的 Skill/Workflow 中选择。

- `F-10.4 自定义工具与提示词`
  - 其它 model-facing consumer 可通过唯一 Prompt Template resolver 使用同一 Agent-scoped template 选择与渲染能力，并显式区分已解析与无匹配模板。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.3 自定义路由策略` → canonical spec `agent-routing-core`
  - 变化边界：增加模型驱动 plugin policy；候选固定为当前 Agent enabled Skill/Workflow bindings 与当前请求治理可用集合的交集，支持配置过滤与 optional RAG 预筛，输出复用既有 `AgentRoutingDecision`。
  - 系统质量属性：安全。

- `FN-10.2 装配插件` → canonical spec `agent-scoped-plugin-composition`
  - 变化边界：plugin API `1.2` factory host 增加 closed runtime services，提供官方 plugin artifact，并让 backend-capable 本地 runtime 包默认携带该 artifact；既有三参数 policy 与显式激活行为不变。
  - 系统质量属性：无新增。

- `FN-10.4 自定义工具和提示词` → canonical spec `prompt-template-assembly`
  - 变化边界：公开唯一、实现无关的 prompt template resolver contract，新增 framework well-known purpose `AGENT_ROUTING_SELECTION`，允许 router 与其它受治理 model-facing consumer 复用同一选择和渲染边界。
  - 系统质量属性：可维护性。

## 影响范围

- **Agent 开发者**：在 trusted system plugin config 中加载插件，并在 Agent `policies` 中以 `pluginId=agent-router-plugin`、`policyId=agent-router-plugin.auto-routing` 激活；通过 `policies.config` 设置 `selectionMode` 与 optional `ragPrefilter`。
- **公共插件契约**：既有 routing policy executable 输入与 result shape 保持兼容；plugin API `1.2` 增加 closed runtime services。该 public plugin host expansion 已由本 change 发起者于 2026-08-11 明确确认。
- **RAG Capability**：复用 builtin `Rag` 的 query/indexes/topK、scope、结果与失败契约；未配置 `ragPrefilter` 时不依赖 RAG。
- **配置**：不新增系统级字段；复用 `plugins[]`、Agent `policies.config` 和 `capabilityBindings`；默认 package config sample 不声明或激活 `agent-router-plugin`。
- **Prompt Template 公共契约**：增加 `PromptTemplateResolverPort`，result 以 `RESOLVED | NOT_FOUND` 显式表达是否存在匹配模板；该 public contract expansion、唯一 resolver 边界以及插件默认提示词 ownership 已由本 change 发起者于 2026-08-11 明确确认。
