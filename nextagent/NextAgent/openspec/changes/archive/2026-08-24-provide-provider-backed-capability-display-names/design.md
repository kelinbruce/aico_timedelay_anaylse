## 设计范围

| Function | 目标变化 | delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.1 管理能力目录` | winner descriptor 统一 stable/本地化名称，提供无副作用 current view 与 Session-scoped 安全查询 | `capability-source-configuration` | `FN-5.1 管理能力目录` |
| `FN-3.2 编译智能体装配` | Agent package 名称进入 runtime-ready assembly 和 Agent descriptor | `agent-package-assembly` | `FN-3.2 编译智能体装配` |
| `FN-9.1 执行工作流` | Recipe stable/本地化名称进入 Workflow descriptor | `workflow-contracts` | `FN-9.1 执行工作流` |
| `FN-10.2 装配插件` | Plugin Tool authoring 输出统一 stable/本地化名称 | `agent-scoped-plugin-composition` | `FN-10.2 装配插件` |
| `FN-2.4 查看请求状态` | 三宿主按 Session 预取、刷新和解析 live/history Capability title | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |
| `FN-10.6 前端定制` | AICOConfig 退出 Capability 名称权威路径 | `aico-config-contract` | `FN-10.6 前端定制` |

主要 owner 是 `agent-capability` 的 descriptor 与 Catalog governance。Agent assembly、Workflow、Plugin SDK 只提供名称事实；`agent-runtime`/`agent-channel-web` 只暴露安全查询；`frontend/agent-web` 只拥有浏览器投影、语言选择与 Session-scoped last-good view state。Gateway、stream/history truth 和 request lifecycle owner 不改变。

## `FN-5.1 管理能力目录`

### 目标与规范依据

该 Function 统一承载 winner Capability 的 stable/本地化名称，并向已授权 Session 提供无副作用、完整、winner-only 的 current presentation projection。

#### 本 Function 的目标 Requirements

canonical spec：`capability-source-configuration`

- `ADDED`：`CapabilityDescriptor 提供统一本地化展示事实`
- `ADDED`：`Capability current view 只读取当前受治理事实`
- `ADDED`：`Session Capability 展示资源查询返回安全 current projection`

### 当前实现

- `agent-contracts/capability` 的 `CapabilityDescriptor` 与 closed runtime schema 已要求 stable `displayName`，没有统一 `locales`。
- Stable `displayName` 不是纯 UI 字段：Skill acquisition relevance、ToolSearch 和 Skill Catalog 已读取该字段。
- `CapabilityDiscovery` 只有 `listAll`、`resolve`、`search`；`CapabilityCatalog` 只有 `listAvailable`、`resolve`。
- `StaticCapabilityCatalog.listAvailable` 会调用 active SEARCH Provider。SkillHub `search` 会执行 remote synchronization，并可能 fetch/install package；local Skill `search` 会扫描 source root。
- EAGER Provider 在 app startup 经过 guard `listAll` 后保留已验证 descriptor 集合，可直接提供无 I/O current facts。
- SkillHub 已安装事实由 Provider-private installed index 与已安装 manifest 保存；installer 在目录 commit 后更新 index，再返回 acquisition success。
- `agent-channel-web` 已有 Session route 的 trusted pattern：`identityResolver` 形成 Owner Scope，`RuntimeSessionPort.requireSession` 校验 Session 并返回持久化 `session.agentId`。
- Runtime Bootstrap 是 Session 建立前的 public/channel-safe application config，不具备 Owner/Session/Agent Scope，且稳定契约不允许承载 deployment-private inventory。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| winner descriptor 是唯一名称权威 | 只有 stable `displayName`，各 source 映射不完整 | 缺统一 `locales`、source projection 与 validation |
| 读取当前静态/已安装 facts | 现有 SEARCH semantic 可以访问远端或产生写入 | 缺显式无副作用 current-read SPI |
| 复用既有 governance | Catalog 没有 current-view port | 缺同一 Catalog 实现上的窄 winner-only current view |
| Session 授权查询 | 没有 Capability presentation API | 缺 runtime query contract、safe DTO 和 Session route |
| 单资源失败不拖垮 current view | 内建 current reader 在单个资源读取、解析或校验失败时 throw | 缺 source 内部的逐资源隔离与安全诊断 |
| source 整体失败保持显式 | Catalog 已把 Provider throw 转为 current view unavailable | 需要保持 root/index/registry/locator、timeout、cancel 与非法返回的整体失败边界 |

### 修改方案

#### Descriptor 与 authoring contract

在 `agent-contracts/capability` 导出统一 closed schema/type：

```ts
interface LocalizedCapabilityContent {
  readonly displayName: string;
}

