# agent-plugin-sdk

## 职责

面向本地 TypeScript 插件作者提供稳定 authoring/test helper、public contract re-export 和脚手架入口。SDK 帮助开发者声明 plugin metadata、capability provider、Tool、lifecycle hook 和开放 policy，但不拥有产品运行时加载、Agent assembly 编译、capability catalog、hook executor 或 policy resolver。

## 非职责

不进入 request production path，不读取 `application.yaml`、`plugin.json` 或插件目录，不动态导入插件，不执行静态扫描，不持有全局 registry，不解析 Agent package，也不拥有 provider/hook/policy 的 runtime 语义。根 SDK 不依赖 `agent-app`、`agent-runtime`、`agent-core`、`agent-capability`、gateway、filesystem、shell 或 network。

## 依赖

根入口只依赖 public `@nextagent/agent-contracts` subpaths 和必要的 schema helper 类型。`@nextagent/agent-plugin-sdk/scaffold` 与 CLI `create-nextagent-plugin` 可以依赖文件系统与构建模板，但该能力必须停留在开发者脚手架路径，不得被产品 composition 导入。

## 核心设计落点

- `definePlugin`、`definePluginFactory`、`defineCapabilityProvider`、`defineTool`、`defineToolProvider`、`defineAgentRoutingPolicy`、`defineLifecycleHook` 和 `getPluginMetadata` 都是显式 authoring helper；它们不注册全局状态，也不通过 import side effect 修改产品 registry。
- `definePlugin(plugin)` 是默认 authoring path，返回 materialized `NextAgentPlugin` object，适用于把依赖打包进 single-file ESM bundle 的普通插件。`definePluginFactory(factory)` 是 host external 优化 path，default export 是 factory；`agent-app` 通过 `{ externals }` 注入 manifest 声明且 host 允许的 external，然后 factory 返回 `NextAgentPlugin`。首版 host object 只包含 `{ externals }`，插件不得依赖未文档化字段。
- `definePlugin(...)` 产出的当前 API 版本固定为 `"1.0"`。`plugin.json.apiVersion` 是 optional major/minor 字符串；当前支持 `"1.0"`、`"1.1"`、`"1.2"`。`definePlugin(...)` 产出固定 `"1.0"` plain object；`definePluginFactory(factory)` 配合 versioned factory host：API `1.1` 提供 developer diagnostics，API `1.2` 提供 closed `runtime` services（`AgentAssemblyRegistry`、`CapabilityCatalog`、`CapabilityInvocationPort`、`ModelSelectionService`、`ModelInvocationService`、`PromptTemplateResolverPort` 六个 public ports，无 `extensions`、index signature 或动态 lookup）。后续新增 host service 必须 OpenSpec 先行并升级 plugin API version。该版本描述 NextAgent plugin API contract，不描述插件作者自己的 `version`。

