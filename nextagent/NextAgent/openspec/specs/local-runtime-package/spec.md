# local-runtime-package Specification

## Purpose
TBD - created by archiving change add-ts-local-runtime-package. Update Purpose after archive.
## Requirements
### Requirement: Local runtime package is a user-runnable platform artifact

系统 SHALL 将首版本地运行包交付为按 OS/arch 明确分发的可解压 artifact。Windows x64 artifact 文件名 MUST be `nextagent-local-{datetime}-win32-x64.zip`。Linux x64 artifact 文件名 MUST be `nextagent-local-{datetime}-linux-x64.tar.gz`。该 artifact 的解压根目录 MUST be the release candidate root consumed by package validation, release/package E2E gate, and release qualification. 系统 MUST NOT 把源码工作区、内部 staging 目录、开发 server 或临时构建目录当作最终用户可运行 package candidate。

打包流程 MUST 在 package manifest 中记录 `platform`、`arch` 和 `nodeVersion`。`platform` MUST identify the target OS used to create the package. `arch` MUST identify the target CPU architecture. `nodeVersion` MUST identify the Node.js runtime version used by the pack flow. 首版受控分发目标为 `win32-x64` 和 `linux-x64`；不支持的 OS/arch MUST fail closed rather than emitting an ambiguous universal package.

首版最终用户运行前置条件 SHALL be Node.js installed on the local machine. 本 change MUST NOT require an installer, system service registration, GUI configurator, global npm workspace, source checkout, development server, or bundled Node.js runtime.

随包出厂配置样例 MUST NOT 绑定 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL` 环境变量引用。模型 provider 接入参数（`baseUrl` 和 `credentialRef`）的提供由本机配置 overlay 承担，缺省时按 `model-invocation-contract` 的未配置 provider 语义处理。`OPENAI_MODEL_NAME` 不受本约束影响。

每个被暂存到候选包的本地 runtime workspace package MUST 保留其 `package.json.exports` 中运行时 `import` 与 `require` target 指向的全部文件。归档生成后，pack flow MUST 从新解压的 artifact root 执行正式 package self-check 或等价启动验证；验证 MUST 覆盖 package-relative module resolution，且不得以源码工作区或内部 staging 目录替代。`pack:release` 的 `skip` 参数只能跳过发布 E2E gate，MUST NOT 跳过本 requirement 的暂存完整性校验或解压启动验证。

#### Scenario: Candidate starts from extracted artifact
- **WHEN** 用户解压本地运行包 artifact 到本机目录
- **AND** 本机已安装 Node.js
- **AND** 用户通过配置 overlay 提供了模型 provider 接入参数（合法 `baseUrl` 与 `credentialRef`）和 `OPENAI_MODEL_NAME`
- **AND** 用户双击随包启动脚本
- **THEN** candidate MUST start from the extracted package root
- **AND** startup MUST use package-relative `bin/`, `config/`, `backend/`, `data/`, `logs/`, `run/`, and `workspaces/` paths

#### Scenario: 出厂配置未注入模型接入参数
- **WHEN** 用户解压本地运行包 artifact 且未通过配置 overlay 提供模型 provider 接入参数
- **AND** 随包出厂配置样例未绑定 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL`
- **THEN** candidate MUST 启动成功并进入 `DEGRADED_READY`
- **AND** 模型目录相关条目 MUST 为 `UNAVAILABLE` 且 `unavailableReason=MODEL_PROVIDER_NOT_CONFIGURED`
- **AND** 模型调用 MUST 返回安全 model-unavailable failure
- **AND** 安全诊断 MUST 只含相关 `providerId` 和安全 code，MUST NOT 包含 raw secret、endpoint 或本地路径

#### Scenario: Nested runtime export is omitted from staged package
- **WHEN** 本地 runtime workspace package 的 `package.json.exports` 指向嵌套运行时文件，且该文件未被暂存到候选包
- **THEN** pack flow MUST fail before creating a successful candidate artifact
- **AND** safe diagnostic MUST identify the package name and missing package-relative export target

#### Scenario: Skip mode still validates extracted package startup
- **WHEN** operator runs `npm run pack:release -- skip`
- **THEN** pack flow MUST create and extract the OS-targeted archive into an isolated validation root
- **AND** it MUST execute the formal package self-check or equivalent startup validation from that extracted root
- **AND** it MUST fail when package-relative module resolution cannot load a staged runtime export
- **AND** it MUST skip only the release E2E gate

