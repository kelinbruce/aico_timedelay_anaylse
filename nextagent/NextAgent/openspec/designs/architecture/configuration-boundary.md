# Configuration Boundary

## Runtime operational logging freeze

Core app config只接受 `observability.runtimeLogging` 的 level、console/file enabled、trusted directory/name、`maxFileSizeMiB` 和 `retentionDays`。Development默认 console on/file off；LOCAL package默认 console off/file on；test默认 silent；默认 level `info`、100 MiB、daily、7 days。

Frequency/timezone/compression/count/watermark/entry-size/queue/backpressure，以及 audit/metrics mode/path/endpoint/credential/interval/rotation/retention/fallback 均不是用户配置面，出现即 validation failure。LOCAL metrics/audit policy由各 owner冻结；REMOTE OTLP exporter与 remote audit gateway只能由 trusted deployment entrypoint注入，runtime input和请求体不能覆盖。

## Background

This design owns the stable app composition configuration, secret configuration boundary, and local configured authentication facts. Configuration validation runs during startup/bootstrap, outside the request lifecycle. The system may publish ready state and serve traffic only after validation and freeze complete.

`agent-app` owns the only complete configuration fact. Other packages consume narrow projections, public contracts, or injected dependencies; they must not reread config sources, environment variables, secret files, Agent package config, or framework-private config objects to create a second source of truth.

## Decisions

### D1. Configuration Has Three Layers

Configuration is split into framework/runtime config, app composition config, and Agent package config. Framework keys are not re-owned by app composition. Agent package config must not override deployment, channel, gateway, secret policy, model profile, or framework/runtime knobs.

`RawDefaultSystemConfig` is an app-internal source input. `DefaultSystemConfig` is the only complete validated app configuration fact for one process lifecycle and is not exported as a cross-package public contract.

Local sandbox controlled API access 的 `allowedApis` 是 trusted local startup 配置来源：HTTP(S) URL prefix 白名单只来自 frozen app config，runtime input、请求体、模型输出或 Capability 参数不得覆盖；空名单默认拒绝网络访问。该策略是待标准沙箱平台替换的过渡实现（curl 固定 Unix Socket `/opt/sidecar/ir/http.sock` + Python best-effort literal 检查），不建立长期网络隔离决策。

`sandbox.enabled` is a local-only startup projection inside the `sandbox` group. It is optional in source config, defaults to `true`, is frozen into `DefaultSystemConfig.sandbox.enabled`, and can only be set by trusted app composition at startup. When `true` (default), the restricted local sandbox gateway validates Bash requests against its executable denylist only; the builtin `bash` tool never enforces a tool-level executable allowlist or command-specific argument authorization. When `false`, the frozen value switches local Bash execution into trusted shell mode: the adapter skips denylist validation and reconstructs a shell command line from trusted `command + args` tokens. This mode does not bypass the sandbox gateway boundary, host execution ownership, sanitized environment, timeout, cancellation, or output-bound controls.

`packages/agent-app/config/default-system.yaml` is the internal default system configuration source. User `application.yaml` is an overlay source; when supplied, its containing directory defines `configRoot`. The frozen configuration exposes trusted local resource roots for user configuration inputs and `workspaceRoot` for runtime outputs (SQLite, logs, runtime data, and execution workspace state). User configuration may set `paths.workspaceRoot`, `paths.agentRoot`, and `paths.skillRoot`; omitted local resource roots default to `agents` and `skills` relative to `configRoot`. `systemSkillsRoot`, `agentsRoot`, `workingMemorySqliteFile`, `longTermMemorySqliteFile`, `sqliteFile`, `runtimeWorkspaceRoot`, `executionRoot`, and other execution-root path entries are not writable user path entries.

App composition derives `systemSkillsRoot` from `paths.skillRoot`, `agentsRoot` from `paths.agentRoot`, `workingMemorySqliteFile=workspaceRoot/data/system/working-memory.sqlite`, `longTermMemorySqliteFile=workspaceRoot/data/system/long-term-memory.sqlite`, `sqliteFile=workspaceRoot/data/system/nextagent.sqlite`, and `runtimeWorkspaceRoot=workspaceRoot/execution` after path normalization and freeze. `default-system.yaml` declares `paths.agentRoot: "agents"` and `paths.skillRoot: "skills"` so packaged local runtime keeps the default `agents/default-agent/agent.yaml` layout. `runtimeWorkspaceRoot` is the physical base for accepted-run execution roots and must not come from user config, client input, model output, Skill metadata, capability arguments, or gateway responses. Lifecycle hooks are startup-composed hook objects and are not discovered from a derived configuration directory, `hooksRoot`, or manifest source root. Startup validation fails closed if the derived execution root overlaps runtime data, SQLite parent directories, normalized local resource roots, provider-private roots, source-private roots, or resolves outside normalized `workspaceRoot`. Configured local resource roots must also fail closed when they overlap runtime execution, runtime data, SQLite storage, or shared-data roots.

`rag.indexes` remains frozen as a provider-neutral logical index list. Source configuration may use `env:<NAME>` as an app-config-loader input; the loader resolves it before schema validation from either a comma-separated value or JSON string array. Missing or empty overlay env values are ignored so defaults remain effective. Downstream packages receive only the frozen string array and must never receive raw `env:` references.

