## 背景与问题（Why）

NextAgent 面向电信网络智能体的二次开发者。二次开发中，开发者通常需要编写领域 Tool、受限操作治理 policy、请求生命周期 hook，才能接入网络诊断、告警解析、客户系统校验、变更审批和审计治理等场景。

当前 TS 后端已经有 capability discovery/catalog、Builtin Tool framework、risk policy enforcement 和 lifecycle hook execution 等受治理主路径，但开发者自定义代码还缺少一个统一、可审计、Agent-scoped 的启动期装配机制。本 change 将领域 Tool、开放 policy 和 lifecycle hook 的二次开发入口收敛到同一个 app-owned startup composition 流程，使开发者贡献先进入受控 registry，再分别接入 capability、policy 和 hook 的既有主路径。

本 change 的目标，是定义首版 Agent-scoped startup plugin composition：插件代码由智能体开发者在启动前准备好，`agent-app` 在启动期按受信系统配置加载、校验并冻结；插件 `providers[]` 按既有 provider + `discoveryMode` 进入 capability catalog，再由当前 Agent 的既有 `capabilityBindings` 过滤决定是否可见和可执行；开放白名单 policy 通过 Agent `policies` 配置编译进 `AgentAssembly.policies` 激活；lifecycle hook 只通过 `agent.yaml.hooks` / `AgentAssembly.hooks` 激活。

本 change 依赖 `complete-ts-lifecycle-hook-capabilities` 完成并归档后实施。插件 hook 必须消费完整 hook 目标契约：插件通过 `agent-plugin-sdk` 的 `defineLifecycleHook(...)` 声明 `LifecycleHook` implementation object，hook identity/effects/stage/failure/configure/execute 来自该对象，Agent 级 hook 启用只来自 `agent.yaml.hooks` / `AgentAssembly.hooks`。本 change 不重新定义 hook definition/binding、decision、execution mode 或独立 hook activation 语义。

## 变更范围（What Changes）

- 新增 `agent-scoped-plugin-composition` 行为契约，定义插件加载、插件 provider/policy/hook 声明、Agent 激活和执行期消费的黑盒边界。
- 定义插件加载和插件激活分离：
  - 系统配置只声明哪些本地插件目录可在启动期加载；
  - Agent `capabilityBindings` 声明当前 Agent 允许哪些插件 provider 下的 capability；
  - Agent `policies` / `AgentAssembly.policies` 只声明当前 Agent 激活哪些开放 policy implementation；
  - Agent `hooks` 只声明当前 Agent 激活哪些 lifecycle hook。
