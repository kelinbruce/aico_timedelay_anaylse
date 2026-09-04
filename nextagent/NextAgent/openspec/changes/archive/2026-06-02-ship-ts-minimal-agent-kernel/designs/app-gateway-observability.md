# App、Gateway、Observability 设计

## App Composition

`agent-app` 是唯一 composition root。最小内核启动时装配：

- Fastify server factory。
- `agent-channel-web` submit、SSE、history routes。
- `agent-runtime` command service、timeline service、scheduler、terminal commit service。
- `agent-session` domain services。
- `agent-core` minimal Agent implementation。
- `agent-context-engine` minimal context assembly/render。
- `agent-model` OpenAI provider routing service、credential resolver seam 和 test-only fixture injection seam。
- `agent-capability` read tool catalog/invocation provider。
- local gateway adapter。
- `agent-observability` error normalizer、structured logging helper。
- no-op lifecycle hook、checkpoint store、audit writer。
- `AgentAssemblyRegistry`，由 app 启动时加载/编译 runtime-ready assembly。

Composition 使用显式 factory/constructor 注入，不使用隐藏全局 DI 或运行时动态插件加载。

## Configuration

产品配置使用四个输入面、三个所有权类、用户视角的文件拆分和一个编译出口。TS 版本必须按目标态配置所有权分层落地，而不是把所有字段集中到一个 `SystemConfig`：

```text
packages/agent-app/config/default-system.yaml
packages/agent-app/config/default-agent.yaml
env secret override
  -> agent-app config loaders
  -> app-local validation
  -> internal component options / registries / ports
  -> Resources / ResourceProviders registration
  -> load default-agent AgentDefinition
  -> app-internal AgentAssemblyCompiler
  -> AgentAssemblyRegistry + typed registries
  -> app composition injection
```

### 当前内置配置文件

配置文件拆分的第一目标是降低本地运行包用户的认知负荷并保护系统运行，不是让每个组件拥有自己的外部配置文件。当前 change 尚未进入打包部署和本地运行阶段，唯一落地方案是 `agent-app` 内置两份默认配置文件：

- `packages/agent-app/config/default-system.yaml` 由 `agent-app/config` 读取，承载 active agent id、OpenAI model profile、credentialRef、SQLite local gateway path、local identity、channel/local auth mode、no-op boundary mode 和 workspace root。该文件不得包含 Agent capability binding、Agent workspace、provider raw secret、framework internal wiring 和复杂 adapter implementation detail。
- `packages/agent-app/config/default-agent.yaml` 由 `agent-app/assembly` 读取，承载默认 Agent identity/version、workspace ref、model/prompt refs、capability bindings、runtime settings 和 resource refs。该文件不得包含 SQLite file、channel transport、gateway endpoint、owner identity、provider endpoint/secret 和 component wiring。
- env secret override 只用于 credential 引用解析所需的敏感值；`agent-app` 负责 validation，不把 env key 透传到下游。
- 平台运行数据集中在 `data/system/`：SQLite、附件、归档、HTTP upload temp 等通过元数据按 Agent/session/message/request run 隔离访问，不默认创建 `data/agents/{agentId}`。
- Agent workspace 默认按 default Agent config 的 workspace ref 解析到 `workspaces/default-agent`，用于用户授权的文件读写、命令运行和任务产物；平台管理数据、日志、PID、附件和归档不得默认写入 workspace。

本地运行包的用户可编辑 `config/application.yaml`、`config/agents/default-agent/agent.yaml`、`bin/` 脚本、运行包 zip/staging、前端静态资源托管、完整日志文件管理、PID 管理、附件/归档/upload-temp 初始化和升级保留策略只作为后续 change 目标语义记录，不在本 change 中交付。

本 change 的实现范围只覆盖主路径最小依赖：SQLite local gateway path 必须指向 `data/system`，active Agent definition 必须从 `packages/agent-app/config/default-agent.yaml` 加载，workspace 必须解析和校验，OpenAI profile 必须以 credentialRef 注入。

### 输入面

- `Config`：部署和组件配置输入，只由 `agent-app/config` 读取 `packages/agent-app/config/default-system.yaml` 与 env secret override，并做 runtime schema validation，再转换成内部组件构造参数、typed registries 和 ports。当前最小目标包括 deployment/auth、active agent、trusted roots、OpenAI profile、SQLite local gateway、Fastify channel、no-op boundary mode 和 observability wiring。
- `Resources`：可被 Agent 绑定的资源，包括 model profile、prompt template、capability descriptor、workspace/resource refs。资源存在只表示可发现，不表示某个 Agent 可使用。
- `ResourceProviders`：资源来源注册，包括 built-in read provider、OpenAI model profile provider、内置 Agent config loader。当前不启用 remote provider、MCP、Skill hub 和 dynamic plugin provider。
- `Plugins`：插件只能贡献可发现定义和 provider registration，不得在运行时直接改写 effective Agent assembly。本 change 不实现动态插件加载。

