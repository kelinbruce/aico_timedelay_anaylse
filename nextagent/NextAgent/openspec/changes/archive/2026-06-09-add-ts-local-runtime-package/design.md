## 背景和现状（Context）

TS 后端首版需要一个本地单实例运行包作为可交付形态。现有 changes 已经分别定义了 app configuration、secret boundary、gateway configuration、health/metrics、release qualification 等能力，但这些能力都假设存在一个可识别、可启动、可验证的 release candidate。

`harden-ts-local-runtime-release` 负责判定 candidate 是否具备发布资格；本 change 负责定义 candidate 对应的本地运行包产物边界。两者必须分开：运行包提供证据，release qualification 消费证据并给出 verdict。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义首版本地运行包的最小产物集合和目录职责。
- 定义首版最终用户交付物：一个可分发 zip，解压后在 Node.js 环境中通过用户启动脚本运行。
- 定义启动/停止入口、配置样例、版本 manifest 和 candidate evidence。
- 定义运行包如何接入 app configuration freeze、secret boundary、release/package E2E gate 和 release qualification。
- 定义运行时目录的安全边界，避免用户数据、平台数据、日志、PID 和 workspace 混放。
- 定义运行包缺失关键证据时必须阻断 release qualification。

**非目标：**

- 不定义 PaaS、NetGraph 或多实例服务部署。
- 不定义安装器、系统服务注册、自动升级、回滚工具、GUI 配置器或 Node.js runtime 捆绑。
- 不把开发启动命令、测试 fixture 或未声明源码工作区进程视为 release candidate evidence。
- 不定义 runtime request lifecycle、terminal commit、stream projection、model invocation 或 capability invocation。
- 不重新定义 app configuration schema、secret grammar、health/readiness 业务语义或 release qualification verdict。
- 不定义 Agent package assembly 字段全集或 Skill/Agent source 发现语义。
- 不定义 `with-frontend` 的前端 npm 包产物 contract、静态资源 route registration、route precedence、前端版本锁步或前端 package evidence；这些由 `refine-ts-fullstack-packaging-boundary` 拥有。

## 设计决策（Decisions）

### D1. 本地运行包是 release candidate 的唯一产物来源

首版本地 release candidate 必须由本地运行包 zip 和其中的 manifest 标识。zip 是最终用户拿到的交付物，zip 解压后的根目录就是 candidate root。manifest 至少描述 candidate identity、version、build time、entrypoint、config sample refs、package layout version、package archive ref 和 evidence refs。release qualification 不从散落的构建日志、临时目录或人工说明推断 candidate identity。

选择这个方案，是为了让 release qualification 有稳定输入，并避免“拿当前工作区启动一下”或“内部 staging 目录证据成立”被误认为最终用户可运行的可发布 candidate。

### D2. 运行包目录采用固定职责分区

运行包必须提供稳定职责分区：

- `bin/`：启动、停止和基础自检入口；
- `config/`：app composition 配置样例和 Agent 配置样例入口；
- `backend/`：已构建的 TS 后端 app 产物；
- `data/`：本地持久化数据根；
- `logs/`：运行日志根；
- `run/`：PID、临时运行状态和进程级状态；
- `workspaces/`：用户授权的 Agent 工作区根。

上述目录名是首版运行包 contract 的固定用户可见语义，不允许替换为等价目录名或 manifest 自定义映射。实现可以在各固定目录内部选择私有文件布局，但不能让上层模块依赖 adapter-private 路径。

### D3. 配置样例只表达可启动的 app composition 输入

运行包随附配置样例必须覆盖首版 app configuration 稳定组，并能够被 startup validation 确定性处理。配置样例不得携带 raw secret；credential-bearing 字段只能使用 grammar-valid、非敏感的示例 `env:` / `file:` reference，例如 `env:NEXTAGENT_OPENAI_API_KEY`，不得使用空值、`CHANGE_ME`、`none` 或其他 reference 外占位。