#### Scenario: Internal staging directory is not sufficient release evidence
- **WHEN** 内部 staging 目录可以启动，但 artifact 解压后的 package root 缺失启动脚本、backend artifact、配置样例或固定目录
- **THEN** package validation MUST reject the candidate
- **AND** release/package E2E gate MUST NOT treat the internal staging result as final user-runnable evidence

#### Scenario: Windows package is built
- **WHEN** pack flow runs for `win32-x64`
- **THEN** it MUST create `nextagent-local-{datetime}-win32-x64.zip`
- **AND** manifest MUST record `platform=win32`, `arch=x64`, and the pack Node.js version

#### Scenario: Linux package is built
- **WHEN** pack flow runs for `linux-x64`
- **THEN** it MUST create `nextagent-local-{datetime}-linux-x64.tar.gz`
- **AND** manifest MUST record `platform=linux`, `arch=x64`, and the pack Node.js version

### Requirement: Local runtime package identifies the release candidate

系统 SHALL 将首版本地运行包视为本地 release candidate 的权威产物来源。每个本地运行包 MUST 提供稳定的 package manifest，用于标识 candidate identity、版本、构建时间、启动入口、配置样例引用、layout version 和发布资格 evidence 引用。

release qualification MUST NOT 从临时构建目录、人工备注、开发启动进程或未声明的源码工作区状态推断 candidate identity。

Package manifest MUST expose a stable minimal shape:

- `candidateId`
- `version`
- `buildTime`
- `entrypointRefs`
- `configSampleRefs`
- `layoutVersion`
- `packageProfile`
- `platform`
- `arch`
- `nodeVersion`
- `packageArchiveRef`
- `evidenceRefs`

`packageProfile` MUST be `backend-only` or `with-frontend`. This local runtime package contract owns the profile declaration and base package evidence shape. `with-frontend` frontend package artifacts, UI asset route registration, route precedence, frontend package version evidence, and frontend hosting manifest validation MUST be defined by `fullstack-packaging-boundary`, not by this local runtime package contract. Manifest refs MUST be package-relative safe refs or opaque evidence refs. `packageArchiveRef` MUST identify the produced zip artifact using a safe package/evidence ref and MUST NOT point to a source workspace or temporary staging directory as the candidate artifact. Manifest refs MUST NOT expose unredacted absolute local paths, temporary build paths, raw secrets, raw provider payloads, stack traces, or adapter-private filesystem layout. Package manifest is a release candidate artifact owned by the local runtime package boundary; it is not a request, session, runtime timeline, checkpoint, memory, model, capability, gateway, or user-visible conversation fact.

#### Scenario: Release qualification receives package candidate identity
- **WHEN** 本地运行包被提交给 release qualification
- **THEN** qualification 输入包含来自 package manifest 的 candidate identity
- **AND** qualification 不需要读取源码工作区状态来识别 candidate

#### Scenario: Missing package manifest blocks candidate use
- **WHEN** 本地运行包缺少 package manifest 或 manifest 中的 candidate identity
- **THEN** 系统 MUST 将该产物视为无效 release candidate

#### Scenario: Unsafe package manifest ref is rejected
- **WHEN** package manifest contains an unredacted absolute local path, temporary build path, raw secret, provider payload, stack trace, or adapter-private filesystem layout as a manifest ref
- **THEN** package validation MUST reject the candidate with a safe diagnostic
- **AND** release qualification MUST NOT consume that candidate as valid package evidence

### Requirement: Local runtime package has a stable responsibility layout

本地运行包 SHALL 提供固定目录职责分区，使启动、配置、本地数据、日志、进程状态和工作区边界可被验证。运行包 MUST 提供以下目录：

- `bin/`：启动、停止和基础自检入口；
- `config/`：app composition 配置样例和 Agent 配置样例入口；
- `backend/`：已构建的 TS 后端 app 产物；
- `data/`：本地持久化数据根；
- `logs/`：运行日志根；
- `run/`：PID、临时运行状态和进程级状态；
- `workspaces/`：用户授权的 Agent 工作区根。

运行包目录职责 SHALL NOT 替代 gateway、session、runtime、attachment 或 observability 的业务 owner。上层模块 MUST NOT 依赖 adapter-private 文件路径作为跨模块契约。

The first-release package MUST NOT replace these directories with equivalent names or a manifest-defined directory mapping. Layout customization is allowed only inside each fixed responsibility directory.