interface CapabilityLocales {
  readonly language: Readonly<Record<LocaleTag, LocalizedCapabilityContent>>;
}

interface CapabilityDescriptor {
  readonly displayName: string;
  readonly locales?: CapabilityLocales;
}
```

`locales` optional、非 `null`；存在时 `language` required 且 non-empty。Locale tag 复用 runtime 已有 2–35 ASCII BCP 47-compatible grammar。每个名称 trim 后为 1–256 Unicode code point且不含 control character；object closed，非法 descriptor 在 Provider boundary fail closed，不做局部字段删除。

Stable `displayName` 保持既有语义；本地化内容只影响 presentation。Catalog 先确定 winner，再原样保留 winner fields，不跨 candidates 合并。Tool source 的 optional stable `displayName` 会进入既有 stable-name consumers，这是统一权威名称的预期结果；identity 与模型调用名称仍是 Tool `name`。

仓库既有 `network-explorer` Agent 作为随产品交付的正向资产，直接在既有 authoring 文件中补充 `zh-CN/en-US` 名称；不改变 capability identity、stable `displayName`、description、binding 或执行行为。Skill 中英文、无 `locales`、stable name 与 id fallback 继续由独立测试 fixture 覆盖，避免为了测试而引入并非产品交付范围的 Skill 资产。

当前 change 不设置固定 locale 白名单或按语言数量截断。Provider/Catalog/Web 都不得静默截断资源；字符串边界、request cancellation/timeout 和完整失败语义形成当前安全边界。若平台后续定义统一 Web response byte budget，应由独立容量规格统一应用，不在本 change 发明局部条目数。

#### Provider current-read SPI

在 `agent-contracts/capability` 增加独立 criteria，避免给 `CapabilitySearchCriteria` 增加含义不同的 intent flag：

```ts
interface CapabilityCurrentDiscoveryCriteria {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId: SessionId;
  readonly agentId: AgentId;
  readonly agentVersion: AgentVersion;
  readonly agentAssemblyRef: string;
}

