## ADDED Requirements

### Requirement: Execution-root exception termination remains owner-scoped

The minimal kernel SHALL assign exception termination to the owner of each execution root rather than to the first catch. `agent-runtime` SHALL own exceptions that terminate an accepted request execution; Web and Task channels SHALL own synchronous transport or pre-acceptance exceptions they convert to a public response; deployment/app lifecycle SHALL own startup and shutdown termination; scheduler/worker owners SHALL own consumed background-attempt failures; executable deployment entrypoints SHALL own process-fatal escape handling.

An intermediate model, capability, context, gateway, composition or lifecycle helper that continues propagation MUST rethrow the same exception or wrap it with the original exception as standard `cause`, and MUST NOT record the exception. SafeError conversion MUST preserve public safety and terminal consistency without exposing the Error or cause chain. This requirement MUST NOT introduce a cross-owner global exception-handler service or exception-logged marker.

#### Scenario: Accepted request failure remains runtime-owned

- **WHEN** an unexpected model, capability or context exception escapes core execution after request acceptance
- **THEN** the lower owner MAY complete its canonical safe failure fact but MUST propagate without printing the exception
- **AND** runtime MUST classify the exception once at the request execution termination boundary
- **AND** runtime MUST continue the existing single safe terminal commit semantics
- **AND** a later terminal commit failure MUST remain a distinct operation and MUST NOT be mislabeled as dispatch or execution failure

#### Scenario: Channel maps only unconsumed boundary failures

- **WHEN** a channel receives a non-INTERNAL domain exception, a boundary-owned schema validation failure, an INTERNAL exception or an unknown exception before accepted-request terminal ownership begins
- **THEN** the channel MUST use its top error handler to preserve the existing safe domain/validation response for the expected cases and produce a safe 500 for the INTERNAL/unknown cases
- **AND** the channel MUST NOT print an exception already converted into a runtime terminal fact

#### Scenario: Startup helper preserves cause for the deployment boundary

- **WHEN** an app composition or listen helper adds stable startup context and rethrows
- **THEN** the wrapper MUST retain the original exception as cause and MUST NOT log it
- **AND** the deployment startup boundary MUST terminate startup and own the single startup exception diagnostic

## MODIFIED Requirements

### Requirement: 最小 Capability Tool 集合
`agent-capability` SHALL 提供最小 Tool catalog 与 invocation 行为；`agent-core` SHALL 通过统一 capability boundary 驱动最小 tool loop。首版产品路径只暴露已启用的内置 `read` 和 `bash` capability，其他 capability 不得进入模型可见工具集或执行路径。`agent-core` 不得 hardcode 文件读取、bash 执行或其他 tool 语义，所有 tool 调用 MUST 通过已治理的 `CapabilityCatalog` / `CapabilityInvocationPort`、routing constraints、risk policy、sandbox boundary 和 safe error handling 执行。

#### Scenario: normal 与 debug 日志都记录 Tool payload
- **WHEN** Tool invocation 产生实际输入或有效输出
- **THEN** tool-loop runtime direct diagnostic MUST 分别通过 canonical `toolInput` 和 `toolOutput` 记录实际输入与已有的有效输出
- **AND** 该行为 MUST NOT 依赖 `rawToolInputLogging`、`rawToolPayloadLogging` 或其它 payload logging flag
- **AND** normal 与 debug diagnostic detail MUST 使用同一行为
- **AND** `toolInputPreview` 和 `toolSafeSummary` MUST 保持安全摘要
- **AND** credential 与认证类 token MUST 由集中 operational writer 窄匹配脱敏
- **AND** 非秘密 prompt、path、command、result content 与正常 credential/token 诊断元数据 MUST 保真并受集中容量边界约束