Framework and reserved capability providers are owner-owned startup contribution facts, not raw system config facts and not app-maintained provider registry rows. `default-system.yaml` and user `application.yaml` must not use raw `capabilityProviders.providers` to declare `builtin-tools`, `builtin-skills`, `builtin-agents`, `local-skills-system`, `local-skills-agent-owned`, `local-agents`, `local-subagents`, `memory-tools`, or any equivalent reserved provider. User provider configuration may only produce validated `ResolvedCapabilityProviders.providers`; `agent-capability` then converts those accepted configs into config-driven provider contributions during subsystem assembly. Reserved provider identities come from owning packages and trusted contribution factories.

The `observability.logging.redaction` field is the only stable field in the `observability` group. It is a string enum with exactly two values: `normal` (default when absent) and `debug`. The built-in `default-system.yaml` carries the default `normal`. User `application.yaml` MAY overlay `debug`. The frozen config preserves the final enum value as the only authoritative logging-mode input for the current process. `debug` mode MUST NOT be interpreted as permission to disable redaction or emit raw sensitive fields.

`nextAgent.memory` is the stable long-term memory configuration namespace. Missing `nextAgent.memory` or `enabled=false` produces a frozen disabled `MemoryConfig`; `enabled=true` with valid fields produces a frozen valid snapshot. Unknown memory fields, owner/identity override fields, invalid search defaults, invalid extraction fields or invalid aging fields fail closed through safe configuration diagnostics. Memory configuration may register only fields owned by memory specs, including `search`, `extraction` and `aging` child groups; it must not introduce `nextAgent.extraction`, `nextAgent.aging`, `promptTemplateIds`, ranking weights, storage driver details, owner scope, Agent scope, hot reload, per-tenant config or independent memory config files.

### D1.1 Capability Result Presentation Is A Frozen App Policy

`nextAgent.system.capability-result-presentation` 是普通 Agent Web Capability 结果的可选启动配置。`agent-app` 先建立内置基线，再用已校验的集成方 exact rule 替换同名 `capabilityId` 或添加扩展 Tool 项；它不使用通配符、Capability 类别、Skill 来源或调用路径匹配。`default-level` 省略时为 `SUMMARY`，唯一合法级别是 `STATUS_ONLY`、`SUMMARY`、`DETAIL`。`rules` 最多 256 项，每项只允许一个 1–128 Unicode code point、大小写敏感的非空 `capability-id` 和一个 `level`；重复 id、`HIDDEN`、未知级别、未知字段或越界输入阻止 ready。

内置基线为：`Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 使用 `STATUS_ONLY`；`AskUserQuestion`、`TodoWrite`、`Cron`、`Rag`、`Bash`、`Python` 使用 `DETAIL`；`Read`、`Write`、`Edit`、`Glob`、`Grep`、`ToolSearch`、`Workflow` 使用 `SUMMARY`。RAG SUMMARY 只携带语言中立召回数量摘要，DETAIL 复用既有 `ragRetrieval` 安全详情。`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 当前没有平台管理的安全成功 projector，因此集成方精确覆盖请求 `SUMMARY` 或 `DETAIL` 时配置级别被接受并冻结，但有效投影仍受平台安全上限收窄为 `STATUS_ONLY`。AskUserQuestion accepted answer 由专用 bounded projector 处理，不被该普通结果级别删除。没有精确规则的扩展 Tool 使用 frozen default level，但没有平台安全 projector 时仍被安全上限收窄为 `STATUS_ONLY`。

`DefaultSystemConfig` 是完整配置 owner；`agent-app` 从中生成私有、深冻结的窄 `CapabilityResultPresentationPolicy { defaultLevel, levelByCapabilityId }`，并通过 channel composition 注入 local configured、trusted product 和 IR Web 注册路径。`agent-channel-common` 只定义/消费窄策略，不读取配置源。该策略不持久化、不热更新，也不能由 request body、Agent package、Capability 参数、Skill metadata、模型输出、前端状态或 Gateway response 覆盖。呈现策略只能收窄平台安全上限，不能开放 raw diagnostics、改变 Message/模型上下文或授权新的 Capability。

### D2. Validation And Freeze Happen Before Ready

`agent-app` validates and freezes configuration before request submit, stream/history/readiness visibility, and runtime/channel/model/gateway/capability serving.

The fixed order is source merge, ownership validation, mandatory group validation, active/inactive branch selection, model profile validation, capability/gateway selector validation, active secret/path/dependency reference validation, safe diagnostic aggregation, readiness decision, and narrow projection freeze.

### D3. ConfigValidationEvidence Is The Only Safe Projection

Readiness and release qualification consume `ConfigValidationEvidence`, not raw config or `DefaultSystemConfig`. Evidence may include readiness state, safe issue codes, safe scope/field references, safe messages, candidate association, and opaque evidence refs. It must not include raw secrets, full secret references, full local paths, provider bodies, framework exceptions, or stacks.

### D4. Secret Checks Are Issue Contributions

