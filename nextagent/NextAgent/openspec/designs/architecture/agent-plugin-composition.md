# Agent Plugin Composition

本设计是 Agent-scoped startup plugin composition 的长期架构入口。它说明本地 TypeScript 插件如何作为受信启动期扩展进入系统，并把 capability provider、routing policy 和 lifecycle hook 分别交给现有 owner 路径处理。行为性 SHALL 由 `openspec/specs/agent-scoped-plugin-composition/spec.md` 承载；本文件承载维护者理解和修改该机制所需的跨模块设计。

## Design Goal

插件机制提供给智能体二次开发者一个受控的本地 TypeScript 扩展入口，同时保持 NextAgent 既有边界：

- 插件代码只在 `agent-app` trusted startup composition 阶段加载，不在 request path 动态加载。
- 插件加载只证明代码 artifact 被接收，不授予任何 Agent 执行权限。
- Tool 仍走 `agent-capability` capability governance 和 `CapabilityInvocationPort`。
- Routing policy 仍由 `agent-core` 在 Agent 内部 routing boundary 执行。
- Lifecycle hook 仍走 startup hook registry、`AgentAssembly.hooks` activation 和 `agent-runtime` hook executor。
- Agent scope 由 accepted `agentId`、`agentVersion`、`agentAssemblyRef` 决定；插件不能从 request body、model output 或 capability args 覆盖 Agent scope。

## Non-goals

当前插件机制不是动态插件系统。长期禁止项包括 runtime hot loading、watch reload、remote marketplace、URL/package 下载、zip/archive install、插件私有 `node_modules` runtime resolution、`agent-app` 执行插件依赖安装、非 TypeScript runtime、Agent package 携带可执行插件代码、SkillHub package 携带插件代码、request/model/client metadata 触发插件加载、未知 policy point、自定义 script policy、hook executor replacement 和绕过 capability governance 的 Tool execution。

## Artifact And Loading

插件通过 system config `nextAgent.system.plugins[]` 显式声明。每个条目指向 frozen `configRoot` 下的相对插件目录，最多 8 个。插件目录必须包含 `plugin.json` 和 `plugin.json.main` 指向的单文件 `.js` ESM bundle。

`plugin.json` 的长期字段语义：

- `pluginId`：safe id，必须与 system config 和插件 export 一致。
- `version`：插件作者发布版本，只用于 safe diagnostics、registry snapshot 和 activation refs，不参与 host API contract 选择。
- `apiVersion`：NextAgent plugin API contract version，major/minor 字符串；当前支持 `"1.0"`、`"1.1"`、`"1.2"`。API `1.1` 增加 developer diagnostics；API `1.2` factory host 增加 closed `runtime` services（六个具名 public ports，无 `extensions`、index signature 或动态 lookup）。后续新增 host service 必须 OpenSpec 先行并升级 plugin API version。
- `main`：插件目录内的相对 `.js` single-file ESM bundle，不允许 URL、绝对路径、parent traversal、glob、shell expression、目录或 multi-file entry。
- `artifactType`：当前只允许 `esm-bundle`。
- `hostExternals`：可选；只允许声明 host external inventory 中的 id 和版本范围。

`agent-app` plugin loader 的稳定流程：

1. 校验 system config plugin list 上限、plugin id 和 path。
2. 将 path 解析到 `configRoot` 下并做 containment。
3. 读取并校验 `plugin.json`。
4. 校验 API version、artifact type、main bundle path 和 host external declaration。
5. 静态扫描 main bundle，拒绝 static import、`export ... from` 和 string-literal dynamic `import(...)` runtime specifier。
6. dynamic import single-file ESM bundle。
7. 对 default export 执行 plain plugin 或 factory materialization。
8. 校验 provider/policy/hook contribution shape。
9. 冻结 plugin registry snapshot。

