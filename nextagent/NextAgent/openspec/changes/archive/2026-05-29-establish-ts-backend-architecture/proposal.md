## Why

NextAgent 需要建立 TypeScript 后端规格基线，再推进实现。NextAgent 的产品定位是面向电信网络智能体的开发框架和平台：它既要服务直接使用智能体的用户，也要服务基于框架进行二次开发的开发者和集成者，并满足电信级质量属性。当前分支的目标是为 NextAgent 的 TS 后端建立一套独立、可审查、可验证的服务端架构起点。

NextAgent TS 后端要解决的是同一类电信网络智能体开发框架问题。顶层黑盒需求保持稳定：面向电信网络智能体、服务两类用户、支持多入口接入、满足电信级质量属性。中英文交互、长任务异步执行、事件流驱动体验、身份隔离、上下文组装、模型提供方适配、能力治理、平台服务访问、失败恢复、健康诊断和可观测性是这些顶层需求推导出的架构边界；技术栈、package 边界和实现机制按 TS/Node.js 服务端最佳实践独立设计。

第一条 TS 后端规格必须先回答这些问题：

- TS 后端的根 workspace 和后端范围是什么。
- 哪些产品行为已经被本 change 定义，哪些行为必须通过后续 change 定义。
- Node.js 服务端如何处理 runtime schema、异步取消、并发、stream backpressure 和 trace/log/audit 关联字段。
- 中英文交互、异步 Agent、Model、Capability、Gateway 边界、事件流事实和 Web stream 投影如何进入架构骨架。其中 Capability 是上位概念，Tool、Skill、Agent 等都是能力类型，不作为与 Capability 平级的概念重复建模。
- TS package 如何表达职责边界、public exports 和依赖规则。
- runtime kernel、Web adapter、platform gateway、observability、composition root 分别拥有什么职责。
- 哪些命令证明这个架构骨架可以作为后续后端实现的起点。

## Architecture Drivers

本 change 先固化影响架构分层的顶层黑盒诉求，而不是提前定义完整 API、状态机、协议或电信工具治理细节：

- **面向电信网络智能体**：NextAgent 不是通用 coding-agent 平台；架构必须能承载电信网络任务、领域术语、运维诊断、网络能力治理和客户系统集成。
- **服务两类用户**：一类用户需要开箱即用地使用智能体；另一类开发者和集成者需要在稳定边界内进行二次开发，包括受控配置、能力扩展和符合 public contract 的整模块替换。
- **支持多入口接入**：当前后端骨架必须在 channel contract 和 adapter boundary 上支持多 channel；本阶段只提供 `agent-channel-web` 这一种实现。架构不能把请求生命周期、事件事实或会话语义写成 Web-only。
- **满足电信级质量属性**：可靠性、容量、安全隔离、可恢复、可审计、可诊断、可维护和可测试必须成为 package 边界和验证门禁的输入。

这些顶层需求会推导出 bilingual context boundary、async execution boundary、stream event ownership、runtime ownership、channel adapter、model provider adapter、capability boundary、context engine、gateway adapter、observability 和 test-kit 等架构边界；具体命令、事件、状态、协议、工具分级、审批和领域数据模型由后续 capability change 定义。

## What Changes

