## 背景

本分册定义 `ship-ts-minimal-agent-kernel` 的产品化源码目录结构。最小内核虽然只交付一次问答主路径，但交付形态必须能承载后续电信网络智能体能力演进；核心 package 不能把实现集中在单个 `src/index.ts` 中，否则后续 change 会沿用 demo 风格并持续扩大维护风险。

总原则：

- `src/index.ts` 只作为 public barrel，负责导出本 package 对外 API、composition factory 或明确允许的测试夹具入口；不得承载业务流程、状态机、adapter、schema validation 或 gateway 实现。
- package 内部按职责拆分为稳定目录；目录可以很小，但边界必须清楚。
- 跨 package 只能通过 public package export 依赖；不得通过 private path import 依赖其它 package 内部文件。
- 除 `agent-app` composition root、`agent-common`、`agent-contracts`、`agent-test-kit` 和测试/fixture 外，产品 implementation package 不得依赖其它 implementation package；源码 import 和 `package.json` workspace dependency 都必须受 architecture guard 约束。
- 产品 package 只能导入架构授权的 `agent-contracts/<subpath>`，不得从 `@nextagent/agent-contracts` root aggregate import 绕过 subpath allowlist。subpath allowlist 按循环依赖风险和职责边界定义，不按当前实现倒推。
- runtime schema validation、provider SDK、Fastify、Kysely、filesystem 和其它外部边界必须停留在 owning implementation package 的 adapter/schema/store 目录内，不得泄漏到 contracts 或无关 package。
- 测试替身、deterministic provider 和 test-only helpers 必须放在 `testing/` 或测试包中，产品 composition 不得依赖这些入口。

## 跨 Package Contract Subpath Allowlist

| Package | 允许导入的 `agent-contracts` subpath |
|---|---|
| `agent-runtime` | `agent-assembly`, `runtime`, `session`, `gateway`, `observability` |
| `agent-session` | `session`, `gateway` |
| `agent-attachment-runtime` | `attachment`, `gateway` |
| `agent-context-engine` | `agent-assembly`, `context`, `capability`, `model`, `gateway` |
| `agent-core` | `agent-assembly`, `runtime`, `context`, `model`, `capability`, `observability`, `session` |
| `agent-model` | `model` |
| `agent-capability` | `agent-assembly`, `capability` |
| `agent-memory` | none in this change |
| `agent-channel-web` | `channel`, `runtime` |
| `agent-channel-web-auth-local` | none |
| `agent-platform-gateway-local` | `gateway` |
| `agent-platform-gateway-remote` | `gateway` |
| `agent-observability` | `observability` |
| `agent-app` | explicit composition whitelist maintained separately |
| `agent-test-kit` / tests / fixtures | test-only whitelist maintained separately |

新增 `agent-contracts/agent-assembly` 是窄 subpath，只承载本 change 所需的 compiled runtime-safe Agent assembly facts，例如 `AgentAssembly`、`AgentCapabilityBinding`、`AgentRuntimeSettings` 和 `AgentAssemblyRegistry`。它不得依赖 `agent-contracts/runtime`、app/compiler/config contract、gateway/channel/model/capability contract 或 implementation package，也不得成为 Agent execution、raw config 或 app compiler contract 聚合目录。`Agent` 继续属于 `agent-contracts/runtime`，因为它是 runtime 调用 core 的 request execution boundary。

`agent-core` 不得导入 `agent-contracts/gateway`；若 Agent execution 需要追加 assistant tool-use、capability result 或后续其它执行中 message，必须通过 `agent-contracts/runtime` 的 runtime-owned `RunMessagePort.appendMessage(run, context, draft)` 表达。draft 使用 `agent-contracts/session` 的 `SessionMessageDraft` 语义，只包含 message 内容、metadata 和必填 `idempotencyKey`，不包含完整 owner/agent/session/run/timestamp 坐标；runtime 实现负责将 trusted `RequestRun`/`RequestContext` 与 draft 合成 durable session message、gateway record 和 active context append；该 append port 不单独接收 `AbortSignal`。`agent-context-engine` 不得导入 `agent-contracts/runtime` 来取得 lifecycle/assembly 类型；accepted assembly 信息必须通过 `agent-contracts/agent-assembly` 表达，避免 context engine 对 runtime lifecycle 形成概念依赖。