本地运行包 SHALL 把每个 packaged Agent definition 只暂存到 `agents/{agentId}/agent.yaml`。pack flow MUST NOT 暂存或保留重复的 `config/default-agent.yaml` Agent definition；startup MUST 通过已验证的 system configuration 和该 `agents/` root 选择 active Agent，MUST NOT 从 config-side duplicate 推断或覆盖已选 Agent。

#### Scenario: Package layout can be checked before startup
- **WHEN** 对本地运行包执行 layout check
- **THEN** 系统能够验证启动入口、配置样例、app artifact、数据目录、日志目录、运行状态目录和 workspace 根是否具备

#### Scenario: Runtime data and workspace are not collapsed into one directory
- **WHEN** 运行包初始化本地目录
- **THEN** 平台持久化数据、日志、进程状态和用户 workspace 保持职责分离

#### Scenario: Packaged default Agent starts without a config duplicate
- **WHEN** pack flow 创建包含 `default-agent` 的本地运行包
- **THEN** package MUST 包含 `agents/default-agent/agent.yaml`
- **AND** MUST NOT 包含 `config/default-agent.yaml`
- **AND** startup MUST 从 packaged `agents/` root 解析 active Agent

### Requirement: Package configuration samples are startup-validatable

本地运行包 SHALL 随附至少一套首版本地 deployment 配置样例。该配置样例 MUST 覆盖 app configuration 首版稳定配置组，并且 MUST 能被 startup configuration validation 确定性处理。

配置样例 MUST NOT 携带 raw secret、inline credential、未允许的 secret source 或 reference 外占位。Credential-bearing 字段 MUST 使用 grammar-valid、非敏感的示例 `env:` / `file:` reference，并由 startup validation 在 active branch 中判定。

首版 zip 交付的最小用户配置面 SHALL be Node.js plus `OPENAI_MODEL_NAME`。模型 provider 接入参数由本机配置 overlay 提供，package 配置样例 MUST NOT 绑定 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL`。缺失的必需配置值 MUST 按所属配置域 fail closed；provider 接入参数缺失时按 `model-invocation-contract` 的未配置 provider 降级语义处理。Startup MUST NOT silently fall back to a fake provider, test provider, default external endpoint, no-op model, or source-workspace configuration.

#### Scenario: Configuration sample is validated before ready
- **WHEN** 使用运行包随附配置样例启动 candidate
- **THEN** app configuration validation 在 ready state 发布前完成
- **AND** 下游模块只消费从冻结配置派生的 owner-defined 窄投影
- **AND** readiness/release 配置证据只使用该启动产生的 `ConfigValidationEvidence`

#### Scenario: Raw secret in package configuration is rejected
- **WHEN** 运行包配置样例包含 raw secret 或 inline credential
- **THEN** startup validation MUST 返回 safe validation failure
- **AND** 诊断中不得暴露 raw secret

#### Scenario: Package sample does not bind OpenAI access environment variables
- **WHEN** 用户解压本地运行包 artifact
- **THEN** package 配置样例 MUST NOT 使用 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL` 作为默认绑定
- **AND** provider 接入参数缺失时 candidate MUST 按 `DEGRADED_READY` 启动，并把相关模型目录条目标记为 `UNAVAILABLE`

### Requirement: Local release packages stage developer diagnosis defaults in package configuration only

Backend-capable local release packages SHALL stage developer diagnosis defaults only inside the package candidate. `pack:release` SHALL add the `developer-hook-trace` plugin declaration to the packaged config sample and the matching hook activation to the packaged default Agent. These generated package defaults SHALL NOT mutate repository source Agent definitions or non-packaged local development defaults.

#### Scenario: Developer hook trace defaults are limited to local package staging
- **WHEN** local `pack:release` stages a backend-capable package
- **THEN** the packaged `config/default-system.yaml` MUST declare the local `developer-hook-trace` plugin path
- **AND** the packaged `agents/default-agent/agent.yaml` MUST activate the trace hook
- **AND** the repository built-in default Agent source MUST remain unchanged by packaging.

### Requirement: Package entrypoints start and stop one local instance

本地运行包 SHALL 提供可验证的启动入口和停止入口。启动入口 MUST 启动一个本地单实例 TS 后端 candidate，初始化必要运行目录，并暴露 health/readiness 可消费的启动证明。停止入口 MUST 只终止由同一运行包启动并可识别的本地进程，并清理进程级运行状态。