- 定义插件交付形态：插件开发者可以在构建期使用任意三方依赖，交付给 `agent-app` 的运行时 artifact 是插件目录内的自包含单文件 `.js` ESM bundle；host-provided externals 作为唯一受控共享依赖路径，由 manifest 声明、inventory 校验和 factory 注入共同完成。
- 定义插件 API contract version：`plugin.json.apiVersion` 可选，采用 `"1.0"` 这类 major/minor 字符串；省略时优先使用插件 export 的 `apiVersion`，若 export 也省略则按当前宿主最新支持版本解释。首版最新且唯一支持版本为 `"1.0"`；root `definePlugin(...)` 当前固定为 v1 authoring helper，默认写入 `"1.0"` 而不是可漂移的 latest；未来多版本通过后续 OpenSpec 增加显式版本化 SDK subpath，本 change 不预先暴露 `vXX` subpath；插件自身发布版本继续由 `plugin.json.version` / plugin export `version` 表达。
- 定义 host-provided externals：默认推荐插件把 `typebox`、`ajv` 和其它三方依赖直接打包进单文件 bundle 并通过 `definePlugin(...)` 导出；`agent-plugin-sdk` 同时暴露可复用宿主工具库的稳定 id/type，作为多插件共享且需宿主版本一致时的优化路径，插件通过 `definePluginFactory((host) => ...)` 使用 `host.externals`；`agent-app` 在 dynamic import main bundle 前静态扫描 import specifier，确认 bundle 中没有任何 runtime import specifier，host external 只通过 factory injection 消费。首版开放工具库范围只包含纯工具/schema/validation 库，初始清单为 `typebox` 和 `ajv`。
- 定义 `agent-plugin-sdk` 是新增 workspace package 的受控架构变更：承载 `definePlugin`、`definePluginFactory`、`defineCapabilityProvider`、`defineTool`、`defineToolProvider`、`defineAgentRoutingPolicy`、`defineLifecycleHook`、`getPluginMetadata` 等 authoring/test helper、插件 provider/policy/hook 类型、开放 policy inventory、`agentRoutingPolicy` plugin-facing interface、host external id/type/inventory、`@nextagent/agent-plugin-sdk/scaffold` dev-only subpath、`create-nextagent-plugin` CLI 和必要 public contract type re-export；`defineCapabilityProvider` 允许插件直接贡献 `agent-contracts/capability` 定义的 `CapabilityProvider` SPI，`defineTool` 把单 Tool authoring input 包装成 `ToolDefinition`，`defineToolProvider` 把 `ToolDefinition[]` 包装成标准 `EAGER` Tool provider；SDK dependency surface 固定在 `agent-common`、public `agent-contracts` subpaths、runtime-safe utility surface 和 dev-only scaffold dependencies。
- 定义插件发现方式：`agent-app` 从受信 system config 的 `plugins[]` 显式清单发现插件目录，读取目录内 `plugin.json` 并加载其中声明的 main bundle；首版 system config `plugins[]` 最多 8 个插件，超过上限 fail closed。
- 定义 `agent-app` 是插件 directory/manifest 校验、main bundle export 校验、provider/policy/hook shape 校验、registry 冻结、插件 capability provider 装配和 `AgentAssembly.policies` 编译的 owner。
- 定义 capability 发现和 Agent 绑定是两条独立事实：runtime `CapabilityProvider` 由 `CapabilityProviderIdentity`、discovery 和可选 executor 组成；`CapabilityProviderIdentity` 是 descriptor、binding、diagnostic 使用的纯身份；provider 的 `discoveryMode` 决定 capability descriptor 何时进入 catalog（`EAGER` 启动期描述符或 `SEARCH` 延迟检索）；当前 Agent 的 `capabilityBindings` 参与 catalog filtering，决定该 descriptor 是否对当前 Agent 可见、可 search、可 resolve、可 invoke。`AgentAssembly.capabilityBindings` 保存 Agent 显式声明的 binding；系统默认暴露作为 capability catalog 内部的 framework-owned allowlist 生效。binding 可以精确指定 capability，也可以按已有 provider/condition 授权 search；`enabled=false` 的显式 binding 可覆盖默认暴露或过滤 search 结果。插件直接声明 `providers[]`；首版每个插件最多声明 4 个 capability provider，插件作者必须显式声明每个 provider 的 `providerId`，且 provider id 必须使用 safe id vocabulary、在 frozen plugin registry 中全局唯一，并避开 framework reserved provider ids；首版插件 provider 使用 `providerType=nextagent-plugin-tool`、`providerKind=CUSTOM` 并只返回 `TOOL` descriptors，可实现 `CapabilityProvider` 的 `EAGER` 或 `SEARCH` discovery 和 executor；`SEARCH` plugin provider 的 request-path `discover` 调用由 `agent-capability` 做 timeout/cancellation/safe-error/diagnostic/result-validation wrapping。`agent-contracts/capability` 定义 public `CapabilityProvider` SPI、`DefineToolInput` 和 `DefineToolProviderInput`；SDK 的 `defineCapabilityProvider(...)` 返回 plugin-owned provider，`defineTool(...)` 返回 public `ToolDefinition`，`defineToolProvider(...)` 是标准 Tool provider 糖，其 input 只包含必填 `providerId`、可选 `providerType`、可选 `description` 和 `tools: ToolDefinition[]`。`agent-app` 校验插件 provider 后交给 `agent-capability` 做 validation/normalization/wrapping，再进入 capability 主路径。builtin Tool、builtin/system/agent-owned Skill、parent subagent、SkillHub、app-composed `memory-tools` 和 top-level Agent 继续保持各自既有 discovery/binding 语义。现有 `memory-tools` 按同一 provider 命名调整迁移：其 provider identity 继续使用 `providerId=memory-tools`，first-party 输出从旧 `CapabilityProviderContribution` 迁为 runtime `CapabilityProvider`，并继续只在 memory binding opt-in 满足后由 `agent-app` 传入 capability subsystem；memory-owned `createMemoryToolsProvider(...)` 复用同一 provider SPI / `DefineToolInput` / `DefineToolProviderInput` shape。
- 定义开放 policy 清单：系统必须声明哪些 policy extension point 面向智能体二次开发者，并为每个清单项冻结业务化 policy id、状态、输入/输出 contract、失败语义、timeout、观测事实和 owner。首版清单包含 `restrictedOperationPolicy`、`agentRoutingPolicy`、`modelSelectionPolicy`、`modelFallbackPolicy` 和 `contextWindowPolicy`。
- 定义 policy 清单状态：`OPEN` 表示当前 change 允许插件实现并由 Agent 激活；`RESERVED` 表示作为二次开发扩展点保留，但必须等 owning OpenSpec change 冻结 contract 后才能启用。首版只有 `agentRoutingPolicy` 为 `OPEN`，其余清单项均为 `RESERVED`。
- 定义 policy 插件按开放 policy 清单中状态为 `OPEN` 的 extension point 接入。首版通过 `AgentAssembly.policies` 绑定事实、`agent-contracts/runtime` policy resolver contract、`agent-runtime` policy registry/resolver implementation 和 `agent-core` Agent-scoped routing typed adapter 选择当前 Agent 激活的 `agentRoutingPolicy` executable；`agent-app` 只在 composition root 中装配这些组件。policy registry/resolver 是可枚举 policy point 到各自 executable 类型的统一容器和查询机制，具体执行接口由各 policy point owner 的 typed adapter 负责。未激活时继续使用系统内置 routing policy。`agentRoutingPolicy` 复用既有 core routing policy 的 `decide(run, context, signal)` 形状，result 对齐既有 `agent-contracts/core.AgentRoutingDecision`。
- 定义 hook 插件可以在 `hooks[]` 声明 `LifecycleHook` implementation object，但 lifecycle stage、effects、outcome、mutation、failure mode、timeout、configure/config 和排序仍由完整 lifecycle hook 边界治理；Agent 级 hook 启用仍由 `agent.yaml.hooks` / `AgentAssembly.hooks` 决定。
- 定义 request 执行按 accepted `agentId`、`agentVersion`、`agentAssemblyRef` 消费当前 Agent 的 `capabilityBindings`、`AgentAssembly.policies` 和 frozen `AgentAssembly.hooks`。
- 定义插件诊断和观测输出只能使用 plugin id、provider id、policy id、hook id、agent id、agent version、safe reason code 和 bounded summary 等安全字段。
- 定义 `create-nextagent-plugin` 脚手架：实现归 `@nextagent/agent-plugin-sdk/scaffold`，生成默认 direct-bundle 插件项目，包含 `package.json`、`tsconfig.json`、`esbuild.config.ts`、`src/index.ts`、`plugin.json` 和 `tests/plugin.test.ts`；模板默认使用 `definePlugin(...)`、单文件 ESM、inline sourcemap 和 bundled dependencies，并使用 `getPluginMetadata(...)` 做插件对象 shape 自检。
- 定义 `agent-test-kit` 扩展 `createPluginTestHarness(...)`，让插件开发者可在 npm test 阶段直接导入插件对象并测试 Tool 执行、`agentRoutingPolicy` decide 和 lifecycle hook execute；该 harness 跳过 bundler/loader/system config/`plugin.json`/host external validation，不替代 app loader、Agent activation、capability catalog、policy wrapper 或 hook registry 的主路径验证。
- 定义 fail-closed 语义：Agent 配置引用不存在或非法插件贡献时，该 Agent assembly 编译失败；被引用插件 manifest/export/schema 非法时，引用它的 Agent readiness 依赖完整合法的插件事实。