`agent-app` 是唯一 composition root，因此可以显式消费装配所需的多个 contract subpath，但该例外只服务 dependency injection、config validation outcome、registry construction 和 server bootstrap；不得让 app 实现 runtime lifecycle、core orchestration、Web projection、gateway persistence 或 model/capability business semantics。

## 通用目录约定

每个非纯契约 package 的 `src/` SHOULD 遵循以下目录族。不存在对应职责时可以省略，不得创建空目录凑数。

```text
src/
  index.ts
  types.ts
  errors.ts
  schemas/
  ports/
  domain/
  services/
  adapters/
  projections/
  composition/
  testing/
```

- `types.ts`：本 package 自有的轻量类型。跨模块公共契约必须放在 `agent-contracts`。
- `errors.ts`：本 package 拥有的 safe/internal error mapping。
- `schemas/`：不可信边界的 TypeBox/Ajv schema 和 parser。
- `ports/`：本 package 拥有或消费的 adapter-facing SPI local aliases。公共 port 仍以 `agent-contracts` 为准。
- `domain/`：纯领域状态机、invariant、排序、cursor、guard 等无 IO 逻辑。
- `services/`：use-case/application service，组合 domain、ports 和 adapters。
- `adapters/`：Fastify、provider SDK、Kysely、filesystem、HTTP client、auth extraction 等外部依赖胶水。
- `projections/`：stream/history/DTO/event 投影。
- `composition/`：本 package 内部 factory/wiring。全局产品装配仍属于 `agent-app`。
- `testing/`：显式导出的测试夹具；产品代码不得 import。

## 目标 Package 结构

### `agent-app`

```text
src/
  index.ts
  config/
    env.ts
    system-config.ts
    validation.ts
    paths.ts
    component-config.ts
    model-profiles.ts
  composition/
    create-app.ts
    create-product-composition.ts
    create-test-composition.ts
  assembly/
    agent-definition.ts
    agent-definition-parser.ts
    agent-directory-loader.ts
    resource-registry.ts
    resource-provider-registry.ts
    agent-assembly-compiler.ts
    agent-assembly-registry.ts
  server/
    fastify.ts
  auth/
    local-auth.ts
```

`agent-app` 是唯一 composition root。`config/` 负责读取 `packages/agent-app/config/default-system.yaml` 和 env secret override，并转换为 app-local typed config、内部组件 options、typed registries 和 ports；它不得把 Fastify、SQLite、observability、no-op boundary 和 provider adapter 细节合并成跨模块 public `SystemConfig`，也不得让下游组件感知配置文件路径或 env key。`assembly/` 负责 `AgentDefinition` 类型、parser、内置 `packages/agent-app/config/default-agent.yaml` loader、resource registry、resource provider registry、app-internal compiler 和 registry implementation。产品启动必须经 compiler 生成 runtime-ready `AgentAssemblyRegistry`；缺少 `default-agent.yaml` 时产品路径必须 fail closed，runtime、core、context 和 capability 不得合成默认 AgentDefinition，产品 composition 也不得直接创建硬编码 default assembly。产品和测试 composition 必须分离，测试 composition 不得被产品默认路径引用。

### `agent-runtime`

```text
src/
  index.ts
  lifecycle/
    submit.ts
    dispatcher.ts
    cancellation.ts
    lifecycle-hooks.ts
  assembly/
    assembly-binding.ts
  timeline/
    event-port.ts
    sequence.ts
    stream.ts
  terminal/
    terminal-commit.ts
    failure-normalizer.ts
  checkpoints/
    noop-checkpoint-store.ts
  audit/
    audit-calls.ts
```

