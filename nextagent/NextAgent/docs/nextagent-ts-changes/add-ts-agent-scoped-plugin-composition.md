# add-ts-agent-scoped-plugin-composition

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Policy Hooks

状态：ready
类型：实施 change
主要 owner：`agent-app`
协作 owner：`agent-capability`、`agent-runtime`、`agent-core`、`agent-observability`
依赖：`add-ts-agent-package-assembly`、`add-ts-lifecycle-hook-execution`、`add-ts-risk-policy-enforcement`、`add-ts-capability-core-governance`、`add-ts-app-config-schema`

目标：
- 支持智能体开发者在启动前准备本地插件目录，由 `agent-app` 根据 system config 显式清单启动期加载、校验并冻结插件 registry；Agent 配置显式激活插件贡献后，插件 Tool、开放白名单 Policy 实现和 lifecycle Hook 只在对应 Agent 中生效。

能力组共享输入：

整理状态：待整理为独立 OpenSpec change

能力组目标：
- 提供二次开发代码的受控启动期装配机制，避免 Tool、Policy、Hook 自建加载路径或绕过 Agent 作用域。

共享规格输入：
- 插件机制 SHALL 是 startup composition 能力，不是运行时动态插件系统、热加载系统、远端分发协议或 marketplace。
- 插件代码 SHALL 是部署前准备好的本地插件目录，由 `agent-app` 在启动期通过受信 system config 的 `plugins[]` 显式清单加载；不得由请求体、客户端 metadata、模型输出、SkillHub 下载内容、远端 URL 或 Agent package 未授权路径触发加载。
- 插件目录 SHALL 位于 `configRoot` 下并包含 `plugin.json`；`plugin.json.main` SHALL 指向同一插件目录内的 `.js` ESM bundle；首版不支持 zip/archive、单独 module 文件、目录自动扫描、glob discovery 或远端拉取。
- 插件开发者 MAY 在构建期使用任意三方依赖，但除 `plugin.json.hostExternals` 声明且 framework-owned 工具库白名单允许的 host-provided externals 外，运行时 artifact MUST 自包含；`agent-app` MUST NOT 执行插件 `npm install`、解析插件私有 `node_modules`、托管插件依赖版本或作为插件包管理器。
- Host-provided externals MUST 通过 `agent-plugin-sdk` 的 plugin factory host object 注入，插件不得通过 Node ESM import 直接解析宿主 `node_modules`；首版工具库白名单精确包含 `typebox(@sinclair/typebox)` 和 `ajv(ajv)`，并明确关闭 `fastify`、`pino`、`kysely`、`@opentelemetry/api`、workspace private path、gateway/provider SDK、HTTP/DB client、filesystem/shell helper。
- 插件加载和插件激活 MUST 分离。系统配置只声明哪些插件目录可加载；Agent 配置只声明当前 Agent 启用哪些插件贡献。
- 插件被加载不代表全局生效；未被某个 Agent 配置激活的插件贡献，对该 Agent MUST 不可见、不可 resolve、不可 invoke、不可执行。
- `agent-app` MUST 在启动期校验 system config、插件目录、`plugin.json`、main bundle exports、host externals、contribution id、version、kind、schema、required dependencies 和 safe description，并形成冻结的 `PluginRegistrySnapshot` 或等价 app-owned 快照。
- Agent assembly 编译 MUST 将 Agent 配置中的插件激活声明解析为 assembly-scoped plugin activation snapshot 或等价冻结事实；request 执行只能按 accepted `agentId`、`agentVersion`、`agentAssemblyRef` 查找该 Agent 的激活插件贡献。
- Runtime、core、capability、policy 和 hook 执行路径 MUST NOT 按默认 Agent、全局插件 registry、请求体、模型输出或 client metadata 重新选择插件。
- 插件 Tool 只贡献 `ToolDefinition` 候选；被 Agent 激活后 MUST 进入既有 capability discovery/catalog 主路径，并继续遵守 capability descriptor schema validation、Agent binding filtering、conflict resolution、`CapabilityInvocationPort`、risk policy、sandbox dependency、timeout/cancellation 和 observability 规则。
- 插件 Tool MUST 使用插件 provider identity 或等价受治理 provider facts 表达来源；不得作为 builtin Tool 伪装进 owned builtin Tool list，也不得通过配置直接创建 Tool name、schema 或 execution mapping。
- 系统 MUST 声明开放 policy 清单，明确哪些 policy extension point 面向智能体二次开发者，并为每个清单项冻结业务化 policy id、状态、输入/输出 contract、失败语义、timeout、观测事实和 owner。
- 首版开放 policy 清单 MUST 精确包含 `restrictedOperationPolicy(OPEN)`、`agentRoutingPolicy(RESERVED)`、`modelSelectionPolicy(RESERVED)`、`modelFallbackPolicy(RESERVED)` 和 `contextWindowPolicy(RESERVED)`；只有 `OPEN` 状态的 policy point 允许插件实现并由 Agent 激活。
- Policy 插件 MUST 使用开放 policy 清单中状态为 `OPEN` 的白名单 extension point。首版只允许激活 `restrictedOperationPolicy`，其底层 contract 对齐当前 `RiskPolicyEvaluator`；不得新增通用 `PolicyPort`、未知 policy kind、脚本 policy、远端 policy service 或模型驱动 policy。
- 每个开放 policy extension point MUST 定义固定 input/output contract、timeout、failure semantics、safe diagnostics 和 observability facts；risk policy 插件失败时 MUST 遵循 risk policy fail-closed 规则。
- Hook 插件 MAY 同时贡献 hook definition 和 hook handler implementation，但 lifecycle stage、execution mode、failure mode、decision/mutation 语义、timeout 和排序 MUST 继续由 `add-ts-lifecycle-hook-execution` 的边界治理。
- Hook 插件被 Agent 激活后，只能通过当前 Agent 的 frozen hook definition/binding snapshot 执行；hook executor MUST NOT 扫描全局插件 registry 或执行未被当前 Agent 激活的 hook handler。
- Agent 配置可以启用插件贡献并收窄允许的配置参数；配置 MUST NOT 被解释为业务策略 DSL、脚本、远端调用、模型指令、插件发现规则或动态 import path。
- Agent 配置引用不存在的 plugin id、contribution id、policy extension point 或 hook id MUST 导致该 Agent assembly 编译 fail closed。
- 被引用插件的 manifest/export/schema 非法 MUST 导致引用它的 Agent fail closed；未被任何 Agent 引用的插件是否阻断 app readiness 由 system plugin config 的 required/optional 语义定义，若首版不定义 required/optional，则所有声明插件必须合法。
- 插件 safe diagnostics、audit/log/metric refs 只能包含 plugin id、contribution id、agent id、agent version、safe reason code 和 bounded summary；不得输出本地路径、raw config、secret、tool args/result、prompt、模型输出或 stack trace。