Host external 是 factory injection，不是 Node module resolution。当前 host external inventory 只开放 `typebox` 和 `ajv`。使用 host external 的插件 default export 必须是 factory，host object 初始只包含 `{ externals }`。loader 不注入 logger、gateway、filesystem、workspace root、credential、raw config、owner scope 或 Agent scope。

如果 `plugin.json.apiVersion` 缺省，loader 先读取 plugin export `apiVersion`，再回退到当前 host latest supported version。显式 unsupported API version 必须在接受 provider/policy/hook contribution 前 fail closed。Root `definePlugin(...)` 当前写入固定 `"1.0"`，不得随未来 host latest 漂移。

插件目录可能包含与 `plugin.json`、`index.js` 同级的 companion 文件（例如 `developer-hook-trace-viewer.html` 离线查看器资产）。plugin loader 只读取 manifest 和 `main` 指向的 single-file ESM bundle，不读取、不加载、不执行同级任意 HTML 或其他 companion 文件。companion 文件不是插件 contribution，不因与插件同目录而获得运行时权限、host API 访问或 capability governance 参与。companion 文件由打包 composition（`scripts/pack-local-runtime.mjs`）从 repo asset 路径复制到目标插件目录，是运行时插件文件与 companion 文件发生组合的唯一位置；不增加资产发现或第二个插件生成器。查看器资产的自包含安全约束（内联 CSS/JS、CSP 禁止外部资源、无持久存储、`textContent` 呈现）由资产自身承载，不进入插件 manifest schema 或 host externals。

## Registry And Activation

Plugin registry snapshot 是启动期加载事实，不是授权事实。它包含 safe plugin metadata 和已校验的 provider/policy/hook contribution。

Agent activation 分三条路径：

- `AgentAssembly.capabilityBindings` 决定 plugin provider 下 Tool 是否对 accepted Agent 可见、可搜索、可 resolve、可 invoke。
- `AgentAssembly.policies` 决定 accepted Agent 是否激活某个开放 policy implementation。
- `AgentAssembly.hooks` 决定 accepted Agent 是否激活 lifecycle hook，以及 stage narrowing、配置、timeout 和 order。

`agent-app` 的 Agent definition compiler 负责把 Agent `policies` 编译成 implementation-free `AgentAssembly.policies` facts：`policyPointId`、`pluginId`、`policyId`、`enabled`、可选 `timeoutMs` 和 validated `config`。Policy executable、closure、module path、plugin path、registry handle 和 raw config 都不得进入 `AgentAssembly`。

缺失 plugin/provider/policy/hook、reserved 或 unknown policy point、duplicate enabled policy point、invalid config、unsupported hook stage/order、provider id 冲突或 contribution shape 非法，必须在 startup、Agent assembly compilation 或 registry materialization 阶段 fail closed。运行期不保留第三种 `UNAVAILABLE` activation 状态。

## Capability Provider Flow

插件 provider 是标准 runtime `CapabilityProvider { identity, discovery, executor? }`。首版 plugin provider 必须是 `providerKind=CUSTOM` 且 `providerType=nextagent-plugin-tool`，只允许贡献 `TOOL` descriptors，每个插件最多 4 个 provider。

Provider id 必须由插件作者显式声明，`agent-app` 不从 `pluginId` 派生 provider id。Provider id 不得复用 framework reserved providers、owner providers、SkillHub providers、system/local Agent providers 或其它 plugin providers。

`agent-capability` 是 plugin provider governance owner。Plugin providers 与 internal owner providers、external owner providers、config-driven providers 使用同一 assembly、validation、catalog 和 invocation path。`agent-capability` 必须校验 provider/discovery identity、descriptor schema、descriptor provider/kind/type consistency、duplicate capability id、required dependencies、config override、discovery result、executor lookup 和 output envelope。

EAGER plugin discovery 在 startup/readiness 阶段提供 descriptors。SEARCH plugin discovery 在 request-scope catalog query/resolve 时按 trusted criteria 延迟调用；criteria 只包含 safe owner/request context、`agentId`、`agentVersion`、`agentAssemblyRef` 和 requested capability narrowing。SEARCH discovery 必须包 timeout、cancellation、safe error mapping、diagnostic 和 result validation。