`agent-runtime` 拥有 request lifecycle、single-run dispatcher、canonical timeline 和 terminal commit。terminal、timeline、dispatcher、checkpoint/audit 调用点必须分文件表达，避免 `index.ts` 成为隐式 lifecycle owner。

### `agent-core`

```text
src/
  index.ts
  agent/
    minimal-agent.ts
    execution-loop.ts
  model/
    model-request-builder.ts
    output-guard.ts
  tools/
    tool-loop.ts
    tool-call-state.ts
    capability-resolution.ts
  timeline/
    core-events.ts
```

`agent-core` 负责 Agent 内部 request routing 和 orchestration。model request flattening、tool loop、output guard 和 timeline authoring 必须可独立审查；core 不得 hardcode read 文件访问。

### `agent-channel-web`

```text
src/
  index.ts
  routes/
    sessions.ts
    requests.ts
    stream.ts
    conversation.ts
  schemas/
    session-dto.ts
    request-dto.ts
    stream-query.ts
    conversation-query.ts
  projections/
    stream-envelope.ts
    history-dto.ts
  auth/
    identity-context.ts
```

`agent-channel-web` 只拥有 transport、runtime command construction 和 stream/history projection。Fastify route、public DTO schema、projection 和 identity extraction 必须分离；public alias 不得进入 runtime/session/core/gateway contract。

### `agent-model`

```text
src/
  index.ts
  providers/
    openai/
      openai-provider.ts
      request-mapper.ts
      stream-normalizer.ts
      tool-use-normalizer.ts
      error-mapper.ts
  credentials/
    credential-resolver.ts
  testing/
    deterministic-provider.ts
```

`agent-model` 隔离 provider SDK、stream normalization、tool-use normalization 和 safe error mapping。OpenAI adapter 的 request mapping、stream normalization、tool-use normalization、credential resolution 和 error mapping 必须拆分；deterministic provider 只能在 `testing/`。

### `agent-capability`

```text
src/
  index.ts
  catalog/
    catalog.ts
    descriptor-resolution.ts
  invocation/
    invocation-service.ts
    input-validation.ts
  builtins/
    read/
      descriptor.ts
      read-capability.ts
      path-guard.ts
      line-slice.ts
```

`agent-capability` 统一承载 Capability 生命周期。catalog、invocation boundary、read descriptor、path guard 和 line slice 必须分离；read 是内置 capability，不是 core 内部 helper。

### `agent-context-engine`

```text
src/
  index.ts
  assembly/
    assemble-context.ts
    active-context-selector.ts
  render/
    render-model-input.ts
    prompt-profile.ts
    telecom-language-rules.ts
  budget/
    window-budget.ts
```

`agent-context-engine` 负责 context assembly、window selection、budget guard 和 prompt shaping。assemble 与 render 必须分离；电信术语保留规则属于 render/prompt shaping，不得散落在 core。

### `agent-session`

```text
src/
  index.ts
  services/
    session-preparation.ts
    history-query.ts
    conversation-query.ts
  mappings/
    gateway-records.ts
    cursors.ts
```

`agent-session` 负责 owner-scoped session preparation 和 history/conversation read model mapping。public DTO alias 不得出现在该 package。

### `agent-platform-gateway-local`

```text
src/
  index.ts
  db/
    kysely.ts
    sqlite-gateway-stores.ts
  stores/
    session-store.ts
    message-store.ts
    request-run-store.ts
    timeline-store.ts
    active-context-store.ts
  mappings/
    records.ts
```

本 package 隔离 local persistence driver。Kysely/SQLite、record mapping 和各 store owner 必须拆分；本 change 是首个未发布版本，SQLite schema 直接按终态建表，不引入 schema migration helper；其它 package 不得依赖这些私有 store 文件。