interface CapabilityDiscovery {
  listCurrent?(
    criteria: CapabilityCurrentDiscoveryCriteria,
    signal: AbortSignal,
  ): Promise<readonly CapabilityDescriptor[]>;
}
```

该方法继续 optional，并保持当前 descriptor 数组返回契约。Presentation current view 对 active SEARCH Provider 的 method absence 执行 fail-closed，不 fallback 到 `search`。`ProviderDiscoveryGuard` 继续执行 cancellation、timeout 与 descriptor 数组 schema validation，不能把 Provider throw、timeout、cancel 或非法返回转换为空成功结果。

内建 source 在 descriptor 形成前逐个处理当前资源。单个 manifest、file 或 assembly 的缺失、读取、解析、schema 校验或一致性失败只跳过该资源，并记录不含正文、metadata、内部路径、credential 或 token 的安全有界诊断；其他合法资源继续返回。未配置的 optional source、locator 明确返回 `not-found`，或 optional Skill root 读取明确返回 `ENOENT`，表示该 source 当前完整为空，不属于读取失败。已经配置并参与 current-read 的 root、registry、index、locator 或 source operation 除上述 `ENOENT` 外整体不可读、返回 invalid、timeout、cancel、throw，或者 Provider 返回非法 descriptor 数组时继续 throw。现有 Skill manifest parser、字段规则和 rejection reason 不变。

各生产 source 的唯一读取策略：

| Source | 单资源隔离 | source failure | 禁止行为 |
|---|---|---|---|
| EAGER Builtin/Plugin/CLIP 等 | 不接受；startup facts 必须完整 | startup facts 缺失或非法 | 不重新调用远端 describe/list |
| Agent-owned/local Skill | 单个 Skill manifest missing/read/parse/schema failure 跳过 | configured locator 返回 invalid/throw，或 root/readdir 非 `ENOENT` 整体失败；locator `not-found`、optional Skill root `ENOENT` 表示空 source | 不读取正文、脚本或其他 resource |
| runtime-generated Skill | 单个 Skill manifest missing/read/parse/schema failure 跳过 | configured locator throw，或 root/readdir 非 `ENOENT` 整体失败；locator `undefined`、optional Skill root `ENOENT` 表示空 source | 不 materialize、创建或删除临时目录 |
| local subagent | 单个 assembly 无法映射为合法 descriptor 时跳过 | configured registry/source operation throw；未配置 optional source 表示空 source | 不重新编译无关 Agent package |
| Workflow Recipe | 保持既有 loader 对单个非法 Recipe 的跳过语义 | index/root 整体失败 | 不执行 Workflow 或读取运行结果 |
| SkillHub | 单个 installed manifest missing/read/invalid/hash mismatch 跳过 | installed index 整体失败 | 不 remote sync、list、fetch、install 或更新 index |
| external SEARCH Provider | Provider 可以在自身边界隔离可归属于单项的失败 | missing method、throw、timeout、cancel、非法 descriptor 数组 | 不 fallback 到 `search` |

SEARCH Provider 当前没有可证明完整且无副作用的 reader 时，本次 presentation query safe unavailable。单资源诊断复用 source 既有安全 reason/evidence vocabulary，并只记录 code-owned event、Provider/source scope 和经过既有校验的资源 identity；不记录 manifest body、description、metadata、path、credential、token 或 adapter raw payload。Source failure 继续向上抛出；Capability presentation Web route 在自己的 catch boundary 记录带有 canonical `rawExceptionData` 的 local operational warning，并向 HTTP 返回既有 safe 503。其他复用 `withUnavailableFallback` 的 Web route 不在本次修改范围。

#### Catalog current view

新增窄 `CapabilityCurrentViewPort`，由现有 `StaticCapabilityCatalog` 实例实现；不修改现有 `CapabilityCatalog` interface，避免让 execution/context consumers 和测试 doubles承担 presentation-only method。

```ts
interface CapabilityCurrentViewRequest {
  readonly tenantId: TenantId;
  readonly subjectId: SubjectId;
  readonly sessionId: SessionId;
  readonly agentAssembly: AgentAssembly;
}