`agent-plugin-sdk/agent-router-plugin` subpath 导出官方模型驱动路由插件：stable ids（`pluginId=agent-router-plugin`、`policyId=agent-router-plugin.auto-routing`）、config types/schema（`selectionMode: SKILL|WORKFLOW|SKILL_OR_WORKFLOW` 默认 `SKILL_OR_WORKFLOW`；optional `ragPrefilter.topK` 范围 1–10 默认 5）、`createAgentRouterPlugin(runtime)` 与 `createAgentRouterPluginArtifact()`。插件持有 immutable `defaultSelectionTask` 和完整选择算法（binding/catalog 交集、optional builtin `Rag` 预筛、当前 Agent 初始模型一次无 Tool 终选、strict JSON 输出校验）；policy `configure(config)` 只冻结 validated selection/RAG options。
- SDK 只暴露开放 inventory 中允许的 policy helper。当前开放 policy 是 `agentRoutingPolicy`；`restrictedOperationPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 和 `contextWindowPolicy` 仅作为 reserved inventory 事实存在，不提供可执行插件 helper。
- `defineCapabilityProvider(...)` 是高级 provider path，直接输出 public `CapabilityProvider`，允许插件自定义 discovery 和 optional executor。插件必须显式声明 provider identity；SDK 不从 `pluginId` 派生 provider id。
- `defineTool(input)` 是单 Tool 糖，返回 provider-neutral `ToolDefinition`；`DefineToolInput` 可表达 `name`、`description`、`inputSchema`、`outputSchema`、可选 `configSchema`、`requiredDependencies`、`replayPolicy`、`disclosurePolicy`、`returnsCapabilityResult`、`observability`、`configure(config,deps?)` 和 `execute(input,options?)`。Provider identity、discovery mode、binding/default exposure、Agent activation、plugin loading 和 filesystem path 都不属于 `DefineToolInput`。
- `defineToolProvider(input)` 是标准 Tool provider 糖，把 `ToolDefinition[]` 包装成 `CapabilityProvider`。`DefineToolProviderInput` 只包含 `providerId`、可选 `providerType`、可选 `description` 和 required `tools`。标准插件 Tool provider 默认 `providerType=nextagent-plugin-tool`；需要 `SEARCH` discovery 或自定义 executor 时使用 `defineCapabilityProvider(...)`。
- `defineAgentRoutingPolicy(...)` 是当前唯一 `OPEN` policy helper，输入输出复用 `AgentRoutingPolicy` / `AgentRoutingPolicyExecutable` / `AgentRoutingPolicyResult` public contract。SDK 可以暴露 generic `PluginPolicy` contribution shape 和 policy inventory metadata，但不得拥有 policy runtime execution。
- `defineLifecycleHook(...)` 创建 public `LifecycleHook` object，保持与 lifecycle hook execution contract 的 stage、effects、outcome、failure mode、configure/config、timeout 和 order 语义一致。SDK 不执行 hook，也不编译 Agent hook activation。
- `getPluginMetadata(plugin)` 只读取已 materialized plugin object 的 safe metadata：plugin id/version、provider ids、policy ids、hook ids 等。它不读取 `plugin.json`，不 dynamic import，不校验 host external version，不冻结 registry，不编译 Agent activation，也不能证明生产可加载。
- `DefineToolInput`、`ToolDefinition`、`DefineToolProviderInput`、`CapabilityProvider`、routing policy types 和 lifecycle hook types 的 owning contract 位于 public `agent-contracts` subpaths；SDK 只 re-export 或提供纯 authoring wrapper。
- SDK re-export 只来自 public `agent-contracts`。插件不得通过 SDK 获取 host path、raw config、owner scope、agent scope、gateway adapter、runtime store 或 provider-private implementation。
- 默认脚手架生成可测试的本地插件项目：`package.json`、`tsconfig.json`、`esbuild.config.ts`、`src/index.ts`、`plugin.json`、`tests/plugin.test.ts` 和 README。默认 bundle 是单文件 ESM、inline sourcemap、直接 bundle dependencies；`src/index.ts` 使用 `definePlugin(...)`，可以包含 `defineTool(...)` + `defineToolProvider(...)` 最小示例；`tests/plugin.test.ts` 使用 `getPluginMetadata(...)` 做 metadata shape test。脚手架默认产物可以是 `dist/index.js`，部署到 host plugin directory 时 manifest `main` 必须与实际 bundle 位置一致。
- `@nextagent/agent-plugin-sdk/scaffold` 和 CLI `create-nextagent-plugin <plugin-directory>` 是 dev-only surface。它可以使用 Node filesystem 写模板，但不得被 product runtime package 导入；生成物不创建 system config `plugins[]`、Agent `capabilityBindings`、Agent `policies`、Agent `hooks` 或 runtime registry facts。
- `@nextagent/agent-plugin-sdk/developer-hook-trace` provides a developer hook trace plugin definition and artifact helper. The plugin id is `developer-hook-trace`; hook id is `developer-hook-trace.loop-raw-boundary`; supported stages are `BEFORE_PLANNING`、`BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT` and `BEFORE_AGENT_TERMINAL`; effects are observe-only and `failureMode=CONTINUE`. The SDK formatter writes one NDJSON entry per supported lifecycle stage and submits it through the host-provided `DeveloperDiagnosticArtifactSink`; the plugin MUST NOT accept `logDirectory`/`logFile` or directly create, append, rotate or delete host files. Each entry carries a `printedAt` ISO-8601 timestamp generated by the formatter at entry creation, representing the local trace print time; `printedAt` MUST NOT participate in model latency calculation. The entry keeps the original `boundary` unchanged and keeps stage-owned business payload (including model timing) only inside `boundary`, without duplicating `boundary` fields as top-level `raw*`, `modelFirstContentLatencyMs`, `modelE2ELatencyMs` or other parallel fields. An `AFTER_MODEL_RESULT` boundary without `firstContentLatencyMs` or `modelE2ELatencyMs` still produces a `PASS` entry.
- `@nextagent/agent-plugin-sdk/context-monitor` provides a context-monitor plugin definition and artifact helper. The plugin id is `context-monitor`; hook id is `context-monitor.context-evolution`; supported stages are `BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`AFTER_CONTEXT_COMPACT`、`BEFORE_CONTEXT_COMPACT` and `BEFORE_AGENT_TERMINAL`; effects are observe-only and `failureMode=CONTINUE`. The plugin keeps per-session in-memory latest messages/answer state and submits `context-evolution.compaction` and `context-evolution.terminal` records through the host-provided `DeveloperDiagnosticArtifactSink`; the plugin MUST NOT accept `logDirectory`/`logFile` or directly create, append, rotate or delete host files.
- The SDK can write a formal local plugin artifact (`plugin.json` + single-file ESM `index.js`) under a caller-provided target directory. The helper does not change app config, does not create Agent hook activation, does not add host externals and fails closed if files already exist unless `overwrite` is explicit. Local runtime packages include this artifact under `config/plugins/developer-hook-trace/`; for backend-capable local `pack:release` candidates, packaging stages the `developer-hook-trace` declaration into the packaged `config/default-system.yaml` sample and activates `developer-hook-trace.loop-raw-boundary` in the packaged default Agent, without modifying the repository built-in Agent source or non-packaged development defaults.
- `agent-plugin-sdk/assets/developer-hook-trace-viewer.html` 是独立自包含的离线查看器静态资产 owner。该 HTML 使用内联 CSS 和内联原生 JavaScript，不引用 CDN、字体、图片或 source map；Content Security Policy 禁止默认外部资源和网络连接，仅允许本文件的内联样式与脚本执行。页面通过 `<input type="file">` 与 `File.text()` 读取一份本地 NDJSON，解析状态只存在页面内存，不使用 `localStorage`/`sessionStorage`/IndexedDB/Cache API/cookie/service worker，也不回写原文件。所有导入文本经 `textContent` 呈现，不使用 `innerHTML`/`insertAdjacentHTML`/动态脚本执行。该资产不被 `developer-hook-trace` TypeScript 源码导入，也不建立新的 package export、公共类型或运行时 API；它不是插件 contribution，不因与插件同目录而获得运行时权限。`scripts/pack-local-runtime.mjs` 在既有 helper 完成后从 repo asset 路径把该 HTML 复制到目标插件目录（与 `plugin.json`、`index.js` 同级），打包 composition 是运行时插件文件与 companion 文件发生组合的唯一位置，不增加资产发现或第二个插件生成器。查看器私有数据结构（`TraceEvent`/`Trace`/`ImportIssue`、嵌套 `Map<sessionId, Map<requestId, Trace>>` 分组键、`coreMetricsOf` 阶段映射）只存在于查看器页面内存，不进入 SDK 公共类型或 `agent-contracts`。

## 替换边界

是。SDK 是开发者侧 authoring helper，可在保持 public contract 的前提下演进实现；产品加载和执行边界不依赖 SDK runtime state。

## 验证关注点

- 根 SDK dependency graph 不得依赖 app/runtime/core/capability implementation、gateway、fs、shell 或 network。
- helper 不得产生 global registration side effect。
- API version unsupported 时由产品 plugin loader fail closed；SDK helper 只声明当前版本。
- scaffold 生成项目必须能 build/test，并且通过生产 loader 所需的 `plugin.json` + single-file ESM bundle 形态。
- scaffold subpath 与 root SDK export 的 dependency boundary 必须分离；root SDK 不得因 scaffold 获得 filesystem/shell/network 权限。

## Public Exports

`@nextagent/agent-plugin-sdk`、`@nextagent/agent-plugin-sdk/scaffold`，以及 CLI `create-nextagent-plugin`。