### 所有权类

- 基础设施/adapter 配置的映射归 `agent-app`，组件只接收内部 constructor options 和 factory dependencies，例如 Fastify listen host/port、Kysely/SQLite driver options、OpenTelemetry/Pino wiring、provider HTTP client details。这些不得进入 public `SystemConfig` 和 `AgentDefinition`，组件也不得读取 env/file。
- NextAgent system/component 配置的映射归 `agent-app/config`，组件可以定义内部配置参数类型但不感知配置文件来源，例如 deployment/auth、active agent id、trusted roots、model profile registry、local gateway component config、no-op provider mode。`SystemConfig` 只能作为 app-local validated input 表达这些最小 system facts，不是跨模块 public DTO。
- Agent 业务配置归 `agent-app/assembly`，来源为 `packages/agent-app/config/default-agent.yaml` 和显式测试输入。它不得包含 SQLite file、channel transport、gateway endpoint、owner identity、provider endpoint/secret 和 component wiring。

`AgentDefinition` 是单 Agent 业务配置，必须包含：

- `agentId`、`agentVersion`、`displayName`、`description`。
- `workspaceDir?`，缺省时由 compiler 在 workspace root 下按 agent id 解析。
- `modelProfileIds[]` 和 `promptTemplateIds[]`。
- `capabilityBindings[]`，每个 binding 指向 capability id/type/source，当前产品只启用内置 read。
- `runtimeSettings`：`defaultLanguage?`、`defaultModelProfileId?`、`defaultPromptTemplateId?`、`maxToolIterations?`、`maxContextMessages?`、`requestTimeoutMs?`。
- `resources[]`，资源路径必须相对 `default-agent.yaml` 所在目录解析，并落在受信资源根目录内，不能逃逸到系统路径。

编译规则：

- `agent-app/config` 是内置 default-system 文件、env secret override 到 app-local typed config、内部组件 options、typed registries 和 ports 的唯一入口；runtime、core、context、model、capability、session、gateway、channel、observability 不得读取配置文件和环境变量，也不得知道配置文件路径、env key、merge precedence 和默认文件创建规则。
- `agent-app/assembly` 是 AgentDefinition loader/parser、resource/provider registry coordination、app-internal compiler 和 AgentAssemblyRegistry implementation owner；产品 composition 不得直接构造硬编码 default assembly registry。
- `AgentAssemblyCompiler`、`ResourceInventory` 和 compiler input/output DTO 不作为 downstream public contract 导出；downstream 只能消费编译后的 runtime-safe assembly/registry 或由 owning contract subpath 暴露的窄接口。若 context/core/capability 需要 accepted assembly 信息，必须通过 `agent-contracts/agent-assembly` 获取，不得为了便利依赖 runtime lifecycle contract。
- 资源注册和 Agent binding 分离：注册 model profile、prompt template 和 read descriptor 后，只有被 AgentDefinition 引用并通过 compiler 校验才进入该 Agent assembly。
- 产品路径缺少 `packages/agent-app/config/default-agent.yaml` 时必须 fail closed；runtime、core、context 和 capability 不得合成默认 AgentDefinition。
- 模型选择来自 accepted assembly：优先 `runtimeSettings.defaultModelProfileId`，否则 `modelProfileIds[0]`；被选择 profile 在本 change 中必须是 enabled `OPENAI`。
- 其它 provider kind 和未选 model profile 可以作为 registered resource 存在供后续 change 使用，但不能进入本 change 产品主路径。
- OpenAI-specific env 只能由 app/config adapter 映射为共享 model profile registry；raw credential 只能以 `credentialRef` 进入 profile，不得穿透到 core/runtime/model request。
- 组件内部配置类/参数是 composition input，不是外部配置 contract；测试可以直接构造这些内部参数，但产品路径必须经过 `agent-app` built-in config loader。
- 测试配置可以显式替换 model provider、gateway 和 clock/id generator，但测试替身不得进入产品默认配置，产品配置也不得选择 deterministic/test provider。

## Gateway Adapter

本 change 需要 local gateway 支撑：

- session record read/write。
- session message record write/list/hide。
- current request message record query。
- request run record write/load/list minimal。
- timeline append/stream query。
- active context view minimal read/append with activeContextVersion conflict detection。
- terminal commit record operation。
- checkpoint save no-op 或 local no-op adapter。

Gateway adapter 内部可以使用 Kysely/SQLite，但 store driver、table schema、driver error 和 physical record 不得泄漏到 runtime/session/core/channel。所有查询、stream/list 和写入必须是 async contract。当前 gateway-local 只有 SQLite local atomic persistence transaction，以一致性为先，不承诺事务中途 abort；远程、长耗时或可取消的 Gateway cancellation deferred。

SQLite gateway-local 的唯一实施路径是专用业务表/store，不使用 generic `records(store,key,json)` 承载主路径事实。`request_runs`、`sessions`、`messages`、`active_context_states`、`active_context_items`、`timeline_events` 和 `checkpoints` 必须是独立事实表，显式列出 owner scope 以及主路径需要的 agent/session/request/run 坐标；JSON record 只能作为 row-to-record 映射细节，不能替代列级查询和索引。

