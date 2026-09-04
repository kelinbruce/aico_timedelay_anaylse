## 1. Backend Workspace

- [x] 1.1 在仓库根目录初始化 TS 后端 workspace，添加 npm workspaces、`package-lock.json`、`tsconfig.json`、`tsconfig.base.json` 和统一验证脚本：`build`、`test`、`test:contract`、`lint:architecture`。
- [x] 1.2 配置 TypeScript strict ESM project references，启用 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和 package `exports`。
- [x] 1.3 添加 dependency-cruiser 配置，覆盖 layer、forbidden dependency、private import 和 framework leakage 规则。
- [x] 1.4 添加最薄的后端启动入口和 `agent-app` composition boundary；不得在本 change 中定义具体 Web API、stream event payload、runtime state machine 或 gateway data model。
- [x] 1.5 添加 Vitest 基础配置和根 `tests/` 入口，用于 architecture、contract 和 schema smoke verification。
- [x] 1.6 更新根 `README.md`，说明 NextAgent TS 后端范围、四类顶层诉求、模块边界、整模块替换原则和验证命令。

## 2. Package Topology

- [x] 2.1 创建第一阶段 package skeleton：`agent-common`、`agent-contracts`、`agent-runtime`、`agent-session`、`agent-attachment-runtime`、`agent-context-engine`、`agent-memory`、`agent-core`、`agent-model`、`agent-channel-web`、`agent-channel-web-auth-local`、`agent-platform-gateway-local`、`agent-platform-gateway-remote`、`agent-capability`、`agent-observability`、`agent-app`、`agent-test-kit`。
- [x] 2.2 为每个 package 添加最小 README，说明职责、非职责、public exports、allowed dependencies、forbidden dependencies，以及该 package 是否属于可整模块替换的 adapter/provider 边界。
- [x] 2.3 在 `agent-contracts` 建立 public namespace skeleton，覆盖 runtime、channel、session、attachment、context、model、capability、core、gateway、observability、app，并为后续 memory contract 保留 extension placeholder；subpath export 对应架构 owning module 的 public surface，不为 reserved alias 或概念分类单独建立 owning namespace；只保留边界接口和 runtime schema 占位，不定义具体业务字段全集。
- [x] 2.4 在 `agent-capability` README 和 contract skeleton 中明确 Capability 是上位概念，Tool、Skill、Agent 是 Capability 类型，避免平级重复建模；Agent capability 可表示本地 SubAgent 或远端 Agent。
- [x] 2.5 在 `agent-model` README 和 contract skeleton 中明确模型 provider 差异由该模块适配；provider SDK、Vercel AI SDK、LangChain、OpenAI-compatible client 或平台 ModelGateway 调用细节不得泄漏为跨模块 public contract。ModelGateway 表示 PaaS 推理网关，只有选择该推理路径时才由 `agent-model` 通过 gateway contract 调用。
- [x] 2.6 在 `agent-capability` README 和 contract skeleton 中明确 registration、agent-scoped discovery、prompt/context disclosure、invocation、result consumption、audit/recovery 是不同 lifecycle boundary；MCP Server 和 API-backed 调用都是 Tool 场景，仍进入统一 Tool capability 边界；本任务只保留边界接口和验证占位，不定义具体 Tool、Skill 或 Agent capability 业务 schema。
- [x] 2.7 在 `agent-contracts` 和 platform gateway README 中明确 shell、python、脚本、模型生成代码等动态可执行内容必须通过 sandbox execution gateway boundary；PaaS sandbox 由 remote gateway adapter 对接，本地运行态提供明确的 unavailable/deny-by-default 或受限占位实现；本任务只保留 gateway contract 和验证占位，不实现具体隔离机制。
- [x] 2.8 在 `agent-session` README 和 contract skeleton 中明确 session/message/read model、history consistency 和 owner scope 边界；本任务不定义会话保留期、过期、自动清理、调度器或存储 schema。
- [x] 2.9 在 `agent-attachment-runtime` README 和 contract skeleton 中明确附件后端可信校验、暂存、refs、availability check 和 cleanup policy 边界；本任务不定义具体 upload API、文件解析实现或存储 schema。
- [x] 2.10 在 `agent-memory` README 和 extension placeholder 中明确长期记忆、自学习、知识生命周期和 memory retrieval 边界；Context Engine 后续只消费 owner-scoped retrieval result；本任务不定义具体 memory contract、schema、抽取算法或 ranking。
- [x] 2.11 在 `agent-context-engine` README 中明确 query policy/window selection、compaction 和 prompt shaping 属于 Context Engine 内部职责边界，不再单列为独立架构边界。
- [x] 2.12 在 `agent-channel-web-auth-local` README 和 package exports 中明确 localhost-only local configured authentication 的 Web auth adapter boundary，并暴露 Web auth plugin/factory 占位；本 change 不定义具体 credential 校验、identity 解析协议、public gateway auth contract、endpoint、payload、cookie/ticket 或认证协议。