本地运行包 MUST provide a user-facing double-click startup script and an equivalent command-line startup path. The startup script MUST resolve all package paths from the extracted package root and MUST NOT require the operator to run from a source checkout, install monorepo workspace dependencies, start a development server, or manually edit YAML before first startup when the required OpenAI environment variables are present.

本地运行包 MUST NOT 把普通开发命令、测试 fixture 或未声明源码工作区进程当作 release candidate 启动入口。

#### Scenario: Candidate starts from package entrypoint
- **WHEN** operator 使用运行包启动入口启动 candidate
- **THEN** 系统启动本地单实例服务
- **AND** health/readiness 能够读取该 candidate 的启动证明

#### Scenario: Double-click startup uses package root
- **WHEN** operator double-clicks the package startup script from the extracted zip
- **THEN** startup MUST resolve configuration, backend artifact, logs, run state, data, and workspace paths from the extracted package root
- **AND** startup MUST NOT depend on the current source workspace or build machine path

#### Scenario: Stop entrypoint does not target unrelated processes
- **WHEN** operator 使用运行包停止入口
- **THEN** 停止逻辑只作用于该运行包记录的本地进程级状态

#### Scenario: Startup failure produces safe candidate evidence failure
- **WHEN** package entrypoint cannot start because the configured port is unavailable, the app artifact is missing, startup configuration is blocked, or health/readiness proof cannot be read within the startup boundary
- **THEN** startup MUST produce a safe startup proof failure
- **AND** the candidate MUST NOT be treated as valid startup evidence
- **AND** diagnostics MUST NOT expose raw local paths, raw secrets, provider payloads, stack traces, raw prompts, raw model outputs, or raw tool results

#### Scenario: Stale process state is not treated as a running candidate
- **WHEN** `run/` contains stale PID or process state that does not identify a live process started by the same runtime package
- **THEN** startup and stop logic MUST NOT treat that stale state as an active candidate
- **AND** stop cleanup MAY remove only process-level state under `run/`
- **AND** stop cleanup MUST NOT delete `config/`, `data/`, `logs/`, or `workspaces/` content

### Requirement: Runtime directories remain separated by responsibility

本地运行包 SHALL 对运行时路径执行确定性校验。workspace 路径 MUST 被限制在用户授权工作区边界内，且 MUST NOT 指向运行包的 `config/`、`data/`、`logs/`、`run/`、app artifact 目录或通过路径穿越进入这些系统目录。

#### Scenario: Workspace points to package system directory
- **WHEN** 配置将 workspace 指向运行包系统目录或通过路径穿越进入系统目录
- **THEN** startup validation MUST reject that configuration with a safe validation failure

### Requirement: Fullstack package profile is delegated to fullstack packaging boundary

本地运行包 MAY declare `with-frontend` package profile, but this contract SHALL NOT define frontend package artifact contract, frontend asset route registration, frontend route fallback, route precedence, frontend package version evidence, or frontend hosting manifest validation. Those requirements SHALL be defined by `fullstack-packaging-boundary`.

本地运行包 declared as `backend-only` MUST remain a valid release candidate shape and MUST provide API and health/readiness startup evidence without requiring frontend package artifacts.

#### Scenario: With-frontend profile is declared by package manifest
- **WHEN** 本地运行包 manifest declares `with-frontend`
- **THEN** local runtime package validation MUST preserve the profile declaration and base package evidence
- **AND** frontend artifact and route evidence MUST be supplied by `fullstack-packaging-boundary`

#### Scenario: Backend-only package remains a valid candidate shape
- **WHEN** 本地运行包明确声明为 backend-only package
- **THEN** release qualification 可以使用其 API 和 health/readiness evidence 判断 candidate

### Requirement: Package evidence feeds release qualification without replacing it

本地运行包 SHALL 定义 release qualification 可消费的 `PackageCandidateEvidence` handoff shape，并产出 package manifest 与 layout check。实际 candidate startup MUST 由 `agent-app` 生成唯一 `ConfigValidationEvidence`；`add-ts-e2e-release-package-gate` MUST 从实际 candidate root 调用正式 package entrypoint，捕获该 evidence 的 opaque `configValidationEvidenceRef`，并生成真实 startup proof 与 health/readiness proof。release smoke evidence 由 `add-ts-e2e-product-journey-gate` 独立产生，不属于 `PackageCandidateEvidence`。该 evidence 只作为发布诊断输入，不是 request truth、runtime timeline event、checkpoint、memory record 或用户可见会话历史。