- 新增 `ts-backend-architecture` capability，显示名称为 `[TS] NextAgent backend architecture`。
- 建立根 `openspec/` 作为 NextAgent TS 后端的规格源；本 change 是 TS 后端第一批架构基线，不再假设已有稳定行为规格存在。
- 定义仓库根目录为 NextAgent TS 后端 workspace，包含后端服务入口、后端 packages、后端测试和后端构建配置。
- 定义 TS 后端第一阶段 package topology：`agent-common`、`agent-contracts`、`agent-runtime`、`agent-session`、`agent-attachment-runtime`、`agent-context-engine`、`agent-memory`、`agent-core`、`agent-model`、`agent-channel-web`、`agent-channel-web-auth-local`、`agent-platform-gateway-local`、`agent-platform-gateway-remote`、`agent-capability`、`agent-observability`、`agent-app`、`agent-test-kit`。
- 定义 TS 后端技术路径：Node.js LTS、TypeScript strict ESM、Fastify、Pino、TypeBox/Ajv、npm workspaces、Vitest、dependency-cruiser、OpenTelemetry、AsyncLocalStorage、Kysely。
- 定义中英文交互架构边界：language/locale 信息进入 contract、context assembly、model/prompt/capability metadata 和 stream/final result 骨架，但不在本 change 定义具体提示词、术语表或语言转换策略。
- 定义异步执行边界：Agent、Model、Capability、Gateway 等长耗时或外部 IO 边界必须使用 Promise/AsyncIterable/event publisher 与 `AbortSignal` 风格取消，而不是同步阻塞 contract。Tool、Skill、Agent capability 作为 Capability 类型遵守同一能力执行边界。
- 定义 bounded parallelism 架构扩展边界：首版不要求单个 RequestRun 内并行执行；后续若启用 Tool、Agent capability、检索或确定性子流程并行，必须受并发预算、依赖图、取消、超时、事件排序和结果聚合约束。
- 定义事件流架构边界：执行组件拥有事实事件，runtime 维护 canonical timeline，Web channel 只投影 stream envelope；本 change 不定义具体 event payload 全集。
- 定义身份和 owner-scope 架构边界：channel/auth 解析当前身份，runtime、session、attachment、memory、gateway、capability 和 audit 边界都必须携带并校验 tenant/subject scope；除 localhost-only local configured authentication 的最小 Web auth adapter boundary 外，本 change 不定义具体认证 endpoint、cookie/ticket 格式、完整认证协议或 IAM 集成细节。
- 定义附件运行时架构边界：后端可信校验、暂存、引用、可用性检查和 cleanup 由 `agent-attachment-runtime` 承载；本 change 不定义具体 upload route、文件解析实现或存储 schema。
- 定义记忆架构边界：长期记忆、自学习、记忆生命周期和长期记忆检索由 `agent-memory` 承载；后续 memory changes 启用长期记忆时，Context Engine 只按 contract 消费可披露的长期记忆/上下文引用；本 change 不定义具体 memory contract、schema、抽取算法或检索 ranking。
- 定义 Context Engine 内部上下文策略职责：`agent-context-engine` 负责 query policy、window selection、compaction 和 prompt shaping，不再把这部分职责单列为独立架构边界。
- 定义 Capability lifecycle 架构边界：registration、agent-scoped discovery、prompt/context disclosure、invocation、result consumption 和 audit/recovery 分离，避免 source/provider、catalog、prompt 注入、executor 和结果持久化混成一套实现；MCP Server 和 API-backed 调用都作为 Tool 场景接入统一 Tool capability 边界。
- 定义 runtime-owned lifecycle hook 架构边界：request accept、planning、model invoke、model result、capability invoke、capability result、context compact 和 terminal event 都保留阶段位置；Hook 不拥有 RequestRun、checkpoint、terminal commit 或 channel state。
- 定义 human interaction 架构边界：模型、hook、policy、capability 或 runtime 发起的澄清、确认、授权、选择和人工接管，都进入同一个 runtime-owned pending input 边界。
- 定义 Agent 内部 request routing 架构边界：routing 位于 Agent 接口之后，由 AgentAssembly 绑定的 routing policy 选择确定性流程、模型驱动 loop、澄清、拒绝或人工接管；runtime 不做业务语义路由。
- 定义 Agent routing 输入约束边界：用户或上游入口提供的处理约束必须由 Agent routing policy 校验，不能让 channel 或 runtime 绕过 Agent 和 capability governance。
- 定义非内置 Skill source 架构边界：本地目录、Agent 配置、SkillHub、客户导入或运营商注入等 Skill source 进入统一 catalog、priority/conflict、availability、SkillTool、sandbox 和审计机制。
- 定义会话状态架构边界：session/message/read model、history consistency 和 owner scope 通过 session/gateway 边界处理；本架构切片不定义会话保留期、过期或自动清理能力。
- 定义 sandbox execution 架构边界：shell、python、脚本和模型生成代码等动态可执行内容必须通过 sandbox gateway contract；PaaS sandbox 由 platform gateway adapter 对接，具体 PaaS SDK 或隔离实现不泄漏到 core、runtime、capability 或 contracts。
- 定义本地单实例运行包和 PaaS 多实例服务部署所需的架构边界。首版本地 release 可只交付本地单实例运行包；完整 PaaS 多实例 runtime 后置，但边界必须保留共享 runtime state、lock/lease、version、terminal commit、非粘性请求和 idempotency boundary 所需位置。本地运行态不承诺集群部署。
- 定义两类用户的架构边界：`agent-app` 负责默认装配，`agent-contracts`、`agent-model`、adapter packages 和 capability provider packages 提供后续扩展面，`agent-test-kit` 支持开发者扩展验证。
- 定义整模块替换边界：替换实现通过 public contract、package exports、adapter-local dependencies 和 `agent-app` 显式 composition 接入；第一阶段不定义动态插件加载、运行时热插拔或远端加载实现包。
- 定义架构骨架必须提供 build、unit test、contract/schema smoke test、architecture lint 四类验证入口。
- 明确本 change 不新增业务 Web API、具体认证 endpoint、cookie/ticket 格式、stream event type、具体 runtime state machine、runtime state storage schema、gateway port、Agent loop 完整行为或前端行为；local configured authentication 只作为 Web auth adapter boundary 进入本 change。

