## ADDED Requirements

### Requirement: Local runtime package is a user-runnable platform artifact

系统 SHALL 将首版本地运行包交付为按 OS/arch 明确分发的可解压 artifact。Windows x64 artifact 文件名 MUST be `nextagent-local-{datetime}-win32-x64.zip`。Linux x64 artifact 文件名 MUST be `nextagent-local-{datetime}-linux-x64.tar.gz`。该 artifact 的解压根目录 MUST be the release candidate root consumed by package validation, release/package E2E gate, and release qualification. 系统 MUST NOT 把源码工作区、内部 staging 目录、开发 server 或临时构建目录当作最终用户可运行 package candidate。

打包流程 MUST 在 package manifest 中记录 `platform`、`arch` 和 `nodeVersion`。`platform` MUST identify the target OS used to create the package. `arch` MUST identify the target CPU architecture. `nodeVersion` MUST identify the Node.js runtime version used by the pack flow. 首版受控分发目标为 `win32-x64` 和 `linux-x64`；不支持的 OS/arch MUST fail closed rather than emitting an ambiguous universal package.

首版最终用户运行前置条件 SHALL be Node.js installed on the local machine. 本 change MUST NOT require an installer, system service registration, GUI configurator, global npm workspace, source checkout, development server, or bundled Node.js runtime.

#### Scenario: Candidate starts from extracted artifact
- **WHEN** 用户解压本地运行包 artifact 到本机目录
- **AND** 本机已安装 Node.js
- **AND** 用户配置了 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL`
- **AND** 用户双击随包启动脚本
- **THEN** candidate MUST start from the extracted package root
- **AND** startup MUST use package-relative `bin/`, `config/`, `backend/`, `data/`, `logs/`, `run/`, and `workspaces/` paths

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

#### Scenario: Package layout can be checked before startup
- **WHEN** 对本地运行包执行 layout check
- **THEN** 系统能够验证启动入口、配置样例、app artifact、数据目录、日志目录、运行状态目录和 workspace 根是否具备

#### Scenario: Runtime data and workspace are not collapsed into one directory
- **WHEN** 运行包初始化本地目录
- **THEN** 平台持久化数据、日志、进程状态和用户 workspace 保持职责分离

### Requirement: Package configuration samples are startup-validatable

本地运行包 SHALL 随附至少一套首版本地 deployment 配置样例。该配置样例 MUST 覆盖 app configuration 首版稳定配置组，并且 MUST 能被 startup configuration validation 确定性处理。

配置样例 MUST NOT 携带 raw secret、inline credential、未允许的 secret source 或 reference 外占位。Credential-bearing 字段 MUST 使用 grammar-valid、非敏感的示例 `env:` / `file:` reference，并由 startup validation 在 active branch 中判定。

首版 zip 交付的最小用户配置面 MUST use exactly these required OpenAI environment variables for first startup: `OPENAI_API_KEY`, `OPENAI_MODEL_NAME`, and `OPENAI_BASE_URL`. The package configuration sample MUST map model provider credential, model name, and base URL to those env refs. Missing required env values MUST block startup with a safe configuration diagnostic. Startup MUST NOT silently fall back to a fake provider, test provider, default external endpoint, no-op model, or source-workspace configuration.

#### Scenario: Configuration sample is validated before ready
- **WHEN** 使用运行包随附配置样例启动 candidate
- **THEN** app configuration validation 在 ready state 发布前完成
- **AND** 下游模块只消费从冻结配置派生的 owner-defined 窄投影
- **AND** readiness/release 配置证据只使用该启动产生的 `ConfigValidationEvidence`

#### Scenario: Raw secret in package configuration is rejected
- **WHEN** 运行包配置样例包含 raw secret 或 inline credential
- **THEN** startup validation MUST 返回 safe validation failure
- **AND** 诊断中不得暴露 raw secret

#### Scenario: Missing OpenAI environment variable blocks startup
- **WHEN** 用户从解压后的 zip 启动 candidate，但 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME` 或 `OPENAI_BASE_URL` 任一缺失
- **THEN** startup validation MUST return a safe blocked configuration result
- **AND** candidate MUST NOT be treated as started or release-package ready

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