`PackageCandidateEvidence` type、TypeBox runtime schema、base evidence creation、execution evidence merge 和 handoff validation MUST have one implementation owner at `packages/agent-app/src/packaging/package-candidate-evidence.ts`, exposed through `@nextagent/agent-app/packaging`. Pack flow, release/package E2E gate, and release qualification MUST use that public owner surface and MUST NOT use a cross-package private path or define competing evidence DTOs or validators.

The mandatory package candidate evidence set MUST include package manifest, layout check result, `configValidationEvidenceRef`, startup proof, and health/readiness proof. `configValidationEvidenceRef` MUST reference the exact `ConfigValidationEvidence` produced by the actual candidate startup and MUST NOT reference a package-defined or gate-defined alternative configuration evidence shape. Package and gate modules MUST treat the ref as opaque and validate only its presence and candidate association. Missing mandatory evidence, candidate identity mismatch, or inability to produce a passed startup proof MUST make the package candidate invalid for release qualification input. This invalid candidate outcome is a package evidence validation result; it MUST NOT produce `QUALIFIED`, `QUALIFIED_WITH_DECLARED_DEGRADATIONS`, or `BLOCKED` release verdict.

Package validation MUST NOT synthesize startup or health/readiness success refs without actual candidate execution. `add-ts-e2e-release-package-gate` owns those real-execution evidence refs and MUST NOT produce a release verdict. Release smoke is independently owned by `add-ts-e2e-product-journey-gate`.

`harden-ts-local-runtime-release` SHALL 继续拥有 release qualification verdict。运行包 evidence MUST NOT 自行声明 candidate 为 `QUALIFIED`、`QUALIFIED_WITH_DECLARED_DEGRADATIONS` 或 `BLOCKED`。

#### Scenario: Complete package evidence enters qualification
- **WHEN** package validation 和 release/package E2E gate 共同提供完整 manifest、layout、配置、启动和 health evidence
- **THEN** release qualification 可以继续执行固定检测流程

#### Scenario: Missing mandatory package evidence blocks handoff
- **WHEN** package candidate evidence is missing manifest, layout check, `configValidationEvidenceRef`, startup proof, or health/readiness proof
- **THEN** package evidence validation MUST mark the candidate invalid for release qualification handoff
- **AND** package evidence validation MUST NOT emit a release qualification verdict

#### Scenario: Blocked configuration evidence prevents handoff
- **WHEN** the actual candidate startup produces `ConfigValidationEvidence` with `readinessState=BLOCKED`
- **THEN** the candidate MUST NOT produce a passed startup proof or complete package evidence handoff
- **AND** package and gate modules MUST NOT resolve, replace, or reinterpret the configuration evidence

#### Scenario: Package evidence does not produce verdict by itself
- **WHEN** 本地运行包完成构建、layout check 或启动 proof
- **THEN** 系统不得仅凭这些 evidence 输出 release qualification verdict

### Requirement: Package diagnostics are safe and non-authoritative

本地运行包 validation、startup proof 和 evidence diagnostics MUST 只输出安全摘要和可追溯 evidence references。诊断中 MUST NOT 暴露 raw secret、raw provider payload、未脱敏本地绝对路径、stack trace、raw prompt、raw model output 或 raw tool result。

这些 diagnostics 不是业务事实，MUST NOT 被写入用户会话历史、request terminal result、canonical timeline 或 memory record。

#### Scenario: Package validation fails safely
- **WHEN** 运行包 validation 发现缺失配置、非法目录或启动入口不可用
- **THEN** 系统输出 safe diagnostic 和 evidence reference
- **AND** 不泄露 raw secret、未脱敏本地绝对路径或 stack trace

### Requirement: Local runtime package preserves operational logs through one size-or-daily file family

Backend-only and with-frontend profiles SHALL use logical base `logs/nextagent-operational.log.jsonl`. pino-roll SHALL create the corresponding numbered `.jsonl` family and rotate when either 30 MiB or the fixed process-local-midnight daily boundary is reached. Runtime diagnostic and observation-derived entries MUST share the family and remain distinguishable by `surface`.

AuditEvent MUST flow through the `agent-contracts/gateway`-owned write-only AuditEventStoreGateway to the separate `logs/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson[.gz]` family and MUST NOT appear in operational logs or SQLite. MetricSample MUST remain in the metrics pipeline and MUST NOT appear in operational console, active files or archives; the OTel periodic exporter SHALL append cumulative aggregates to the separate `logs/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]` family. The package MUST NOT create legacy `nextagent-runtime.log`, `nextagent-observability.log`, unversioned logger-mirrored `nextagent-audit.log` or an `audit_events` SQLite table.