配置样例本身只是输入；实际 candidate startup 产生的唯一 `ConfigValidationEvidence` 才是 readiness/release 配置证据。`READY` 可继续，`DEGRADED_READY` 只能在 release qualification 已批准对应 declared degradation 时继续，`BLOCKED` 必须阻止 candidate evidence handoff 和 release qualification。

运行包不让 Agent package 配置反向覆盖 deployment、gateway credential policy、channel transport 或 framework/runtime knob。

### D4. 启动入口只负责本地单实例启动

首版运行包只承诺本地单实例启动。启动入口必须读取运行包内配置样例或用户提供的同形配置，初始化必要目录，启动 app composition，并暴露 health/readiness 入口。停止入口必须能够终止由同一运行包启动的本地进程，并清理 `run/` 下的进程级状态。

首版用户启动面固定为“解压 zip -> 配置环境变量 -> 双击启动脚本”。运行包必须提供可双击的用户启动脚本，并保留命令行等价启动方式。脚本必须从解压后的包根解析 `bin/`、`config/`、`backend/`、`data/`、`logs/`、`run/` 和 `workspaces/`，不得依赖源码工作区、全局 npm workspace、开发 server、构建临时目录或当前 shell 的工作目录偶然值。

首版用户配置面只要求 Node.js runtime 和三个 OpenAI 环境变量：`OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL`。配置样例必须把 provider credential、model name 和 base URL 映射到这些 env refs。缺失任一必需 env 时，启动必须 fail closed 并输出 safe startup/config diagnostic；不得静默降级为 fake provider、test provider、默认外部 endpoint 或 no-op model。

本 change 不要求热加载配置；配置变更仍然遵循 restart-scoped app configuration。

### D5. Package profile is declared here, fullstack serving is refined elsewhere

运行包 manifest 可以声明 `backend-only` 或 `with-frontend` package profile。`backend-only` 是本 change 的基础候选形态，必须提供 API、health/readiness 和 release qualification 可消费的基础 evidence。`with-frontend` 只表示候选运行包还会携带 fullstack packaging refinement 定义的前端 package evidence；前端 npm 包 contract、静态资源托管、route precedence 和前端版本一致性不在本 change 内重新定义。

### D6. 运行包定义 evidence handoff，真实执行 evidence 由 release/package E2E gate 生成

运行包拥有 manifest、layout check 和正式启动/停止入口，并定义 `PackageCandidateEvidence` 的 handoff shape。`add-ts-e2e-release-package-gate` 必须从实际 candidate root 调用正式入口，捕获该启动产生的唯一 `ConfigValidationEvidence` opaque ref，并生成真实 startup 与 health/readiness evidence refs。release smoke 只由 `add-ts-e2e-product-journey-gate` 产生，不进入 package evidence。所有 evidence 都不是 request truth、checkpoint、timeline event、memory record 或用户可见会话历史。

`PackageCandidateEvidence` 的唯一代码 owner 固定为 `packages/agent-app/src/packaging/package-candidate-evidence.ts`，并通过 `@nextagent/agent-app/packaging` public subpath 暴露。该模块只拥有最小 handoff schema、TypeScript type、base evidence 创建、E2E execution refs 合并和 handoff validation。正式 pack flow 调用它创建 base evidence；release/package E2E gate 只通过 public subpath 调用它补齐真实 execution refs；`qualify()` 只接收其 validation 成功结果。三方不得使用跨包 private path，也不得复制同名 DTO、schema 或 validation；不得扩展成 generic evidence registry、runner adapter 或发布治理平台。

### D7. Manifest and evidence use a minimal safe shape

The local runtime package manifest has one minimal shape for implementation and tests: `candidateId`, `version`, `buildTime`, `entrypointRefs`, `configSampleRefs`, `layoutVersion`, `packageProfile`, `packageArchiveRef`, and `evidenceRefs`. `packageProfile` is limited to `backend-only` or `with-frontend`. `packageArchiveRef` identifies the produced zip artifact with a safe package/evidence ref and never points to a source workspace or temporary staging directory as the candidate artifact. This change owns the profile declaration and base package evidence shape; `refine-ts-fullstack-packaging-boundary` owns additional `with-frontend` artifact and hosting evidence. Manifest refs are package-relative safe refs or opaque evidence refs; they never expose unredacted absolute local paths, temporary build paths, raw secrets, provider payloads, stack traces, or adapter-private filesystem layout.