幂等 key 采用锚点事实表原则：`sessions.idempotency_key` 保护 session create，`request_runs.idempotency_key` 保护 accepted run create，`messages.idempotency_key` 保护 runtime-owned execution message append，`timeline_events.idempotency_key` 保护 canonical timeline append，`checkpoints.idempotency_key` 保护 checkpoint save，terminal commit 锚定 `request_runs.terminalCommitState` 和 version CAS。RequestRun executing、terminal pending 和 diagnostic failure 是同一 run fact 的 version CAS transition，不使用独立 idempotency key。message append 是 gateway composite write：runtime 只能调用 `SessionMessageStoreGateway.appendSessionMessage`，SQLite 必须在同一个 transaction 内完成 message anchor、session `updatedAt` 和 active context item 更新。terminal commit 也是 gateway composite write：SQLite 必须在同一个 transaction 内完成 run terminal state、terminal message、active context item 和 terminal timeline event 更新。重复 scoped key 返回首次锚点事实结果，不能重复创建 session、重复追加 active context item、重复分配 timeline sequence 或产生第二个 terminal fact。`idempotencyKey` 属于 command/write option，不能进入 gateway `*Record`，但 gateway-local 可以把它作为锚点事实表列保存。本 change 不增加 `operationKind` 或 request hash；独立 idempotency 表/store 不是当前实施路径。

## No-op Boundaries

### Lifecycle Hook

默认 hook provider 是本 change 的显式产品 no-op provider 配置，不是缺失依赖或 test-only stub。它只返回 continue/no-op outcome。Runtime 和 core 在目标 hook points 调用 hook boundary，但首版不执行真实 policy、mutation、degrade、deny 或 pending input，也不得改变 model profile、tools、context、terminal state 或安全决策。

必须覆盖的调用点：

- request acceptance。
- before model invoke。
- before capability invoke。
- before terminal event。

### Checkpoint

`CheckpointStoreGateway.saveCheckpoint` 在以下点被调用：

- run accepted 后或执行开始前。
- before model invoke。
- before capability invoke。
- before terminal commit。

默认 no-op checkpoint provider 是本 change 的显式产品 provider 配置，实现 `CheckpointStoreGateway.saveCheckpoint` public contract，产品路径无副作用，不写 checkpoint record、不提供 lookup/recovery；验收通过 test spy 断言调用坐标和 safe payload。本 change 不提供真实 checkpoint persistence 或 recovery。

### Audit

`AuditEventWriter.write` 在以下事实发生时被调用：

- request accepted。
- capability invoked/completed/failed。
- terminal committed/failed。
- safe security rejection。

默认 no-op audit writer 是本 change 的显式产品 provider 配置，返回成功，产品路径不落库、不保留 ring buffer、不暴露调试读取接口；验收通过 test spy/sink 断言调用。AuditEvent 只包含 safe summary、tenantId、subjectId、requestRunId、capabilityInvocationId 和低敏 attributes。真实 durable audit store 后置。

## Safe Error 和日志

`agent-observability` 提供 `ErrorNormalizer`。所有离开 runtime、channel、model、capability、gateway、hook、checkpoint 和 audit boundary 的 failure 都转换为 SafeError。

日志规则：

- 允许：event name、package/component、sessionId、requestId、runId、agentId、agentVersion、safe error code/category、duration、低基数字段。
- 禁止：prompt、model output、thinking、stream delta、tool arguments、tool result、raw provider error、raw credential、token、附件内容、未脱敏路径、高基数字段 dump。

Provider error 在 adapter 内部归一化；read tool path error 在 capability 内部归一化；gateway driver error 在 gateway adapter 内部归一化。

## Verification

App/gateway/observability 必须提供以下测试入口：

- app composition smoke：产品 composition 使用真实 OpenAI provider factory，不使用 test fixture，且产品配置不能选择 deterministic/test provider。
- test composition smoke：deterministic provider fixture 可注入。
- product-path OpenAI E2E smoke：使用产品 composition、OpenAI adapter、真实 OpenAI endpoint 和 configured `credentialRef` 完成最小问答。
- gateway contract tests：owner-scoped query、current request query、terminal commit CAS。
- gateway-local persistence tests：专用 SQLite 事实表 source assertion、message append composite transaction source assertion、message/timeline/checkpoint 锚点 idempotency、message append active context retry-safety、terminal commit duplicate guard。
- no-op boundary smoke：hook/checkpoint/audit 被主流程调用。
- safe error tests：raw provider error、raw path、tool args/result 不出现在 outward payload。
- architecture lint：Fastify、SQLite/Kysely、provider SDK 不进入 `agent-contracts` 或 core packages。
- dependency-cruiser negative fixture：跨 package private path import 必须触发 `npm run lint:architecture` 失败。