#### Scenario: Package writes one operational file family

- **WHEN** a local package starts with built-in defaults
- **THEN** non-audit operational logs MUST use the numbered `nextagent-operational.log.<sequence>.jsonl` family
- **AND** exactly one segment MUST be transport-owned and active
- **AND** audit/metrics MUST use their separate output contracts
- **AND** audit/metrics MUST use their own active destinations and exact ownership selectors
- **AND** operational-log maintenance MUST NOT discover, compress or age audit files

### Requirement: Local runtime package writes audit to an independent file gateway

Backend-only and with-frontend LOCAL profiles SHALL select top-level `GatewayBindings.audit` from `agent-platform-gateway-local`. The gateway SHALL append one versioned complete AuditEventRecord line to the active `logs/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson` segment. It SHALL rotate at fixed 30 MiB or the process-local daily boundary, atomically gzip closed segments, age its own closed source/archive after fixed 7 elapsed days from original `closedAt` and keep at most 10 committed gzip archives. It MUST NOT create/query SQLite audit storage, mirror audit through RuntimeLogger, or reuse an operational/metrics writer or handle; it SHALL use its own audit policy and independent `agent-local-file-roll` handle.

Audit retention SHALL be implementation-owned and non-configurable. Startup reconciliation and hourly audit maintenance SHALL delete only expired, exactly selected audit closed source/archive files; they MUST preserve active, young, symlink, unknown, outside and other-family files. The maximum target audit window SHALL be one daily active period plus 7 elapsed days of closed retention and one hourly maintenance interval. Audit retries MAY produce duplicate complete lines with the same trusted scoped auditId; the package MUST NOT build a hidden SQLite/index sidecar to claim exactly-once.

#### Scenario: Local package appends audit evidence

- **WHEN** a representative audit observation is projected
- **THEN** the active audit NDJSON segment MUST contain one complete versioned AuditEventRecord entry
- **AND** no audit copy may appear in operational/metrics output or any SQLite table
- **AND** package business results MUST remain unchanged if the append degrades

#### Scenario: Local package rotates an audit segment

- **WHEN** the audit segment reaches 30 MiB, crosses local midnight or commits an eleventh gzip archive
- **THEN** the local audit gateway MUST continue on a new sequence
- **AND** the closed source MUST be atomically gzip archived
- **AND** audit maintenance MUST preserve the committed archive until its original closedAt reaches 7 elapsed days and then delete it during the next hourly run
- **AND** successful maintenance MUST keep no more than 10 committed audit gzip archives

### Requirement: Local runtime package preserves seven days of periodic metrics history

Backend-only and with-frontend LOCAL profiles SHALL compose the shared OTel MeterProvider and PeriodicExportingMetricReader with `LocalMetricHistoryExporter`. Every successful 60-second collection SHALL append one complete `NextAgentMetricSnapshotV1` cumulative JSON line to the active `logs/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson` segment. Test/package validation MAY trigger `forceFlush` instead of waiting for the real interval.

The metrics family SHALL use fixed 30 MiB or process-local daily rotation, use that same process-local date for `YYYY-MM-DD`, gzip closed segments, apply closedAt-based 7 elapsed-day retention and keep at most 10 committed gzip archives. Elapsed retention and count cleanup SHALL be independent deletion conditions. It SHALL remain physically and logically separate from the operational family: `agent-log` SHALL own operational schema/policy and its roll handle, while `LocalMetricHistoryExporter` SHALL independently own metrics schema/policy and another roll handle. They MAY share only `agent-local-file-roll` mechanism code and MUST NOT share runtime state or handles. The package MUST NOT start or require Prometheus, append raw samples, create one file per minute or expose metrics file policy as runtime user configuration.

#### Scenario: Local package exposes metrics through a file

- **WHEN** package validation records representative counter and histogram data and forces a successful export
- **THEN** the active metrics NDJSON segment MUST contain one valid line with cumulative aggregated points
- **AND** it MUST NOT contain operational log envelope fields, raw MetricSample history or forbidden correlation/content
- **AND** no Prometheus endpoint may be required

#### Scenario: Local metrics history remains bounded and queryable by file

- **WHEN** collections span multiple intervals, a daily boundary, the 30 MiB threshold or an eleventh committed gzip archive
- **THEN** complete snapshots MUST remain ordered in the active/closed metrics family for at least 7 days
- **AND** closed segments MUST be gzip archives and a single day MAY have multiple numbered segments
- **AND** a successful interval MUST append a line rather than create a new file
- **AND** successful maintenance MUST keep no more than 10 committed metrics gzip archives