## 3. Architecture Boundaries

- [x] 3.1 建立 `agent-runtime` 的 request lifecycle owner boundary，包括 command intake、scheduling、cancellation、timeline ownership、lifecycle hook stage placeholder 和 terminal commit 的接口占位；hook 阶段至少覆盖 request accept、planning、model invoke、model result、capability invoke、capability result、context compact 和 terminal event；不实现完整状态机。
- [x] 3.2 建立 `agent-channel-web` 的 Web channel boundary，说明它支持 Web 客户端的 LUI 访问，只做 transport 和 stream projection，不拥有 request lifecycle。
- [x] 3.3 建立 `agent-core` 到 `agent-context-engine`、`agent-model`、`agent-capability` 的编排边界；明确 request routing 在 Agent 接口之后、Agent 内部，通过 routing policy 选择 deterministic flow、model-driven loop、clarify、reject 或 human handoff；不实现完整 Agent loop 或具体路由规则。
- [x] 3.4 建立 local/remote platform gateway adapter boundary，保证 persistence、MCP Server、SkillHub、AgentRegistry、ModelGateway 和其他 remote service 细节不泄漏到 runtime、core、context 或 channel。
- [x] 3.5 建立 `agent-observability` structured logging、redaction 和 tracing/metrics integration boundary，注入安全业务标识字段，禁止业务 package 使用散落的 `console.*` 作为诊断入口，且不把 tracing/metrics SDK 类型暴露为核心契约。
- [x] 3.6 建立 `agent-app` 显式装配边界，支持通过 public contract 和 provider factory 选择 model、capability、gateway、channel、observability 等替换包，并支持产品特定 composition entry/factory。
- [x] 3.7 建立本地运行包与 PaaS 多实例部署的运行形态边界：本地为单实例进程重启恢复；完整 PaaS 多实例 runtime 后置，但架构边界保留共享 runtime state、lock/lease、version、terminal commit、非粘性请求和 idempotency boundary 所需位置；不在本 change 定义具体 PaaS 拓扑、端口或发布策略。
- [x] 3.8 建立 human interaction pending boundary，覆盖 model、hook、policy、Tool、Skill、Agent capability 或 runtime 发起的澄清、确认、授权、选择和人工接管；不定义具体 Web API 或 UI 行为。
- [x] 3.9 建立 bounded parallel execution 扩展边界占位，明确首版可保持单个 RequestRun 内串行执行；后续若启用并行 Tool、Agent capability、检索或确定性子流程，必须经过并发预算、依赖图、取消、超时、事件排序和结果聚合边界。
- [x] 3.10 建立 sandbox execution gateway boundary，保证 capability、hook、policy 不直接绕过 platform gateway sandbox port 执行 shell、python、脚本或动态可执行内容。
- [x] 3.11 建立非内置 Skill source/catalog 边界，保证客户导入、运营商注入、本地目录或 Agent 配置带入的 Skill 使用统一 registration、discovery、SkillTool、sandbox、policy 和 audit 机制。
- [x] 3.12 建立 Agent routing 输入约束边界，保证用户或上游入口提供的处理约束作为 Agent routing policy 输入被校验和审计，不允许 channel 或 runtime 直接绕过 Agent 和 capability governance。
- [x] 3.13 建立 session 状态 owner 边界，保证 session/message/read model、history consistency、active request、pending input 和 human handoff 事实只通过 session/runtime/gateway contract 访问。
- [x] 3.14 建立 identity 和 owner-scope 边界，保证 channel/auth 解析当前身份，runtime、session、attachment、memory、capability、gateway 和 audit 调用都携带 tenant/subject scope，且不信任请求体、模型输出或 capability 参数中的 owner 字段。
- [x] 3.15 建立 attachment runtime 边界，保证 request acceptance 前校验附件 refs、owner、可用性和安全 descriptor，context 只消费安全 refs/summary。
- [x] 3.16 建立 memory lifecycle 边界，保证长期记忆、自学习和知识生命周期不塞入 Context Engine 或 request terminal commit 必要写入。
- [x] 3.17 建立 local Web auth adapter boundary，保证该边界只在 localhost-only local configured authentication 产品入口中由 `agent-channel-web-auth-local` 显式 import，remote/IAM 产品入口不得 import/register、bundle 或暴露该 package，且 auth-local 不访问 request lifecycle、session/message、memory、attachment、RequestRun 或 capability durable facts。