#### Scenario: 未启用 capability 不进入产品路径
- **GIVEN** 当前产品 assembly 默认启用内置 `read` 和 `bash`
- **WHEN** 模型返回 `write`、Skill tool、remote Agent 或其它未启用 capability/tool call
- **THEN** Agent core MUST NOT execute the tool outside `CapabilityInvocationPort`
- **AND** Runtime/Core MUST publish `DEGRADATION_NOTICE` and end the request with safe `REQUEST_FAILED`
- **AND** logs、stream、history 和 SafeError MUST NOT expose raw tool arguments or host paths

#### Scenario: read 工具遵守 workspace 边界
- **WHEN** read capability 请求读取文件
- **THEN** 工具 MUST 只接受 `file_path` as workspace-relative 单文件路径
- **AND** 绝对路径、路径逃逸、目录读取、glob pattern、权限拒绝、timeout 或 abort MUST 返回 safe capability failure，并导致 request 发布 `DEGRADATION_NOTICE` 后以 `REQUEST_FAILED` 结束
- **AND** 缺失文件或普通 IO failure MAY 作为 safe tool result 交给模型继续生成答复
- **AND** `offset` MUST mean 0-based start line and default to `0`
- **AND** `limit` MUST mean maximum line count and default to `2000`
- **AND** `offset` and `limit` MUST be integers, `offset` MUST be greater than or equal to `0`, and `limit` MUST be between `1` and `2000`; invalid values MUST fail capability input schema validation
- **AND** successful payload MUST 受 line-based `offset`、`limit` 和最大输出大小约束
- **AND** successful payload MUST contain `file_path`、`offset`、`limit`、`content`、`truncated` and optional `nextOffset`
- **AND** successful payload `file_path` MUST be a normalized workspace-relative path and MUST NOT expose host absolute path
- **AND** 超限时 MUST 返回 bounded slice，并显式包含 `truncated=true` 和 `nextOffset`
- **AND** safe failure MUST NOT 泄漏未脱敏宿主路径、credential 或未授权对象内容

#### Scenario: tool loop 按工具危险性分级约束每轮 fan-out 并可恢复
- **GIVEN** Agent core SHALL 把 capability 按是否只读分类：read-only capability 集合为 runtime-owned 静态白名单 `{Read, Grep, Glob}`，其余为 side-effecting capability
- **AND** 模型或 capability provider 的任何断言 MUST NOT 改变该只读分类
- **WHEN** 同一模型 round 产生多个 tool calls
- **THEN** Agent core MUST 按 side-effecting count 与 read-only count 分别计上限
- **AND** 每轮 side-effecting tool call 数 MUST NOT 超过 `maxToolCallsPerRound`（默认 5，上限 5）
- **AND** 每轮 read-only tool call 数 MUST NOT 超过 `maxReadOnlyToolCallsPerRound`（默认 20，上限 20）
- **AND** read-only tool call MUST NOT 计入 `maxToolCallsPerRound` 预算，side-effecting tool call MUST NOT 计入 `maxReadOnlyToolCallsPerRound` 预算
- **AND** `executionMode=model-only` 或 `maxToolCalls=0` 时两个上限 MUST 同时为 0，任何 tool call 都 MUST NOT 执行
- **AND** 当 `maxToolCalls=0`（零工具预算）时，发给模型的请求 MUST NOT 携带任何 tool descriptor（`tools` MUST 为空），使模型在请求层即无法生成 tool call；tool loop 的零预算 guard 仅作为防御性兜底
- **AND** 同一 round 内多个 ordinary tool call MAY 受控并行执行，tool result MUST 按模型返回顺序回填
- **AND** 每个 tool call MUST 有独立稳定 `toolCallId`、capability lifecycle events、result message 和 safe error handling
- **AND** 一个 request 最多执行 `maxToolRounds=50`
- **AND** 当 side-effecting count 或 read-only count 超过其上限时该 round 为 over-limit round，MUST NOT 执行该 round 的任何 tool call
- **AND** over-limit round MUST NOT 持久化无对应 tool result 的 assistant tool-use 消息
- **AND** 当 over-limit 且 `maxToolCalls=0`（零预算）时 Agent core MUST 发布 `DEGRADATION_NOTICE`（code `TOOL_CALL_LIMIT_EXCEEDED`）并以 safe `REQUEST_FAILED` 结束，MUST NOT 重试
- **AND** 当 over-limit 且 `maxToolCalls>0`（正预算）时 Agent core MUST 发布 `DEGRADATION_NOTICE`（code `TOOL_CALL_LIMIT_EXCEEDED`）并追加一条 model-visible 纠正消息后重新进入模型 round，MUST NOT 执行任何 tool call
- **AND** 连续 over-limit round 计数 MUST 累加；任意一轮正常执行 tool call 后 MUST 将该计数清零
- **AND** 连续 over-limit round 计数达到 `toolCallLimitRecoveryLimit=3` 时 Agent core MUST 以 safe `REQUEST_FAILED` 结束
- **AND** capability `contextPatch`、动态修改 allowed tools、model name 或 model options MUST NOT 在本 change 生效