#### Scenario: Metrics history export fails

- **WHEN** serialization, enqueue, write, rotation, gzip or retention fails
- **THEN** already committed complete metrics lines and archives MUST remain readable when present
- **AND** package business readiness and request results MUST remain unchanged

### Requirement: Local runtime package compresses owned closed segments and ages them after seven days

The package default SHALL disable operational console, enable async operational file logging and set the operational size threshold to 30 MiB, fixed process-local-midnight daily rotation, retention 7 elapsed days and `maxArchiveFiles=10`. Operational, plugin diagnostic, metrics and audit families SHALL each use a 30 MiB size threshold, the Node.js process-local timezone fixed for the process lifetime for daily boundaries/file dates and at most 10 committed gzip archives. Expiration remains based on each segment's original `closedAt + retentionDays * 24h`; plugin diagnostic uses fixed `retentionDays=3`, metrics and audit use fixed `retentionDays=7`, and operational uses its frozen default or valid configured values. Every maintenance owner MUST ignore the other families and MUST NOT process active, young closed source, symlink, data/run/config/workspace or unknown files.

Startup MUST reconcile stale temp, eligible closed source and expired archive. Running maintenance MUST scan for archive work at least once per minute and age expired closed source/archive at least hourly. Low traffic MUST NOT leave a segment active beyond its daily rotation period.

#### Scenario: Package rotates by size

- **WHEN** active operational file reaches 30 MiB before the daily boundary
- **THEN** it MUST rotate and continue writes in a new segment
- **AND** the closed source MUST enter gzip maintenance

#### Scenario: Package rotates low-volume logs daily

- **WHEN** active file remains below 30 MiB through the process-local midnight boundary
- **THEN** it MUST rotate anyway
- **AND** the prior segment MUST become eligible for gzip and retention

#### Scenario: Package crosses a daylight-saving daily boundary

- **WHEN** the controlled Node.js process-local timezone crosses midnight on a 23-hour or 25-hour calendar day
- **THEN** operational, metrics and audit families MUST rotate according to that local calendar boundary
- **AND** each file date MUST use the same local calendar
- **AND** closed source/archive expiration MUST still require 7 elapsed 24-hour periods

#### Scenario: Package ages expired archives

- **WHEN** a closed source or archive reaches 7 days
- **THEN** running maintenance MUST delete it during the next hourly run
- **AND** an item expiring while stopped MUST be deleted by startup reconciliation

### Requirement: Local package logging failure is non-fatal

Operational transport initialization or runtime maintenance failure MUST NOT prevent package business readiness or alter request outcomes. The package MAY emit one bounded emergency stderr diagnostic per logging degradation transition, but MUST NOT fall back to synchronous per-entry stderr/file output.

#### Scenario: Package file sink cannot initialize

- **WHEN** the configured operational file transport fails during startup
- **THEN** package business readiness MUST remain unchanged
- **AND** no logger-owned shutdown may be initiated
- **AND** a bounded emergency diagnostic MAY identify the logging subsystem failure without path or raw error

### Requirement: Release evidence exposes all three effective local file policies

Release validation SHALL expose operational logical base, numbered segment pattern, console/file defaults, async destination, 30 MiB threshold, fixed process-local daily rotation, gzip policy, elapsed retentionDays and maxArchiveFiles; top-level write-only `agent-contracts/gateway` audit binding, audit file pattern/version/30 MiB/process-local daily/gzip/at-most-10/fixed 7-day retention/no-SQLite/duplicate policy; local metrics family pattern/schema/60-second interval/30 MiB/process-local daily/gzip/at-most-10/7-day policy; plugin diagnostic 30 MiB/process-local daily/gzip/at-most-10/3-day policy; shared `agent-local-file-roll` mechanism with four independent handles/selectors and metric-log absence.

#### Scenario: Release candidate proves logging separation

- **WHEN** release-package validation inspects a candidate
- **THEN** it MUST verify operational writer policy and size/daily retention behavior
- **AND** it MUST verify audit uses the independent gateway-owned NDJSON family with fixed 7-day aging and no SQLite audit table/query exists
- **AND** it MUST verify LOCAL metrics use the rolling `nextagent-metrics.*.ndjson[.gz]` family through the OTel file exporter and are not copied to operational logs