无 **BREAKING** 变更；当前分支尚未建立 TS 后端稳定基线，本 change 是起始基线的一部分。

## Capabilities

### New Capabilities

- `ts-backend-architecture`: `[TS] NextAgent backend architecture`。定义 TypeScript 后端版本的工程范围、服务端技术路径、package topology、runtime kernel、Agent request routing、model provider adapter、capability boundary、sandbox boundary、adapter 边界、composition root 和架构验证要求。Capability 目录名保持 kebab-case；显示标题和 requirement 使用 `[TS]` 前缀。

### Modified Capabilities

无。

## Impact

- OpenSpec：新增 active change 文档和 `ts-backend-architecture` delta spec；归档后形成 TS 后端第一条稳定架构 capability。
- 代码结构：后续实现以仓库根目录作为 TS 后端 workspace，新增根 `package.json`、`src/`、`packages/`、`tests/` 和后端构建配置；不包含浏览器 UI 源码。
- API/事件：本 change 只定义事件流架构边界和事件所有权，不定义具体 `/api/v1` route、stream event payload、runtime state machine 或 gateway data model；这些必须由后续 OpenSpec change 定义后再实现。
- 构建与测试：后续实现新增 TS 后端验证入口：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- 运维与配置：本 change 定义本地运行包和 PaaS 多实例部署的架构边界、配置 schema ownership 和 secret 边界；不定义具体启动命令、端口、部署切换、PaaS 产品拓扑或历史数据处理策略。

## Baseline Promotion Plan

行为契约：
- `openspec/specs/ts-backend-architecture/spec.md`：新增 `[TS] NextAgent backend architecture` 稳定行为契约。

长期背景：
- `openspec/overview.md`：建立 NextAgent TS 后端的产品范围、后端-only 范围、规格基线管理原则。

设计视图：
- `openspec/designs/architecture/ts-backend-architecture.md`：提炼 TS 后端整体架构、技术栈、package topology、模块间数据流、runtime kernel、model provider adapter、capability boundary、adapter 边界和验证策略。
- `openspec/designs/modules/*.md`：为第一阶段 TS package 新增模块职责文档。
- `openspec/designs/adr/0001-ts-backend-stack.md`：记录 TypeScript 后端技术栈和取舍。
- `openspec/designs/spec-to-design-map.md`：建立 `ts-backend-architecture` 到架构、ADR、模块职责和验证入口的导航。

暂不建立的长期文档：
- `openspec/designs/domain/*.md`：本 change 不定义新的领域对象或状态机。
- `openspec/designs/contracts/*.md`：除 local auth adapter boundary 外，本 change 不定义业务 Web API、认证 endpoint、cookie/ticket、stream payload、runtime command、gateway port 或 capability schema 的具体 contract。

验证入口：
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