#### Scenario: accepted assembly 未显式配置 round limit 时使用统一 fallback
- **WHEN** accepted assembly 未提供 `runtimeSettings.maxToolIterations` 且 `DefaultAgent` 未注入 `deps.maxToolRounds`
- **THEN** tool loop round limit MUST fall back to `50`
- **AND** 该 fallback MUST 与产品默认 builtin agent 的 `maxToolIterations` 保持一致
- **AND** 达到该上限时 MUST 发布 `DEGRADATION_NOTICE` with `TOOL_ROUND_LIMIT_EXCEEDED` 并以 safe `REQUEST_FAILED` 结束

### Requirement: Productized Package Module Structure

最小内核 SHALL 以产品化 TypeScript 后端 package 结构交付。核心 implementation package MUST NOT 将主流程实现集中在单个 `src/index.ts` 中；`src/index.ts` SHALL serve as a public barrel or explicitly documented lightweight factory export only. Package 内部目录结构 SHALL follow `openspec/designs/architecture/ts-backend-architecture.md` 的开发视图和对应 `openspec/designs/modules/<module>.md` 的模块设计，unless a package is explicitly classified as a minimal stub package by those stable designs.

#### Scenario: Product implementation packages depend only through common, authorized contracts and narrow foundations

- **WHEN** product implementation packages other than `agent-app` declare workspace dependencies or import cross-package code
- **THEN** they MUST NOT depend on another product implementation package
- **AND** cross-module business collaboration MUST use `agent-common` and explicitly authorized `agent-contracts/<subpath>` public exports only
- **AND** `agent-local-file-roll` MAY be classified by the stable architecture as a Node-only technical foundation rather than a product implementation package
- **AND** only `agent-log`, `agent-observability` and `agent-platform-gateway-local` MAY depend on that foundation for rolling-file mechanics
- **AND** that exception MUST NOT carry business contracts, output-domain vocabulary or implementation-to-implementation collaboration and MUST NOT be generalized to another package without a later OpenSpec change
- **AND** this guard MUST cover both TypeScript source imports and `package.json` workspace dependency declarations
- **AND** `agent-app` MAY depend on implementation packages only as the composition root, and that exception MUST NOT be available to other packages
- **AND** tests, fixtures and `agent-test-kit` MAY have a separate test-only dependency policy

#### Scenario: Contract subpath imports follow architecture allowlist