interface CapabilityCurrentViewPort {
  listCurrent(
    request: CapabilityCurrentViewRequest,
    signal: AbortSignal,
  ): Promise<readonly CapabilityDescriptor[]>;
}
```

实现复用 `StaticCapabilityCatalog` 的 binding、disabled、availability、priority、conflict resolver 与确定排序 helper。EAGER candidates 从 startup facts 取得，SEARCH candidates 仅来自 `listCurrent` 返回的合法 descriptors。结果不过滤 `modelInvocable`，以覆盖 Agent/Skill/Workflow wrapper targets；仍只返回当前 assembly 允许且 AVAILABLE 的 winners。

Catalog 继续按现有 default-enabled、SkillHub authorization、explicit binding、disabled-key、availability、Provider priority 与 conflict resolution 处理成功形成的 descriptors，不接收或推断失败资源事实。非法高优先级资源未形成 descriptor 时，合法低优先级同名资源可以按既有规则胜出；presentation current view 与 execution Catalog 因而对合法候选保持同一治理语义。

返回值仍是 winner descriptor 数组。失败资源不进入 `CapabilityCurrentViewPort`、runtime presentation DTO、Web response、模型披露或执行调用；其他合法 winners 正常返回。Source failure 仍 reject，浏览器保留 last-good。不得创建失败 DTO、第二个 Catalog、名称 registry、server snapshot、generation 或 server last-good cache。

#### Runtime query 与 Session Web route

在 `agent-contracts/runtime` 增加 presentation request/resource/result/port。Internal request 只含 trusted `identityContext`、`sessionId`、`agentId`；resource 只含 kind/id/stable name/locales；port 强制接收 `AbortSignal`。

`agent-core` 新增 `createCapabilityPresentationResourceQueryPort(...)`，通过 `AgentAssemblyRegistry.active(request.agentId)` 取得 current assembly，调用 `CapabilityCurrentViewPort`，投影 safe allowlist fields 并按 `kind/id` 排序。Adapter 不把失败捕获为 `resources: []`。

`agent-channel-web` 新增：

```http
GET /api/v1/sessions/:sessionId/capability-presentation-resources
```

Route 使用 closed empty query、既有 `sessionParams`、response schema 与 request cancellation。调用顺序固定为：形成 trusted identity → `requireSession(identityContext, sessionId)` → 从 Session 取 `agentId` → 调 runtime query port。浏览器不提交 locale、agentId 或 Provider selector；route 不读取 `x-agent-id` 或 default Agent fallback。

Response schema 只允许 `capabilityKind`、`capabilityId`、`displayName`、`locales`。Dependency unavailable/timeout/cancel/schema invalid 映射为不含内部细节的 safe failure。Runtime Bootstrap、Skill Catalog、SSE/WS/history API 不变。

#### Gateway 边界

本 change 不修改 `agent-contracts/gateway`、Record、binding、table 或 migration。Session route 复用既有 `RuntimeSessionPort → UserSessionService → SessionStoreGateway.loadSession` read，以校验 Owner Scope 并取得持久化 `session.agentId`；名称本身不进入 Gateway。SkillHub installed index 继续是 Provider-private durable fact。

#### 质量属性影响

本 change 不新增独立的系统质量属性 Requirement；下表只说明三个功能性 Requirements 的局部设计机制与验证关注点，不建立第二套黑盒质量目标。

三个 Requirements 形成以下局部质量机制，不新增平行黑盒目标：

| 属性 | 机制 | 验证关注点 |
|---|---|---|
| 安全 | trusted Session authority、closed schemas、winner-only safe DTO、纯文本边界 | client Agent override、loser/metadata/path/error leakage、invalid locale/content |
| 可靠性/恢复 | source 内单资源隔离、source fail-closed、abort、safe failure | 单资源不拖垮其他合法 winners；合法低优先级同名资源按既有规则胜出；source failure 不伪装空成功 |
| 性能/容量 | EAGER memory facts、frontmatter/index-only、一次完整 current read、不静默截断 | presentation query 不 remote sync/install/body read；大 source 可取消 |
| 可维护性/可测试性 | 一个 descriptor schema、同一 Catalog governance、独立窄 port | contract、Provider、Catalog、runtime adapter、route 与 architecture tests |

## `FN-3.2 编译智能体装配`

### 目标与规范依据

Agent package 提供 Agent descriptor 的 stable/本地化名称，不建立 package 之外的名称配置。

#### 本 Function 的目标 Requirements

canonical spec：`agent-package-assembly`

- `ADDED`：`Agent package 保留可选本地化展示名称`

### 当前实现

- `AgentDefinition` 与 closed parser 已支持 required `displayName`，没有 `locales`。
- Compiler 把 `AgentDefinition.displayName` 复制到 `AgentAssembly.displayName`。
- Agent discovery 从 `AgentAssembly` 生成 Agent descriptor，并使用 assembly stable name。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| Agent package author 提供本地化名称 | parser 与 Assembly 无 `locales` | 缺 source schema、assembly field 与 descriptor projection |
| 非法名称 fail closed | package compile 已 fail closed | 需要把统一 locale validation 接入既有 compile boundary |

### 修改方案

`AgentDefinition` parser 和 frozen `AgentAssembly` additive 增加同形 optional `locales`。Parser 复用 `agent-contracts/capability` exported schema，不复制 locale grammar；`agent-assembly` 保留结构等价的 source-owned type，避免反向依赖 capability contract。Compiler 逐值复制；Agent discovery 把 `AgentAssembly.displayName/locales` 逐值投影到 descriptor。

字段缺失不产生 warning、不影响 ready。非法 `locales` 使完整 Agent package compilation fail closed，不发布半成品 assembly。Name fields 不参与 assembly ref、selection、routing、model/prompt、binding、workspace policy 或 invocation。

## `FN-9.1 执行工作流`

### 目标与规范依据

Workflow descriptor 使用 Recipe 已有 stable `displayName` 和 optional 本地化名称，同时保持 `recipeName` 为唯一 execution identity。

#### 本 Function 的目标 Requirements

canonical spec：`workflow-contracts`

- `ADDED`：`RecipeDefinition 提供可选本地化展示名称`

### 当前实现

- `RecipeDefinitionSchema` 已有 required `displayName` 与 optional classification `lang`，没有 `locales`。
- `loadRecipeIndex` 能读取 Recipe，但 Workflow descriptor 当前把 `recipeName` 同时用作 id 和 stable display name。
- Workflow execution、routing、cache 和 lifecycle 使用 `recipeName`，不依赖 descriptor stable name。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| Recipe stable name 进入 descriptor | descriptor 使用 `recipeName` | Recipe index 需保留并投影 `displayName` |
| Recipe 提供 locales | schema/index 无字段 | 缺统一 validation 与 projection |

### 修改方案

`RecipeDefinitionSchema` additive 增加 optional `locales` 并复用统一 schema。`RecipeIndex` 保存 stable `displayName` 与 optional `locales`；descriptor 使用 `recipeName` 为 capabilityId、Recipe `displayName` 为 stable name，并复制 locales。

`lang` 继续作为分类字段，不生成 locale name、不覆盖 `locales`。非法 locales 随完整 Recipe 进入既有 invalid-skip path。Workflow graph、routing、execution、retry、timeout 和 event 不改。

## `FN-10.2 装配插件`

### 目标与规范依据

Plugin Tool authoring 可以提供 stable/本地化名称，并通过统一 descriptor 进入 Catalog governance。

#### 本 Function 的目标 Requirements

canonical spec：`agent-scoped-plugin-composition`

- `ADDED`：`Plugin Tool authoring 使用统一展示名称契约`

### 当前实现

- `ToolMetadata` 与 `DefineToolInput` 使用 canonical `name` 和 model-facing description/schema，没有独立 stable `displayName` 或 `locales`。
- Builtin Tool catalog 与 Plugin SDK mapper 都把 `metadata.name` 作为 descriptor id/stable name。
- Plugin API version 为 `1.0`，public authoring 与 closed validation 需要同步 additive fields。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| Tool 区分 identity 与 stable human name | `name` 同时承担两者 | 缺 optional `displayName` 与确定 fallback |
| Tool 提供 locales | authoring/SDK mapper 无字段 | 缺统一 schema 与保真 projection |

### 修改方案

`ToolMetadata`、`DefineToolInput` additive 增加 optional `displayName/locales`。`name` 继续是 Tool identity 和模型调用名称；descriptor stable name 使用 `displayName ?? name`。Builtin Tool catalog、Plugin SDK `defineToolProvider` mapper 与直接 descriptor Provider 都使用同一 public schema。

Plugin SDK 在 API version `1.0` 下 additive export optional fields，不要求既有 plugin 改动。非法 stable/localized names 在 provider assembly/descriptor boundary fail closed。Stable name 进入 ToolSearch 等现有 descriptor consumers，locales 不进入 model-facing description/schema、risk、sandbox、permission 或 audit。

CLIP 或其他 Provider 只有上游可信 fact 已提供符合统一 schema 的 locales 时才投影；本 change 不发明 adapter-private i18n protocol。

## `FN-2.4 查看请求状态`

### 目标与规范依据

Agent Web 使用 Session-scoped current presentation projection 和当前 UI locale 生成 live/history Capability title，并在静态主路径前置获取、动态长尾合并刷新、失败时保留 last-good。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `MODIFIED`：`Capability 过程标题必须使用最小公开身份生成`
- `MODIFIED`：`Agent Web 必须集中维护 Capability 业务名称映射`

### 当前实现

- Lifecycle 已公开 `capabilityKind + capabilityId` 和 optional `targetCapabilityId`；process/timeline builder 已有统一 title resolver。
- Resolver 仍按 platform key、AICOConfig lookup、frontend build-time integration map、id 的顺序选择名称。
- `TurnBlock` 同时构建 process/timeline projection，但 memo 只依赖 events/i18n translation；新增 resource snapshot 必须作为 reactive dependency。
- Conversation state 已按 Session 隔离 live、settled、history 和 delayed process history；local、immersive 与 collaborative 都复用 `ChatPageCore`。
- Stream hook 已有 live envelope observation，但 callback 可能发生在 store 接受 envelope 之前；acquisition refresh 必须以 accepted event 或 event id 去重。
- Browser 当前没有 Session-scoped presentation resource state、single-flight refresh 或 confirmed-missing semantics。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| 静态名称尽量早于 Capability event | event 后才可观察 identity | 需要 Session 创建/激活时并行预取完整 projection |
| 动态 Skill 最终更新 | 没有 resource invalidation | 需要 acquisition success 与 unknown identity triggers |
| 不逐调用查询 | 无 resolved/missing distinction | 需要 Session-scoped last-good、confirmed missing 与 single-flight |
| history/locale reactive | memo 不订阅 resource snapshot | 需要 immutable snapshot/version dependency |
| 跨 Session 正确性 | response 无 owner state | 需要 request Session capture 与 epoch guard |

### 修改方案

#### Shared browser owner

在 `frontend/agent-web` shared chat state/service 层新增唯一 presentation resource owner，三宿主不得各自加载。每个 Session 的私有最小 state：

```ts
interface SessionPresentationState {
  readonly resources: ReadonlyMap<string, CapabilityPresentationResource>;
  readonly confirmedMissing: ReadonlySet<string>;
  readonly inFlight: boolean;
  readonly dirty: boolean;
  readonly epoch: number;
  readonly nextRetryAt?: number;
}
```

这些字段是 design 私有表示，不进入 public runtime contract。`resources` entry 存在即 resolved；缺少 locales 仍 resolved。只有完整成功 projection 中缺少一个已观察 identity，才加入 confirmedMissing。Request failure 是 Session-level state，不是 per-identity missing。

#### 预取与刷新调度

创建 Session 成功取得 sessionId 时立即 fire-and-forget 预取，并与首次 submit/conversation bootstrap 并行；route/session activation 触发同一 coordinator。该查询不阻塞 event ingestion 或 render，因此极端时序下首次 title 可以先显示 id，response 到达后原位更新。

刷新触发只有三类：

1. Session 创建或激活；
2. 新接受且去重后的 live `acquire_skill` `SUCCEEDED` completion；
3. live/history/delayed process history 出现不在 resources/confirmedMissing 的合法 identity。

同 Session 单飞。In-flight 期间的 trigger 只置 dirty；current request settle 后至多执行一次 trailing refresh。Acquisition completion 按 accepted event 或 eventId 去重，SSE/WS replay 不重复刷新。Failure 使用 Session-level bounded cooldown；Session activation/acquisition success 可以重新尝试。不得按 Tool call、process entry、intersection observer 或 render 查询。

成功 response 经过完整 schema validation 后原子替换 resources；根据本次观察集合重算 confirmedMissing。失败保留 last-good 与原 confirmedMissing，不把缺失项升级为 missing。Response 写入使用发起时 sessionId + epoch；Session 被清理或 epoch 变化后丢弃迟到 response。

新 runtime-generated Skill identity 首次出现会触发一次 refresh。即使它没有 locales，只要 descriptor 返回 required stable name 即进入 resources，后续调用不再请求。同 identity 无信号原地替换无法由 unknown detector发现；当前 change 只在下次 Session activation或其他明确 trigger 后刷新，不增加 polling/generation/push。

#### Title projection 与 history

从 resources 派生 `${kind}:${id}` lookup；当前 locale选择顺序保持 spec 唯一规则。普通 Tool 使用自身 identity；Agent/Skill/Workflow wrapper 根据入口和 targetCapabilityId 推导目标 identity。Platform action/status/error/detail templates继续使用 frontend static i18n，名称只来自 resources/id。

Process 与 timeline builder 都接收纯 lookup；`TurnBlock` 订阅 immutable Session resource snapshot/version，并把它加入两个 memo dependencies。Title 变化不参与 React key，保持现有 correlation/tool-call key，从而原位更新且保留展开态。

History、live、settled 和 delayed process history 进入同一个 identity observation coordinator。Resource/locale 变化只重算 projection，不修改、复制或持久化 event。Skill Catalog 继续使用独立 `/api/v1/skills` query。

#### 质量属性影响

| 属性 | 机制 | 验证关注点 |
|---|---|---|
| 安全 | schema-validated plain text、Session isolation、safe fallback | markup literal render、A/B Session late response、invalid identity |
| 可靠性/恢复 | last-good、atomic replace、failure cooldown、epoch guard | failure不清空、dirty trailing、clear后late response |
| 性能/容量 | activation prefetch、single-flight、confirmed missing | no per-call/render query、no locales resource不重试、history/live dedupe |
| 可维护性/可测试性 | shared owner/resolver、纯 builder input | 三宿主同策、process/timeline/history一致 |

## `FN-10.6 前端定制`

### 目标与规范依据

AICOConfig 只承载前端外观、行为、布局和 PIU 定制，不再形成绕过 Provider/Catalog 的 Capability 名称 registry。

#### 本 Function 的目标 Requirements

canonical spec：`aico-config-contract`

- `MODIFIED`：`AICOConfig configuration type and field definitions`
- `MODIFIED`：`AICOConfig validation uses hand-written functions`
- `MODIFIED`：`AICOConfig default behavior when fields are absent`

### 当前实现

- Stable AICOConfig public type 已包含 optional `capabilityBusinessNames`、supporting types、手写逐项 validation 与 empty default。
- Local/immersive 从 sessionStorage 加载，collaborative 从 PIU payload 加载；validated config 进入同一 store。
- Capability title resolver 消费从 AICOConfig 派生的 current-locale lookup。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| Provider descriptor 是唯一名称权威 | AICOConfig 可覆盖名称 | 必须删除 field/types/validation/default/consumer |
| 其他 UI 定制兼容 | 同一 validator处理全部 fields | 删除必须是外科手术式，不改变其他字段和三宿主注入 |

### 修改方案

从 AICOConfig public type、validated output 和 default behavior 删除 `capabilityBusinessNames`，并删除只服务该字段的 supporting types/helper。Unknown input key 按既有 unknown-field policy 静默忽略，不影响同 payload 其他合法 UI config。

三宿主注入、完整替换和页面生命周期不变。Capability title 不再从 AICOConfig 或 frontend build-time product mapping读取名称；只使用 Session presentation resources/id。Platform wrapper/action/status i18n 不属于 Capability name facts，继续保留。

## 跨 Function 协作与端到端流程

1. Agent、Workflow、Skill 与 Tool source 在各自既有 validation boundary 形成 stable/localized facts。
2. Provider 把合法事实映射为统一 `CapabilityDescriptor`；EAGER source进入 startup set，SEARCH source通过无副作用 `listCurrent` 返回合法 descriptor 数组并在 source 内跳过单个失败资源。
3. Session presentation route 校验 Owner Scope并取得 trusted session-bound agentId。
4. Runtime adapter取得 current assembly；同一 Catalog instance通过 `CapabilityCurrentViewPort`读取合法 descriptors，并执行既有 governance。
5. Web只返回 winner kind/id/stable name/locales。
6. Agent Web在Session创建/激活时预取，按Session原子保存last-good；live/history依据当前locale解析标题。
7. Skill acquisition commit完成并产生accepted success event后，或首次出现未知identity时，shared coordinator执行同一完整刷新。
8. 查询失败时execution/event/history继续，浏览器保留last-good或按id降级。

名称数据 owner 始终是 winner descriptor；Session 只提供授权查询 scope，浏览器 state 只提供可丢失的 view projection。没有 server snapshot、Gateway persistence、event name field、临时 locale file 或第二名称 registry。

## 验证策略

- Contract/schema：验证 descriptor locales、authoring source fields、runtime query DTO、closed input/output、invalid locale/content fail closed。
- Provider/Catalog：验证 EAGER memory、local frontmatter、runtime-generated scope、local subagent、Workflow index、SkillHub installed-only 和 external SEARCH Provider；覆盖单资源隔离、disabled/binding、既有同名 winner 规则、非法 descriptor 数组与 source failure，并实际证明 presentation path 不调用 remote sync/search/install/body read/write。
- Runtime/Web：验证requireSession authority、session-bound agentId、winner-only safe DTO、失败资源不泄露、no locale/client agent override、abort、source failure safe 503 与 local operational warning。
- Frontend unit/integration：验证fallback、plain text、activation prefetch、accepted acquisition refresh、unknown/confirmed-missing、single-flight/dirty/epoch、last-good、locale/history reactive update和entry key稳定。
- 三宿主/浏览器：验证local、immersive、collaborative共享实现；中英文、静态Builtin/Plugin/Agent/Skill/Workflow、installed Skill和runtime-generated Skill user journeys。
- Non-regression：验证ToolSearch/Skill Catalog stable displayName语义、Catalog/Resolve/search、Skill acquisition、Runtime Bootstrap、event/history/SSE/WS、result disclosure、AICOConfig其他fields与Gateway不变。

## 长期基线刷新计划

归档前由 archive design sync 执行，不作为实施阶段 task：

- Stable specs：更新本 change 六个同名 stable specs。
- Functions：刷新 `FN-5.1`、`FN-3.2`、`FN-9.1`、`FN-10.2`、`FN-2.4`、`FN-10.6` 的输入、输出、处理过程、结果、接口和必要规格摘要。
- Features：刷新 `F-2.4 查看请求状态`；其他 Feature 无用户价值组成变化。
- Overview：提炼 Provider-backed Capability presentation name 的用户问题与范围。
- Architecture：刷新 `core-contracts.md`、Capability SPI/Catalog、Web channel/frontend projection 相关设计。
- Modules：刷新 `agent-capability`、`agent-channel-web`、`agent-core`/runtime adapter、`frontend/agent-web`、Agent assembly、Workflow、Plugin SDK 模块设计。
- ADR：无新增 ADR；当前取舍可由 architecture/design 充分承载。
- Spec-to-design map：增加六个 stable specs 到相关 architecture/modules/tests 的导航。

## 并行与实施门禁

- Production code 开始前必须完成 proposal“需群内确认”的 frozen contract 记录。
- 与其他修改 `CapabilityDescriptor`、`CapabilityDiscovery`、`AgentAssembly`、`RecipeDefinition`、Plugin SDK、`ts-run-status-visibility`、`TurnBlock/processDetails` 或 AICOConfig 的 active change 协调写入窗口。
- 本 change 不改 Gateway、stream event、Runtime Bootstrap 或 Provider registry lifecycle；若实施发现必须修改这些 frozen boundaries，应停止并提交 contract refinement，不得在代码中扩 scope。

## 风险与取舍

- Current presentation query 会读取当前本地资源的 bounded frontmatter 或 installed index；大规模 source 的读取成本通过 Session 级预取与 single-flight、source 的只读最小数据面以及贯穿的 cancellation 约束，不引入轮询、远端同步或 server snapshot。
- 单资源失败被隔离后不会出现在 projection、模型披露或执行路径；定位信息只进入安全、有界的 source diagnostic。取舍是异常资源不会通过 presentation API 暴露，运维侧依赖本地诊断和 Issue 跟踪修复该资源。

## 待确认问题

无。Proposal“需群内确认”中的 frozen contract 与 compatibility 边界已于 2026-08-12 确认；本次鲁棒性修复不新增或重新定义 `agent-contracts`。