### Requirement: Runtime package logs identify the deployed candidate

LOCAL and REMOTE runtime package entrypoints SHALL derive operational and metric `serviceVersion` from the trusted candidate manifest version and candidateId. The result MUST be bounded and safe for the operational envelope and OTel resource; an overlong candidateId MUST use a stable short hash. Package startup MUST NOT leave every candidate reporting the same hard-coded product version.

#### Scenario: Two package candidates share a product version

- **WHEN** two candidates have the same manifest version but different candidateId values
- **THEN** their derived serviceVersion values MUST differ
- **AND** each value MUST remain stable across restarts of the same candidate
- **AND** no host path, build workspace or credential may be included

### Requirement: Local package CLI output is explicit and content-bounded

The start ready notice and generated self-check command SHALL be explicit local-runtime CLI interactions rather than operational diagnostics. `agent-app` product source MUST NOT use scattered `console.*`; one local-runtime CLI output module SHALL own direct stdout/stderr writes. The ready notice MAY contain only an app-owned template plus validated display host and port. A failed self-check MUST emit only an allowlisted diagnostic code and fixed package-relative evidence reference, MUST catch validation/layout exceptions, and MUST NOT emit diagnostic messages, config values, host paths, stack traces or credentials.

#### Scenario: Self-check rejects a config containing sensitive text

- **WHEN** the generated self-check command evaluates an invalid package config whose validation failure contains a credential, path or arbitrary message canary
- **THEN** stderr MUST contain only stable diagnostic codes and package-relative evidence refs
- **AND** the command MUST exit non-zero without a raw exception stack
- **AND** generated entrypoint source and agent-app product runtime source MUST NOT use `console.*`

### Requirement: Model Gateway-only package excludes OpenAI-compatible provider implementation

打包流程 MAY 在操作者显式选择 `model-gateway-only` 模式时生成模型能力受限的本地 runtime package。该 package MUST 在 package manifest 中声明 `modelProviderProfile="model-gateway-only"`；gateway-only TypeScript build MUST 不把 OpenAI-compatible provider invocation implementation 源文件纳入编译输入，且 package MUST 从 runtime 内容中排除该实现和 `@ai-sdk/openai-compatible` runtime dependency。默认 package MUST 继续包含 OpenAI-compatible provider invocation capability。

`model-gateway-only` package 的 staging 或 self-check MUST 在生成成功候选前验证配置能力兼容。任一 `openai-compatible` model profile 出现在配置样例或启动配置中时，packaging/self-check MUST fail closed 并产生安全诊断 code `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE`；MUST NOT 生成可启动但首次模型调用才缺件的候选，MUST NOT 静默忽略该 profile，也 MUST NOT 把该 provider 显示为 `UNAVAILABLE` 代替构建能力错误。配置只包含 `model-gateway` 且其余启动前置条件满足时，package self-check MUST 按现有本地 runtime package 契约执行。

**需求类别**：系统质量属性
**质量属性**：可维护性
**适用范围**：`FN-4.1 调用模型`

#### Scenario: 默认 package 保持既有能力
- **WHEN** 操作者构建默认 `backend-only` 或 `with-frontend` package
- **THEN** package manifest 不声明 `model-gateway-only` 模型能力
- **AND** package 包含 OpenAI-compatible provider invocation capability 和对应 runtime dependency

#### Scenario: 构建 model-gateway-only package
- **WHEN** 操作者显式选择 `model-gateway-only` 打包模式
- **AND** 配置样例只包含 `model-gateway` provider profile
- **THEN** package manifest 声明 `modelProviderProfile="model-gateway-only"`
- **AND** gateway-only TypeScript build 不把 OpenAI-compatible provider invocation implementation 源文件纳入编译输入
- **AND** package 不包含 OpenAI-compatible provider invocation implementation 文件
- **AND** package 不包含 `@ai-sdk/openai-compatible` runtime dependency

#### Scenario: model-gateway-only package 配置不兼容
- **WHEN** `model-gateway-only` 打包模式的配置包含 `openai-compatible` provider profile
- **THEN** staging 或 self-check 在成功候选生成前 fail closed
- **AND** 诊断只暴露安全 code 与 provider identity
- **AND** 系统不生成首个模型调用才失败的候选

#### Scenario: 排除文件破坏 runtime export
- **WHEN** provider 排除导致 package manifest 声明的 runtime export 或依赖缺失
- **THEN** pack flow MUST fail before archive
- **AND** 诊断标识缺失的 package/export/dependency