- **WHEN** a product package imports `@nextagent/agent-contracts/<subpath>`
- **THEN** the imported subpath MUST be present in the package-specific allowlist defined by `openspec/designs/architecture/ts-backend-architecture.md` and the corresponding `openspec/designs/modules/<module>.md`
- **AND** product code MUST NOT import from the `@nextagent/agent-contracts` root aggregate export
- **AND** the allowlist MUST be based on architecture ownership and cycle prevention, not on the subpaths currently imported by implementation code
- **AND** runtime-safe Agent assembly facts MUST be imported from `agent-contracts/agent-assembly`, not from `agent-contracts/runtime`
- **AND** `agent-contracts/agent-assembly` MUST NOT contain `Agent`, `AgentDefinition`, compiler/loader/parser types, raw config, provider credential, gateway config or channel config
- **AND** `agent-core` MUST NOT import `agent-contracts/gateway`
- **AND** `agent-context-engine` MUST NOT import `agent-contracts/runtime`
- **AND** `agent-channel-web` MUST import only channel/runtime contracts and MUST NOT import session、gateway、model or capability contracts
- **AND** gateway adapter packages MUST import only gateway contracts
- **AND** model packages MUST import only model contracts
- **AND** capability packages MAY import only capability and agent-assembly contracts
- **AND** any new contract subpath consumption MUST require updating the OpenSpec design and architecture tests before implementation

#### Scenario: 核心 package 不以单文件实现交付

- **WHEN** 开发者检查 `agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local` 和 `agent-app`
- **THEN** each package MUST organize implementation under responsibility-specific directories such as lifecycle、timeline、terminal、agent、tools、routes、schemas、providers、catalog、assembly、services、stores or composition according to `openspec/designs/architecture/ts-backend-architecture.md` and the corresponding `openspec/designs/modules/<module>.md`
- **AND** `src/index.ts` MUST NOT contain request lifecycle implementation、Agent execution loop、Fastify route registration logic、provider SDK calls、capability read implementation、context render logic、gateway store implementation or schema validation bodies
- **AND** preserving all public package exports MUST be part of the refactor acceptance

#### Scenario: 测试夹具和产品 composition 分离

- **WHEN** product composition is built
- **THEN** it MUST NOT import deterministic/test provider、test gateway、test clock/id generator or test-only helpers from `testing/` entries
- **AND** deterministic/test helpers MAY be exported only through explicit `testing/` package entries or test-kit packages
- **AND** unit, contract and characterization tests MAY use those testing entries without introducing cross-package private path imports

#### Scenario: Architecture guard prevents demo-style regression

- **WHEN** `npm run lint:architecture` runs
- **THEN** it MUST fail on cross-package private path imports
- **AND** it MUST fail when product code imports another package's `testing/` entry
- **AND** it MUST fail when an unauthorized package depends on `agent-local-file-roll`, when the foundation imports common/contracts/implementation packages, or when pino-roll/SonicBoom/zlib rolling lifecycle escapes that foundation
- **AND** it MUST include a guard that the core implementation packages listed in this requirement are not delivered as single implementation files
- **AND** productized module restructuring MUST NOT change Web API behavior、stream event vocabulary、runtime command shape、model invocation shape、capability invocation shape、owner scope、safe error handling or terminal consistency

#### Scenario: Architecture and contract guards preserve the session scope boundary

- **WHEN** Web session create, session list, conversation history, convenience submit and session-scoped submit tests run
- **THEN** Web API observable behavior MUST preserve owner+agent isolation, reject client-supplied owner/agent fields, and expose only public Web DTO fields
- **AND** runtime public-boundary tests MUST show accepted session/run facts are scoped by trusted identity and trusted Agent Scope without accepting client-provided Agent Scope
- **AND** session public contract tests MUST expose only domain session objects/read models and MUST NOT expose Web DTO aliases, gateway records or gateway-local rows
- **AND** gateway public contract tests MUST require owner+agent scoped session/message/active-context record/query shapes
- **AND** architecture tests MAY use representative category-level negative fixtures for forbidden cross-package dependencies, runtime-internal resolver leakage, DTO/Record boundary leakage and product-path test fixture leakage
- **AND** these architecture/source assertions MUST correspond only to architecture boundaries or forbidden patterns and MUST NOT lock down private call order, helper names, directory internals or individual historical symbol names