Plugin Tool visibility 不由 plugin registry membership 决定。没有 matching enabled `AgentAssembly.capabilityBindings` 或 provider/condition selector 时，plugin Tool 不得被搜索、列出、resolve 或 invoke。Provider/condition selector 只能授权 SEARCH provider 被调用；返回 descriptors 仍必须经过 exact disabled binding、availability/model visibility、conflict resolution 和 invocation eligibility。

现有 provider 行为保持不变：builtin Tool、builtin/system/Agent-owned Skill 和 parent subagent 的 default exposure 仍由 finite framework-owned allowlist 控制；top-level Agent capability 仍需显式 binding；`memory-tools` 仍由 memory exposure gate、AgentAssembly binding 和 frozen memory config 共同决定；SkillHub 仍是 provider authorization controls search，再对返回 Skill descriptors 应用 readiness、conflict、availability/model visibility 和 exact disabled binding filtering。

## Policy Flow

Policy registry/resolver 由 `agent-runtime` 实现，但只作为不同 policy shape 的容器和查询机制。它不执行 routing、model selection、context selection 或 restricted-operation 判断。

开放 policy inventory 当前为：

```text
agentRoutingPolicy        OPEN      owner: agent-core
restrictedOperationPolicy RESERVED  owner: agent-runtime
modelSelectionPolicy      RESERVED  owner: agent-core/agent-model
modelFallbackPolicy       RESERVED  owner: agent-model
contextWindowPolicy       RESERVED  owner: agent-context-engine
```

当前闭合 policy 示例包括 `redactionPolicy`、`promptAssemblyPolicy`、`capabilityConflictResolutionPolicy`、`observabilityProjectionPolicy`、`authorizationAnswerPolicy` 和 `gatewayRetryPolicy`。

Policy materialization 发生在 startup/assembly 阶段。App composition 提供已校验的 plugin policy contribution；Agent assembly compiler 提供 `AgentAssembly.policies` activation facts；runtime policy registry 将 default executable 或 `configure(config)` 产出的 assembly-specific executable 绑定到 `agentAssemblyRef + policyPointId + pluginId + policyId`。

Resolver 查询输入是 accepted Agent scope facts 和 `policyPointId`。Resolver 必须验证 `agentId`、`agentVersion`、`agentAssemblyRef` 与冻结 assembly 一致。运行态查询只有两个结果：resolved executable 或 undefined。undefined 表示 accepted Agent 未激活该 policy point，调用方使用自身默认逻辑。

`agent-core` 是 `agentRoutingPolicy` owner。Core routing adapter 先调用 resolver；若 accepted Agent 未激活 `agentRoutingPolicy`，执行内置 default routing policy；若解析到 executable，直接执行插件 policy，不先执行内置 policy。插件 routing policy 使用既有 contract：`decide(RequestRun, RequestContext, AbortSignal)`，返回与 `AgentRoutingDecision` 对齐的结果。Adapter 不在 wrapper 中对 `RequestRun` / `RequestContext` 做 summary、redaction、truncation 或字段投影；`acceptedInputText` 语义与内置 routing policy 相同。

官方 `agent-router-plugin`（`pluginId=agent-router-plugin`、`policyId=agent-router-plugin.auto-routing`）是可按该机制加载的模型驱动路由插件：显式路由未先行决定时，插件通过 plugin API `1.2` factory host 注入的 closed runtime services（`AgentAssemblyRegistry`、`CapabilityCatalog`、`CapabilityInvocationPort`、`ModelSelectionService`、`ModelInvocationService`、`PromptTemplateResolverPort` 六个 public ports）独立完成当前 Agent 候选解析、optional builtin `Rag` 预筛、prompt 解析和模型终选；候选固定为当前 Agent enabled 显式 Skill/Workflow bindings 与当前请求治理可用能力的交集，结果只能是一个 Skill、一个 Workflow 或 no-match，依赖失败安全拒绝。默认终选提示词由插件代码内置（immutable `defaultSelectionTask`），Context Engine 只解析 Agent-scoped override template（framework well-known purpose `AGENT_ROUTING_SELECTION`），不注册或持有插件默认提示词。`agent-app` 在 plugin preload 前创建 deferred runtime services host，在 assembly、capability、model 与 prompt composition 完成后一次性绑定六个 targets；未绑定调用与重复绑定 fail closed。该 deferred binding 只解决启动拓扑，不拥有路由语义。