### `agent-observability`

```text
src/
  index.ts
  errors/
    safe-error.ts
    error-normalizer.ts
  logging/
    redaction.ts
    logger.ts
  audit/
    noop-audit-writer.ts
```

`agent-observability` 负责 safe error、redaction、structured logging helper 和 no-op audit writer。日志脱敏与 error normalization 必须可独立测试。

### `agent-contracts`

```text
src/
  index.ts
  agent-assembly/
  app/
  attachment/
  capability/
  channel/
  context/
  core/
  gateway/
  model/
  observability/
  runtime/
  session/
```

`agent-contracts` 是契约包，不按 service/adapter 分层。每个领域目录的 `index.ts` 可以作为该领域 barrel；contract package 不得依赖 Fastify、Kysely、provider SDK 或 implementation package。`agent-assembly/` 只放 runtime-safe compiled Agent assembly facts，不得成为 Agent execution、raw config 或 app compiler contract 的聚合目录。

`agent-contracts/app` 不得成为启动配置总线。compiler input/output、raw `SystemConfig`、component config DTO、ResourceInventory 和 AgentDefinition parser/loader 细节默认属于 `agent-app` 内部；只有确实需要跨 package 消费的 runtime-safe registry、model profile shape、safe unavailable/degradation shape 等稳定边界才能进入 contracts。

### Minimal Stub Packages

`agent-attachment-runtime`、`agent-memory`、`agent-platform-gateway-remote`、`agent-channel-web-auth-local`、`agent-common` 和 `agent-test-kit` 在本 change 中允许保持小型结构，但必须满足：

- `src/index.ts` 不包含与最小内核主流程无关的半实现。
- 若文件超过约 100 行或包含多个职责，必须按通用目录约定拆分。
- `agent-test-kit` 的测试夹具不得被产品 composition import。

## 验收约束

- 核心 implementation package 的 `src/index.ts` SHOULD remain small public barrels；若超过约 80 行，必须说明为何仍只包含 public exports 或简单 factory exports。
- `agent-runtime`、`agent-core`、`agent-channel-web`、`agent-model`、`agent-capability`、`agent-context-engine`、`agent-session`、`agent-platform-gateway-local` 和 `agent-app` MUST NOT be delivered as single implementation files.
- 重排必须保持 public package exports 兼容；测试应通过 package public exports，而不是改成 private path import。
- 测试归属必须与被验证边界一致：单 package public API、port、adapter、schema 或 helper 行为测试放在对应 `packages/<package>/tests/`；根 `tests/` 只保留 architecture、contract、跨模块 `agent-kernel` characterization、真实 e2e 和 fixtures。
- 根 `tests/agent-kernel/` 只承载需要 app/runtime/core/context/model/capability/session/gateway 组合才能验证的主路径行为；不得把单模块 provider、capability、channel schema 或 runtime helper 测试按 change 范围名塞入该目录。
- `npm run lint:architecture` 必须覆盖跨 package private path import 失败断言，并增加产品代码不得 import `testing/` entry 的规则和 negative fixture。
- `npm run lint:architecture` 必须覆盖两层跨 package 依赖门禁：产品 implementation package 不得横向依赖其它 implementation package；每个产品 package 只能导入 allowlist 中的 `agent-contracts/<subpath>`，且 root aggregate import 必须失败。architecture fixtures 必须包含 representative category-level negative cases，而不是为单个历史符号命名特例。
- `npm run lint:architecture` 或 architecture tests 必须覆盖 `agent-core -> contracts/gateway`、`agent-context-engine -> contracts/runtime`、`agent-contracts` root aggregate import、非 app implementation-to-implementation import 和非 app implementation package manifest dependency 的失败断言。
- 产品化结构重排不得改变本 change 已定义的 Web API、stream event、runtime command、model request、capability invocation、owner scope、safe error 或 terminal consistency 行为。