`SecretReference` grammar comes from `agent-common` and only allows `env:` and `file:`. Configuration group owners declare credential-bearing entries, active/inactive state, required state, and field ownership. `agent-app` uses one resolver instance for ready-time active reference resolvability and adapter/provider injection.

Secret validation contributes safe issues only. It does not independently decide readiness, create public secret snapshots, create shared secret validation DTOs, create a second resolver, or allow downstream source-config reads.

### D5. Local Auth Is Explicitly Composed

`agent-channel-web-auth-local` serves only localhost local configured authentication. `agent-app` local product bootstrap composes it after frozen config and app-owned secret validation. Default app composition, remote/IAM entrypoints, and `agent-channel-web` must not depend on, register, or bundle auth-local.

Local auth owns login/logout, signed HttpOnly cookie behavior, fixed TTL, restart invalidation, challenge output, safe diagnostics, and trusted `IdentityContext` injection. Authentication failure must not enter runtime, create session facts, create RequestRuns, create messages, handle attachments, touch memory, create pending input, create checkpoints, or invoke capabilities.

### D5.1 Channel Listening Env Overrides And Local Auth Host Guard

`NEXTAGENT_CHANNEL_HOST` 和 `NEXTAGENT_CHANNEL_PORT` 是仅有的两个进程启动监听环境变量，分别独立覆盖 YAML 合并结果中的 `channel.host` 和 `channel.port`。`agent-app` config owner 的 `applyChannelEnvOverrides` 纯函数在既有 env-ref 解析之后、`validateDefaultSystemConfig` 之前被 application config loader 和 local runtime package config loader 共同复用；非法值保持为 schema-invalid 并由既有安全配置诊断在 ready 前阻断启动，不静默回退 YAML 值或默认值，也不产生包含原始环境变量值的新诊断。默认监听地址保持 `127.0.0.1:3000`。

`channel.host` 继续是监听地址的唯一事实：app lifecycle 保持单一 Fastify `listen` 路径，不设置 `ipv6Only`、不建立第二 listener、不新增 `ipFamily` 或全局 HTTP transport 抽象。`::` 的双栈结果依赖主机网络栈允许 IPv4-mapped IPv6 的前置条件。CLI 启动提示把 `::` 与 `0.0.0.0` 一并映射为 `localhost`，IPv6 literal 输出方括号 URL。

Local configured auth（`LOCAL_CONFIGURED_AUTH`）入口在 sync/async product composition 共享的 config 后置检查点拥有 host guard：最终 host 只接受 `localhost`、`127.0.0.1` 或 `::1`，其他值以不包含原始 host 的安全 validation error 在 channel route registration 前阻断。DEFAULT_WEB 入口不应用该限制。首批关键出站路径（模型提供方调用、api-call、task callback）保持默认网络栈行为，由 `network-connectivity` spec 承载 IPv6 literal 可用性契约。

### D6. Trusted Identity Comes Only From Auth Boundary

Protected Web/API/SSE/WS requests pass through auth before business owners. Request body, query, header, or client metadata identity/owner fields must be ignored and cannot override trusted identity.

## Owners

- `agent-app`: config loading, validation/freeze, secret resolver composition, derived runtime path composition including `runtimeWorkspaceRoot`, `ConfigValidationEvidence`, local product branch composition, and passing validated provider config plus owner contribution inputs into `agent-capability`.
- `agent-channel-web-auth-local`: localhost-only local auth adapter.
- `agent-channel-web`: transport and stream projection; consumes trusted identity only.
- `agent-model`, `agent-capability`, and gateways: consume narrow projections or injected dependencies only. `agent-capability` is the only owner that converts validated capability provider config into provider contributions and exposes frozen provider facts back to app ready-gate validation.
- `agent-memory`: consumes frozen memory config or narrow runtime projections only; it must not parse raw app config, environment variables or Agent package files to decide memory behavior.

## Verification

- app config validation/freeze tests
- secret grammar and resolvability tests
- `ConfigValidationEvidence` redaction tests
- local auth integration tests
- route precedence and SSE/WS auth tests
- unauthenticated no-side-effect negative tests
- architecture boundary tests for config source and auth-local imports
- memory configuration tests for disabled/default snapshots, unknown-field rejection, extraction/aging ranges, no prompt-template config path, and consumers using frozen projections only
- Capability result presentation tests for the three legal levels, built-in baseline, exact override, Unicode/count bounds, illegal `HIDDEN`/unknown-field rejection, deep freeze and identical injection into every Web composition path
- channel env override, CLI 地址投影、IPv6/双栈入站和 local auth host guard 真实 socket characterization（见 `network-connectivity`）
- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate --all --strict`

## Documentation

- Specs: `app-config-schema`, `secret-configuration-boundary`, `ts-local-configured-auth`, `lifecycle-hook-execution`, `network-connectivity`
- Main design: `openspec/designs/architecture/configuration-boundary.md`
- Security design: `openspec/designs/architecture/owner-scope-security.md`
- Module designs: `openspec/designs/modules/agent-app.md`, `openspec/designs/modules/agent-channel-web-auth-local.md`, `openspec/designs/modules/agent-channel-web.md`
