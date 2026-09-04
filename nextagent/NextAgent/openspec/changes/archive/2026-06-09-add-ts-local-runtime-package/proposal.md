## 背景与问题（Why）

TS 后端架构已经把首版本地交付形态定义为“本地单实例运行包”，但当前 active changes 只覆盖了配置、secret、gateway、health、release qualification 等相邻边界，还没有一个独立 change 回答：

- 本地运行包的 candidate identity 从哪里来；
- 运行包至少包含哪些可启动产物、配置样例、目录和脚本；
- 运行包如何初始化本地数据、日志、运行状态和工作区目录；
- 运行包作为最终用户交付物如何被解压、配置并启动；
- 运行包如何把 app configuration、health/readiness 和 release qualification 串起来；
- 运行包缺失启动入口、配置样例或版本元数据时是否可以进入发布资格判定。

如果缺少这层规格，`harden-ts-local-runtime-release` 会被迫同时承担“打包产物定义”和“发布资格判定”两种职责，或者各模块各自解释运行目录、启动入口和 candidate 证据，导致首版本地 release 不可重复。

## 变更范围（What Changes）

- 新增 `local-runtime-package` capability。
- 定义首版本地运行包的最小产物边界：可启动 app 产物、启动/停止入口、配置样例、运行目录占位、版本/构建 manifest、release candidate 描述。
- 定义首版最终用户交付形态：发布包是一个 zip，zip 根目录就是 candidate root；用户在已安装 Node.js 的本机解压后，配置 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL` 三个环境变量，双击随包启动脚本即可运行。
- 定义运行包目录职责：`bin/`、`config/`、`data/`、`logs/`、`run/`、`workspaces/`、`backend/`。
- 定义运行包启动前置：配置样例必须能被 `add-ts-app-config-schema` 校验，secret 字段必须使用 `add-ts-secret-configuration-boundary` 允许的 reference 形态。
- 定义用户启动入口必须从解压后的包根解析相对路径，不依赖源码工作区、全局 npm workspace、开发 server 或构建临时目录。
- 定义运行包必须提供正式 entrypoint、manifest、layout 基础 evidence，并允许 `add-ts-e2e-release-package-gate` 从实际候选启动捕获 `configValidationEvidenceRef`、生成 startup/health evidence。
- 定义运行包 manifest 可声明 `backend-only` 或 `with-frontend` package profile，但本 change 只拥有 profile 字段、基础运行包 evidence 和后端启动入口定义；`with-frontend` 的前端 npm 包产物、静态资源托管、route precedence 和前端版本证据由 `refine-ts-fullstack-packaging-boundary` 拥有。
- 明确本 change 只负责“运行包是什么、如何启动、如何作为 candidate 被识别”，不负责发布资格 verdict。

## Capability 影响（Capabilities）

### 新增 Capability

- `local-runtime-package`: 定义首版本地 TS 后端运行包的 zip 交付形态、目录职责、用户启动入口、配置样例、版本 manifest 和 release candidate evidence。

### 相邻 Capability 消费关系

本 change 不在本目录内修改 `local-runtime-release`、`app-config-schema` 或 `secret-configuration-boundary` 的 capability delta。它只定义本地运行包提供给这些相邻能力消费的 package manifest、configuration sample 和 candidate evidence。

- `local-runtime-release`: 后续 release qualification 消费有效 local runtime package evidence 作为 candidate 输入，但 verdict 仍由 release qualification change 拥有。
- `ts-e2e-release-package-gate`: 从正式 package entrypoint 生成并启动实际 candidate，拥有真实 startup 与 health evidence 的执行与生成；release smoke 由 product-journey gate 拥有。
- `app-config-schema`: 运行包随附配置样例必须能被 app configuration startup validation 消费；本 change 不重新定义 app config schema。
- `secret-configuration-boundary`: 运行包配置样例中的 credential-bearing 字段只能携带 grammar-valid、非敏感的示例 `env:` / `file:` reference；不得使用 reference 之外的占位值，本 change 不重新定义 secret grammar。
- `model-provider-configuration`: 首版 zip 交付只暴露三个用户环境变量作为最小模型配置面；这些变量由 app configuration 映射为 provider profile 输入，本 change 不重新定义 provider SDK 或模型调用契约。
- `fullstack-packaging-boundary`: 后续 fullstack packaging refinement 扩展 `with-frontend` profile 的前端 artifact contract、静态资源 route registration、route precedence 和前端包 evidence；本 change 不重新定义这些 fullstack 边界。

## 影响范围（Impact）

- 受影响模块与边界：
  - `agent-app` / app composition：负责组装运行包启动入口、配置样例消费和启动期诊断接入。
  - `agent-channel-web`：继续只负责 API/stream transport；本 change 不把静态资源托管职责放入 Web channel。
  - `agent-platform-gateway-local`：消费运行包路径配置，管理本地数据目录下的持久化资源。
  - `agent-observability`：消费日志目录、health/readiness 和 release evidence 的安全诊断边界。
  - release/package E2E gate：从实际 candidate 生成 startup、health evidence。
  - release qualification：消费完整且已校验的 `PackageCandidateEvidence`。
  - `PackageCandidateEvidence` 的唯一实现 owner 是 `packages/agent-app/src/packaging/package-candidate-evidence.ts`，并通过 `@nextagent/agent-app/packaging` public subpath 暴露；pack、E2E gate 与 qualification 不得使用 private path 或复制同名 shape
  - 配置 evidence 链固定为：实际 candidate startup 由 `agent-app` 生成唯一 `ConfigValidationEvidence`；release/package E2E gate 只捕获其 opaque `configValidationEvidenceRef`；package handoff 和 qualification 不定义第二种配置验证 evidence shape
- 受影响配置：
  - `deployment`
  - `paths`
  - `identity`
  - `channel`
  - `hostedAgent`
  - `modelProfiles`
  - `capabilityProviders`
  - `gateway`
- 不影响：
  - runtime request lifecycle、terminal commit、stream projection、model invocation、capability invocation、Agent routing 和 memory retrieval 语义。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/local-runtime-package/spec.md`：新增
- `openspec/specs/local-runtime-release/spec.md`：补充 candidate package evidence 前置关系
- `openspec/specs/fullstack-packaging-boundary/spec.md`：由 `refine-ts-fullstack-packaging-boundary` 补充 `with-frontend` profile 的前端包和静态托管差异

长期背景：

- `openspec/overview.md`：补充首版本地运行包是 TS 后端第一阶段交付形态之一

设计视图：

- `openspec/designs/architecture/local-runtime-packaging.md`：新增本地运行包产物、启动、目录、配置和 qualification 接入边界
- `openspec/designs/architecture/configuration-boundary.md`：补充运行包配置样例与 frozen config 的关系
- `openspec/designs/modules/agent-app.md`：补充 app composition 对运行包启动入口和基础 candidate evidence 的职责；静态资产托管职责由 fullstack packaging refinement 补充
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充本地运行目录消费边界
- `openspec/designs/spec-to-design-map.md`：新增 `local-runtime-package` 导航

验证入口：

- zip package extraction and double-click startup smoke tests
- package manifest contract tests
- package layout tests
- startup config sample validation tests
- local package smoke tests
- release qualification candidate evidence tests