Package candidate evidence has one mandatory set for release handoff: package manifest, layout check result, `configValidationEvidenceRef`, startup proof, and health/readiness proof. `configValidationEvidenceRef` MUST be an opaque safe ref to the exact `ConfigValidationEvidence` produced by the actual candidate startup; no package or gate module may define or parse a second config validation evidence shape. Package validation owns manifest/layout base evidence and validates the `PackageCandidateEvidence` handoff shape; for `configValidationEvidenceRef` it validates only presence and candidate association. `add-ts-e2e-release-package-gate` owns capture of the actual candidate's `configValidationEvidenceRef` and production of the real startup/health refs. A configuration-blocked candidate cannot produce a passed startup proof and therefore cannot complete handoff. Only the `agent-app` release input builder resolves `configValidationEvidenceRef`; neither package validation nor the E2E gate emits a release verdict.

### D8. Startup and stop failures stay package-local and safe

Startup failure, stale PID state, unreadable health/readiness proof, missing app artifact, blocked startup configuration, or port unavailability produce safe package evidence failures. Stop logic only targets the process state recorded by the same runtime package and may clean only process-level state under `run/`; it does not delete `config/`, `data/`, `logs/`, or `workspaces/`.

## 关键流程（Key Flow）

本 change 的主流程是从“构建本地运行包 candidate”到“向 release qualification 提供可消费 evidence”的闭环：