无 **BREAKING** 变更。本 change 只新增受控启动期装配路径，现有 builtin Tool 的默认启用/禁用覆盖语义、系统内置 risk policy 和系统内置 lifecycle hook 的默认行为保持不变；插件 Tool 通过当前 Agent 既有 `capabilityBindings` 显式允许。

## 非目标和受控边界（Non-Goals / Boundaries）

- 本 change 不引入运行时动态插件系统、热加载、远端分发、marketplace 或脚本执行生态。
- 插件加载来源限定为受信 system config 中显式声明的本地插件目录；目录扫描、glob 自动发现、远端拉取、Agent 配置、request body、client metadata 和 model output 不作为插件发现来源。
- 插件运行时 artifact 限定为插件目录内的单文件 `.js` ESM bundle；multi-file bundle、zip/archive、单独 module 文件、插件私有 `node_modules`、host `node_modules` resolution 和 `agent-app` 执行依赖安装均不在范围内。
- Host external 限定为 framework-owned inventory 中的工具库 factory injection；transport、logging、persistence、observability、gateway/provider SDK、workspace private path、Node builtin、URL、绝对路径和 parent traversal 均作为 loader 边界输入 fail closed。
- `agent-plugin-sdk` 不承载 loader、registry、runtime、gateway、filesystem 实现，不依赖 `agent-runtime`、`agent-capability` 或其它 implementation package。
- `@nextagent/agent-plugin-sdk/scaffold` 只作为 dev-only scaffold subpath 存在；生成模板、写文件和 bundler 配置不进入 runtime package dependency graph，不参与 startup plugin loading、registry freezing、Agent activation 或 capability/policy/hook execution。
- 插件 provider 首版不贡献 `SKILL` / `AGENT` / Subagent descriptors，不伪装成 builtin provider，不创建第二套 plugin Tool registry 或 executor registry。
- Plugin policy 首版不开放通用 `PolicyPort`、未知 policy kind、remote policy service、script policy 或模型驱动 policy；`RESERVED` policy point 只作为后续 change 的稳定命名占位。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-scoped-plugin-composition`: 定义本地 TypeScript 插件在 `agent-app` 启动期加载、校验、冻结，以及通过插件 `providers[]` 注册最多 4 个 capability provider、通过 Agent `capabilityBindings` 绑定 provider 下的 Tool、通过 Agent `policies` 编译到 `AgentAssembly.policies` 激活白名单 policy，并向 startup hook registry 提供 lifecycle hook implementation object 的行为边界；同时冻结首版插件 provider 只开放 `TOOL` descriptors，且不改变现有 Skill/Subagent discovery 和 catalog filtering 语义。

### 修改的 Capability

- 无。现有 `builtin-tool-framework`、`risk-policy-enforcement`、`complete-ts-lifecycle-hook-capabilities`、`capability-catalog` 和 `agent-package-assembly` 的主路径语义保持不变；本 change 通过新增 capability 定义如何受控接入这些主路径。

## 影响范围（Impact）

- `agent-app`：新增启动期插件目录配置解析、manifest/main bundle 加载、export 校验、registry 冻结、插件 capability provider 装配、`AgentAssembly.policies` 编译、runtime policy resolver 装配并注入 `agent-core`，以及 safe config/assembly diagnostic。
- `agent-plugin-sdk`：新增 developer-facing authoring SDK package；只导出 plugin helper、`defineCapabilityProvider`/`defineTool`/`defineToolProvider`/`defineAgentRoutingPolicy`/`defineLifecycleHook`/`getPluginMetadata` authoring/test helper、插件 provider/policy/hook 类型、开放 policy inventory、host external inventory、`@nextagent/agent-plugin-sdk/scaffold` dev-only subpath、`create-nextagent-plugin` CLI 和必要 public type re-export，并同步 workspace architecture guard；`defineCapabilityProvider` 直接面向 `agent-contracts/capability` 的 provider SPI，`defineTool` 和 `defineToolProvider` 只依赖 `agent-contracts/capability` 的 `DefineToolInput` / `DefineToolProviderInput` shape，不依赖 `agent-capability`；`defineAgentRoutingPolicy` 面向本 change 冻结的 `agentRoutingPolicy` plugin-facing contract，不依赖 `agent-core` implementation；SDK root 不成为 first-party module 的必经依赖，scaffold subpath 不进入 runtime dependency graph。
- `agent-capability`：将当前纯身份类型 `CapabilityProvider` 重命名为 `CapabilityProviderIdentity`，将当前注册单元 `CapabilityProviderContribution` 重命名为 runtime `CapabilityProvider`，消费 `agent-contracts/capability` 中的 public provider SPI，并实现 provider validation/normalization/wrapping，使插件 provider 下的 Tool descriptor 作为 `EAGER` 或 `SEARCH` descriptor 进入统一 capability catalog、resolve 和 invocation 主路径，并继续由 `AgentAssembly.capabilityBindings` 过滤可见性和可执行性。现有 `externalContributions` 输入和 memory tool 注册路径同步改为外部 runtime `CapabilityProvider` 输入，避免 capability subsystem 内同时存在 contribution/provider 两套注册概念。
- `agent-runtime`：消费当前 Agent 的冻结 hook activation facts，并实现通用 policy registry/resolver；插件目录读取和配置读取仍归 `agent-app` startup composition。
- `agent-core`：继续只通过既有 capability、routing、policy 和 hook 边界消费已激活能力；执行 routing 时通过 Agent-scoped routing typed adapter 消费注入的 policy resolver，并基于当前 Agent `AgentAssembly.policies` 选出的 evaluator 做 fail-closed routing，不拥有插件加载逻辑。
- `agent-observability`：消费插件加载、Agent activation、Tool/policy/hook 执行相关的 safe diagnostic refs。
- `agent-test-kit`：新增 plugin test harness，直接消费已导入的插件对象和 public contract shape，提供 test-only Tool/policy/hook 调用能力；不依赖 `agent-app` loader、gateway/platform、filesystem/shell/network helper 或 implementation private path。
- 配置面：新增系统级插件目录加载配置、framework-owned `OpenPolicyInventory` 声明，以及 Agent 级 `policies` 配置并编译为 `AgentAssembly.policies`；系统配置显式列出 `configRoot` 下插件目录，Agent Tool 可见性继续通过既有 `capabilityBindings` 表达，Agent 配置只承载 activation facts。
- 测试面：需要新增 config/contract、assembly、capability integration、policy、hook、SDK scaffold、agent-test-kit plugin harness、architecture 和 security negative tests。
- 运维面：启动/readiness 必须能诊断插件加载失败、非法贡献、Agent activation 失败，并避免泄漏本地路径、raw config、secret、prompt、tool args/result、模型输出或 stack trace。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-scoped-plugin-composition/spec.md`：新增，承载插件加载、provider/policy/hook 声明、开放 policy 清单、Agent 激活、作用域隔离、fail-closed、安全诊断和非目标的长期行为契约。