## 4. Verification

- [x] 4.1 添加 package export tests，验证跨 package 只能通过 public package name 或 public subpath import，并验证 `agent-channel-web` 不依赖 `agent-channel-web-auth-local`。
- [x] 4.2 添加 architecture negative fixtures，证明 forbidden dependency、private import、framework leakage 和 provider SDK leakage 会失败。
- [x] 4.3 添加 schema/contract smoke tests，验证不可信边界必须保留 runtime validation 入口。
- [x] 4.4 添加 async boundary smoke tests，验证 Agent、Model、Capability、Gateway 等长耗时边界使用 async primitive 并接收 cancellation context。
- [x] 4.5 添加 event ownership smoke tests，验证执行组件发布事实事件、runtime 维护 canonical timeline、Web channel 只做 stream projection。
- [x] 4.6 添加运行形态 smoke tests，验证本地运行态不声明集群能力，PaaS 多实例边界不依赖 process-local memory、单实例 scheduler 或 sticky session。
- [x] 4.7 添加 routing/human-interaction/parallel/sandbox/session-state/identity/local-auth/attachment/memory/skill-source/mcp-source/api-backed-tool smoke tests，验证 request routing 不在 runtime 前置、显式处理约束不绕过 governance、human interaction 使用统一 pending boundary、并行扩展边界不允许隐式 fanout、动态可执行内容必须经过 sandbox gateway boundary、session 状态访问有 owner 边界、owner scope 贯穿关键边界、local auth adapter boundary 不定义具体 endpoint/cookie/ticket、不拥有 request/session/capability state 且只在 local 产品入口中组装、remote/IAM 产品入口不打包 auth-local、首版 local auth 范围收紧为 localhost-only、附件必须经过后端可信处理、记忆生命周期不阻塞 terminal commit、非内置 Skill source 进入统一 catalog、MCP Tool 和 API-backed Tool 不创建第二套 Tool 调用语义。
- [x] 4.8 运行 `npm run build`、`npm run lint:architecture`、`npm test` 和 `npm run test:contract`。
- [x] 4.9 运行 OpenSpec 校验，并检查本 change 没有提前定义具体 Web API、stream payload、runtime state machine、runtime state storage schema、gateway data model、领域对象或前端行为。

## 归档前基线提升检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前基线提升计划”处理：

- 创建 `openspec/specs/ts-backend-architecture/spec.md`。
- 创建 `openspec/overview.md`，建立 NextAgent TS 后端规格源和产品范围说明。
- 创建 `openspec/designs/architecture/ts-backend-architecture.md`。
- 按实际 package skeleton 创建 `openspec/designs/modules/*.md`。
- 创建 `openspec/designs/adr/0001-ts-backend-stack.md`。
- 创建或更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有提前定义 Web API schema、runtime state machine、gateway data model 或领域对象。