1. 构建本地运行包 candidate：生成 `backend/` app artifact、固定运行包目录、启动/停止入口、配置样例和必要占位目录。
2. 打包 zip：将固定运行包目录作为 zip 根目录，产出最终用户可分发 zip；解压后的根目录必须等同于 candidate root。
3. 生成 package manifest：写入 candidate identity、version、build time、entrypoint refs、config sample refs、layout version、package archive ref 和 evidence refs。
4. 执行 package layout check：验证启动入口、配置样例、app artifact、数据目录、日志目录、进程状态目录和 workspace 根具备且职责分离。
5. 校验配置样例：使用随包配置进入 startup configuration validation fixture，确保配置组齐备，credential-bearing 字段只使用 grammar-valid 示例 reference，并映射 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL`。
6. 启动本地单实例：在解压后的 candidate root 中通过 `bin/` 用户启动入口启动 candidate，初始化必要目录，由 `agent-app` 完成配置 validation/freeze、生成唯一 `ConfigValidationEvidence`，并通过固定窄投影完成 app composition。
7. 交给 release/package E2E gate：从实际 zip 解压目录调用正式启动入口，捕获该 candidate 的 opaque `configValidationEvidenceRef`，并生成 startup 与 health/readiness evidence refs。
8. 校验 handoff evidence：将 manifest、layout check、`configValidationEvidenceRef` 与 E2E gate 生成的 startup/health refs 汇总为完整 `PackageCandidateEvidence`；缺少任一 mandatory ref、candidate 关联不一致或 configuration-blocked startup 无法产生 passed startup proof 时 handoff 无效。package/E2E 不解引用 config evidence。
9. 产出 package evidence handoff：这些 evidence 只作为发布诊断输入。
10. 如果 profile 为 `with-frontend`，由 `refine-ts-fullstack-packaging-boundary` 补充前端 package、静态托管和 route precedence evidence；本 change 只要求基础运行包 evidence 完整。
11. 交给 release qualification：`harden-ts-local-runtime-release` 消费完整且已校验的 `PackageCandidateEvidence`、四类 gate 结果和 baseline，并输出 release verdict。
12. 停止本地实例：通过 `bin/` 停止入口终止同一运行包启动的本地进程，清理 `run/` 下进程级状态，不删除 `config/`、`data/`、`logs/` 或 `workspaces/` 中的持久内容。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 配置样例不得包含 raw secret；workspace 不得指向运行包系统目录；manifest 和 diagnostics 不暴露本地绝对路径、raw credential 或 provider payload。 | secret scan、package layout negative tests、startup diagnostics tests |
| 性能/容量 | 打包本身不定义 SLA；运行包必须提供 release qualification 可消费的 baseline evidence ref。 | package evidence contract test、release qualification integration test |
| 可靠性/恢复 | 启动入口必须初始化缺失的运行目录且不覆盖用户数据；停止入口只处理同一运行包进程级状态。 | package startup/stop integration test、idempotent directory initialization test |
| 可维护性 | 运行包只定义产物边界，不重新定义 app config、gateway、health 或 release qualification。 | architecture review、dependency boundary check |
| 可测试性 | manifest、layout、config sample、startup proof 和 candidate evidence 都有 deterministic test fixture。 | contract tests、smoke tests |
| 审计/可追溯性 | manifest 和 evidence refs 可追溯到 candidate，但不成为业务事实。 | release evidence tests、diagnostic redaction tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 运行包 manifest 标识 candidate identity | 1.1, 2.1 | package manifest contract tests |
| zip 解压后可作为最终用户 candidate root 启动 | 1.1b, 2.0, 2.4 | zip extraction startup smoke tests |
| 运行包目录职责固定 | 1.2, 2.2 | package layout tests |
| 配置样例满足 app config 和 secret boundary | 1.3, 2.3 | startup config sample validation tests |
| 三个 OpenAI env 构成首版最小用户配置面 | 1.3a, 2.3a | env configuration startup tests |
| 启动/停止入口支持本地单实例 | 1.4, 2.4 | local package startup/stop integration tests |
| `with-frontend` profile 不由本 change 定义静态托管细节 | 2.5 | spec review / fullstack boundary handoff check |
| evidence 被 release qualification 消费但不成为业务事实 | 2.6, 3.2 | release qualification candidate evidence tests |
| 关键流程从 package build 到 qualification evidence 闭环 | 1.5, 2.6, 4.2 | package flow integration test / code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/local-runtime-package/spec.md`
- 发布资格前置：`openspec/specs/local-runtime-release/spec.md`
- 跨模块架构：`openspec/designs/architecture/local-runtime-packaging.md`
- 配置边界：`openspec/designs/architecture/configuration-boundary.md`
- 模块职责：`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-platform-gateway-local.md`
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 运行包 change 膨胀为发布治理平台。-> 本 change 只定义产物和 candidate evidence，verdict 仍由 `harden-ts-local-runtime-release` 负责。
- [风险] 配置样例与 app config schema 漂移。-> 运行包配置样例必须作为 startup validation fixture 被测试。
- [风险] 运行包升级覆盖用户数据。-> 打包产物不得要求覆盖 `config/`、`data/`、`logs/`、`workspaces/`；升级策略只在文档中保留保守边界，具体升级工具后置。
- [风险] 运行包 change 与 fullstack packaging change 重复定义 `with-frontend`。-> 本 change 只定义 profile 字段和基础 evidence；前端 package、静态托管和 route precedence 由 `refine-ts-fullstack-packaging-boundary` 拥有。
- [风险] workspace 指向系统目录导致能力越权。-> startup validation 必须拒绝指向运行包系统目录的 workspace。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/local-runtime-package/spec.md`：新增本地运行包行为契约。
- `openspec/specs/local-runtime-release/spec.md`：补充 candidate package evidence 前置关系。
- `openspec/overview.md`：补充首版本地运行包交付形态。
- `openspec/designs/architecture/local-runtime-packaging.md`：新增运行包架构边界。
- `openspec/designs/architecture/configuration-boundary.md`：补充运行包配置样例关系。
- `openspec/designs/modules/agent-app.md`：补充运行包启动入口和 candidate evidence 职责；静态资产托管由 fullstack packaging refinement 补充。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充运行目录消费职责。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。首版压缩格式固定为 zip；安装器、系统服务注册、自动升级机制、GUI 配置器和 Node.js runtime 捆绑不属于本 change。