长期背景：
- `openspec/overview.md`：补充当前 capability/governance 基线包含受控 Agent-scoped startup plugin composition；同时保留动态加载、热加载、远端分发和 marketplace 不在当前范围内。

设计视图：
- `openspec/designs/architecture/capability-spi.md` 或等价 capability 架构文档：提炼 `CapabilityProviderIdentity`、public `CapabilityProvider = CapabilityProviderIdentity + discovery + executor?` SPI、`DefineToolInput`、`DefineToolProviderInput`、provider validation/normalization/wrapping、`EAGER`/`SEARCH` discovery mode、catalog 内部默认暴露 allowlist、provider/condition search 授权与 `AgentAssembly.capabilityBindings` filtering 的分层关系，并说明插件 capability provider 进入 capability discovery/catalog 主路径的跨模块关系。
- `openspec/designs/architecture/security-and-governance.md` 或等价治理架构文档：提炼开放 policy 清单、policy 白名单 extension point、hook plugin activation 和 Agent Scope 隔离。
- `openspec/designs/modules/agent-app.md`：提炼 `agent-app` 对插件加载、校验、registry 冻结和 Agent activation 编译的 owner 职责。
- `openspec/designs/modules/agent-plugin-sdk.md`：新增或更新，提炼 SDK authoring helper、`getPluginMetadata(...)`、provider/policy/hook public surface、开放 policy inventory type exposure、host external type exposure、`@nextagent/agent-plugin-sdk/scaffold` dev-only subpath、`create-nextagent-plugin` CLI、workspace package boundary 和禁止依赖 implementation package 的架构约束。
- `openspec/designs/modules/agent-capability.md`：提炼 `CapabilityProviderIdentity` / runtime `CapabilityProvider` 命名修正、provider validation/normalization/wrapping 和插件 capability provider 的消费边界。
- `openspec/designs/modules/agent-runtime.md`：提炼 runtime 只消费当前 Agent frozen hook activation facts；不加载插件代码。
- `openspec/designs/modules/agent-test-kit.md`：提炼 plugin test harness 的 test-only helper、public contract dependency boundary 和不替代 app loader/activation/main path 验证的限制。
- `openspec/designs/adr/agent-scoped-startup-plugin-composition.md`：记录选择启动期本地 TypeScript 插件 composition，而不是动态加载、热加载、远端分发或通用 policy/plugin runtime 的取舍。
- `openspec/designs/spec-to-design-map.md`：新增 `agent-scoped-plugin-composition` 到 architecture、modules 和 ADR 的导航。