Plugin policy throw、timeout、abort 或 invalid result 必须在 routing business boundary fail closed to safe routing rejection。Invalid activation、missing executable、duplicate activation、reserved point、unknown point 和 invalid config 不应到达 core runtime path。

## Hook Flow

插件 hook 是由 `defineLifecycleHook(...)` 创建的 `LifecycleHook` object。`agent-app` 在 startup composition 中校验 hook object，并把它作为 already-composed startup hook registry input。

是否启用 hook、启用哪些 stage、如何配置、如何排序、timeout 如何解析，仍由 Agent `hooks` 编译到 `AgentAssembly.hooks` 决定。Runtime hook executor 按 accepted run 固化的 hook activation snapshot 执行，复用 lifecycle hook execution 的 stage vocabulary、effects-derived execution strategy、outcome、mutation、failure mode、pending handoff、order validation 和 recovery semantics。

插件 hook 不能定义不在 `LifecycleStage` vocabulary 中的 stage，也不能绕过 startup hook registry 或替换 runtime hook executor。

## SDK And Scaffold

`@nextagent/agent-plugin-sdk` 是插件作者的 authoring package，不是 runtime loader。Root SDK 只依赖 public `agent-contracts` subpaths 和必要的 schema helper，不依赖 `agent-app`、`agent-runtime`、`agent-core`、`agent-capability`、gateway、filesystem、shell 或 network。

主要 helper：

- `definePlugin(plugin)`：默认 authoring path，返回 materialized plugin object。
- `definePluginFactory(factory)`：host external path，factory receives `{ externals }` and returns plugin object。
- `defineCapabilityProvider(provider)`：高级 provider path，输出 public `CapabilityProvider`。
- `defineTool(input)`：单 Tool 糖，返回 `ToolDefinition`。
- `defineToolProvider(input)`：标准 Tool provider 糖，把 `ToolDefinition[]` 包装成 `CapabilityProvider`。
- `defineAgentRoutingPolicy(policy)`：当前唯一 OPEN policy helper。
- `defineLifecycleHook(hook)`：输出 `LifecycleHook` object。
- `getPluginMetadata(plugin)`：读取 materialized plugin object 的 safe metadata，用于 authoring/test。

`getPluginMetadata(...)` 不读取 `plugin.json`，不 dynamic import，不校验 host external version，不冻结 registry，不编译 Agent activation，也不能证明生产可加载。

`@nextagent/agent-plugin-sdk/scaffold` 和 CLI `create-nextagent-plugin <plugin-directory>` 是 dev-only surface。Scaffold 可以使用 filesystem 写模板，但不得被 product runtime package 导入。生成项目包含 `package.json`、`tsconfig.json`、`esbuild.config.ts`、`src/index.ts`、`plugin.json`、`tests/plugin.test.ts` 和 README；默认使用 `definePlugin(...)`，bundle 输出为 single-file ESM + inline sourcemap，默认直接 bundle dependencies。生成物不创建 system config、Agent bindings、policy activation、hook activation 或 runtime registry facts。

## Test Harness

`@nextagent/agent-test-kit` 提供 `createPluginTestHarness(plugin, options?)`，用于插件作者直接测试已导入的 plugin object。Harness 支持：

- `invokeTool(providerId, capabilityId, input)`
- `evaluateAgentRoutingPolicy(policyId, run, context)`
- `executeHook(hookId, input)`