契约输入：
- 复用 `agent-contracts/runtime` 中 lifecycle hook、risk policy evaluator、request run 和 agent identity 相关 contract。
- 复用 `agent-contracts/capability` 和 `agent-common` 中 capability descriptor、provider identity、capability kind、invocation 和 replay policy 相关 contract。
- 如需新增 public plugin manifest/config/activation DTO，必须先明确 owning export surface；优先放在 `agent-contracts/app` 或 app composition 私有 schema，除非运行时跨包必须依赖。
- 不新增 `agent-contracts/plugin`、`agent-contracts/policy` 或通用 plugin runtime subpath，除非后续架构 change 明确新增独立 owning module。

实现约束：
- `agent-app` 是插件目录加载、manifest 校验、main bundle export 校验、registry 冻结和 Agent 配置激活解析的主要 owner。
- `agent-capability` 只消费已经激活的插件 Tool provider/discovery facts，不读取插件目录或 main bundle path，也不执行插件加载。
- `agent-runtime` 只消费当前 Agent 的冻结 hook/policy activation facts，不扫描插件目录或重新解析 Agent 配置。
- `agent-core` 不按业务语义选择插件；它只通过既有 routing、capability 和 policy/hook boundary 消费已激活能力。
- 插件代码视为部署可信代码，但动态执行、shell、python、脚本或模型生成代码仍必须经过 sandbox gateway；插件机制不得成为宿主进程任意执行绕过口。
- 不得把插件加载失败、配置错误或非法贡献映射成普通 capability not found 而静默降级；必须产生 safe config/assembly diagnostic。

非目标：
- 不支持运行时动态安装、热加载、watcher reload、远端插件下载、marketplace、签名信任链、版本回滚、插件 UI 管理或非 TypeScript 插件 runtime。
- 不支持让 Agent package、SkillHub package、模型输出或客户端请求直接携带可执行插件代码。
- 不支持开放任意 policy kind、generic `PolicyPort`、remote policy service、script policy 或 hook executor plugin 逃逸。
- 不重定义 capability catalog、Tool executor、risk policy enforcement 或 lifecycle hook execution 的主路径语义。

验收要点：
- Contract/config tests 覆盖合法插件目录、`plugin.json`、ESM bundle、host external 注入和非法 path/manifest/export/schema/host external fail closed。
- Assembly tests 覆盖同一插件只对显式激活 Agent 生效，未激活 Agent 看不到对应 Tool、Policy、Hook。
- Capability integration tests 覆盖插件 Tool 进入 capability discovery/catalog 主路径，并经过 Agent binding、schema validation、risk policy 和 invocation boundary。
- Policy tests 覆盖开放 policy 清单 inventory、只允许 `OPEN` 状态的 `restrictedOperationPolicy`、`RESERVED` policy point 和未知 policy kind 被拒绝、未激活 policy 插件被拒绝、restricted operation policy 插件失败按 fail-closed 处理。
- Hook tests 覆盖插件 hook definition/handler 经 Agent binding 激活后只在对应 Agent lifecycle stage 执行，未激活 Agent 不执行。
- Architecture tests/review 覆盖 runtime/core/capability 不从插件目录、请求体、模型输出或 client metadata 加载插件；`agent-app` 不扫描目录、不加载 zip、不安装插件依赖、不按插件 import 解析宿主 `node_modules`；不新增 `agent-contracts/plugin` 或 generic `PolicyPort`。
- Security tests 覆盖 safe diagnostics 不泄漏本地路径、raw config、secret、prompt、tool args/result、模型输出或 stack trace。
- Developer guide 覆盖插件目录、`plugin.json`、ESM bundle 构建、`hostExternals` 工具库白名单、Tool/Policy/Hook authoring、Agent 激活配置、safe diagnostic 故障排查和禁止事项；指南不得定义 OpenSpec 未冻结的新行为。

并行边界：
- 本 change 只定义受控启动期插件 composition 和 Agent-scoped activation，不修改已有 hook/policy/capability owner 的主路径语义。
- 如果需要把 plugin activation facts 加入 public `AgentAssembly` contract，必须先提出 contract refinement；首选方案是在 app/runtime composition 中维护按 `agentAssemblyRef` 索引的冻结 activation snapshot。
- `add-ts-lifecycle-hook-execution` 仍拥有 hook stage、decision、mutation、failureMode 和 executor 语义。
- `add-ts-risk-policy-enforcement` 仍拥有 risk policy input/output、fail-closed 和 `POLICY_APPLIED` 语义。
- `builtin-tool-framework` 和 capability governance 仍拥有 ToolDefinition、descriptor projection、catalog、resolve 和 invocation 语义。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