开发者文档：
- `docs/developer/agent-plugins.md` 或等价开发者指南：说明 `create-nextagent-plugin` 快速开始、插件目录、`plugin.json`、ESM bundle 构建、默认直接打包依赖并使用 `definePlugin(...)`、host externals / `definePluginFactory(...)` 作为优化路径、`providers[]` / `policies[]` / `hooks[]` authoring、`defineCapabilityProvider(...)` 高级 provider SPI、`defineTool(...)` / `defineToolProvider(...)` 糖、`agent-test-kit` plugin harness、Agent Tool 绑定配置、Agent policy/hook 激活配置、故障诊断和禁止事项；该文档只解释已冻结 contract，不作为第二套行为来源。

验证入口：
- plugin config/directory/manifest/export/host external contract tests，包括 main bundle import specifier 静态扫描 negative tests，确认任何残留 runtime import specifier 在 dynamic import 前被拒绝。
- SDK package architecture tests：workspace package inventory、manifest exports、README、dependency-cruiser package lists、implementation firewall 和 forbidden dependency checks。
- Agent policy binding / `AgentAssembly.policies` activation tests。
- plugin provider capability catalog/invocation integration tests；确认插件 `providers[]` 贡献的 `CapabilityProvider` 经 `agent-capability` validation/normalization/wrapping 后进入 capability subsystem 的 `EAGER` 或 `SEARCH` discovery source，`SEARCH` discover 调用本身具备 timeout/cancellation/safe-error/diagnostic/result-validation guard，并且只通过既有 `capabilityBindings` 对当前 Agent 可见、可 search 和可执行，未绑定或 `enabled=false` 均不可见，且不改变 builtin Tool、memory-tools、SkillHub、Skill、Subagent 现有 discovery/filtering 行为，未新增第二套 Tool/Skill/Agent registry；新增/更新 provider SPI / wrapping 和 memory-tools regression tests，确认 plugin SDK 与 memory wrapper 复用同构 provider SPI 但 activation 语义各自保持。
- policy extension allowlist inventory、未知 policy point 拒绝和 fail-closed tests。
- lifecycle hook plugin Agent-scope execution tests。
- SDK scaffold tests，覆盖 `create-nextagent-plugin my-plugin` 生成目录、`package.json`、`tsconfig.json`、`esbuild.config.ts`、`src/index.ts`、`plugin.json`、`tests/plugin.test.ts`，模板默认 direct bundle + `definePlugin(...)`，并确认 scaffold subpath 不进入 runtime dependency graph。
- agent-test-kit plugin harness tests，覆盖直接导入插件对象后可 invoke Tool、evaluate `agentRoutingPolicy`、execute hook，并断言不启动 `createComposedApp`、不读取 `plugin.json`、不执行 dynamic import 或 host external validation。
- architecture tests：runtime/core/capability 不从插件目录、请求体、模型输出或 client metadata 加载插件；不新增 `agent-contracts/plugin` 或通用 `PolicyPort`。
- security tests：safe diagnostics 不泄漏本地路径、raw config、secret、prompt、tool args/result、模型输出或 stack trace。