Harness 不读取 system config、`plugin.json`、插件目录、bundle、host `node_modules`、raw Agent config、gateway records 或 local filesystem paths；不 dynamic import；不执行 static scan；不校验 host external version；不计算 app readiness；不编译 Agent assembly；不冻结 plugin registry。

Harness passing 只证明 plugin object 逻辑可被 public contract 直接调用，不证明插件可生产加载、manifest 合法、bundle 合法、Agent 已激活或主路径 governance 正确。产品有效性仍由 app loader、manifest/static scan、Agent activation、capability integration、policy adapter 和 hook registry tests 覆盖。

## Diagnostics

插件相关 diagnostic 只允许携带稳定低基数字段：`pluginId`、`providerId`、`capabilityId`、`policyPointId`、`policyId`、`hookId`、`agentId`、`agentVersion`、`agentAssemblyRef`、reason code、bounded safe summary 和 low-cardinality outcome。

Diagnostic、safe error、stream、structured log、audit、metric label 和 trace attribute 不得包含 host path、raw config、secret、credential、prompt、model output、tool arguments、tool result、raw provider response、stack trace 或高基数字段。

## Developer Diagnostic Artifact Host Service

Developer diagnostic artifact host service 是 deployment-agnostic composition 能力：`agent-app` 统一 Plugin host composition 在同步和异步路径上都默认创建 developer diagnostic artifact writer，不读取 `deployment.mode` 决定能力启用。调用方显式提供的 `developerDiagnosticArtifactWriterFactory` 优先（测试和定制宿主的 override seam），否则默认使用 `agent-log` 的 `createDeveloperDiagnosticArtifactWriter`；两条路径都只传入冻结后的 `paths.logDirectory`。

该能力不新增 port/DTO/契约语义，也不让 `agent-app` 依赖 gateway implementation。`agent-log` 是 developer diagnostic artifact 物理 writer 的唯一 owner，已依赖 `agent-local-file-roll`，owner 迁移不形成新依赖方向或新增 file-roll production consumer。物理产物为 `paths.logDirectory` 下的 `nextagent-plugin-diagnostic` 前缀 NDJSON 文件族（`schemaVersion=1`），容量边界沿用 stable spec：active segment 30 MiB 轮转、`.gz.tmp→.gz` 原子提交、closed 保留 3 elapsed days、最多 10 个 committed gzip archive、单条记录 4 MiB 上限。writer 创建独立 `agent-local-file-roll` handle，不与 operational writer 共享 destination、buffer、maintenance state 或 lifecycle。

部署专用产品入口（LOCAL entrypoint、REMOTE entrypoint）不感知也不启用该能力，不导入、不注入 developer diagnostic writer。`agent-platform-gateway-local` 不再拥有该 writer 实现/export/testing/LOCAL entrypoint 注入；`agent-remote-deployment` 不再 import 或在 REMOTE 入口注入该 writer。通过 `agent-app` composition 启动的宿主即使未提供 factory 也获得默认可写 sink；直接绕过 app composition 调用 plugin loader 的隔离测试仍可验证 noop sink。REMOTE 部署会在本机日志目录新增包含潜在敏感调测内容的文件，通过保持插件显式激活、专属文件族、访问控制和短期保留降低风险。

## Ownership Map

- `agent-app`：system config plugin list、manifest/bundle loader、host external injection、plugin registry snapshot、Agent activation compiler、composition wiring。
- `agent-plugin-sdk`：authoring helper、public type re-export、scaffold dev-only entrypoint。
- `agent-capability`：plugin provider validation/wrapping、catalog governance、Tool invocation path。
- `agent-runtime`：policy registry/resolver implementation、lifecycle hook executor、accepted Agent scope enforcement。
- `agent-core`：`agentRoutingPolicy` typed adapter、default routing fallback、routing failure semantics。
- `agent-test-kit`：plugin object harness for tests only。
- `agent-observability`：safe diagnostics projection from existing observation/log/audit/metric/trace surfaces.
