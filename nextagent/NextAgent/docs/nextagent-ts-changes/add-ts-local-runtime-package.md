# add-ts-local-runtime-package

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Local Runtime Packaging

状态：active
类型：实施 change
主要 owner：`agent-app`
依赖：`establish-ts-backend-architecture`、`add-ts-app-config-schema`、`add-ts-secret-configuration-boundary`

目标：
- 定义首版本地运行包的最小产物边界、目录职责、启动入口、配置样例、版本 manifest 和 release candidate evidence。
- 定义首版最终用户交付形态：发布包是一个 zip，用户在已安装 Node.js 的本机解压后，配置 `OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL` 三个环境变量，双击随包启动脚本即可运行本地服务。

能力组共享输入：

整理状态：本分组当前仅此一个 change，输入直接由本文件维护

能力组目标：
- 固化首版本地运行包是什么、如何启动以及如何被 release qualification 识别为 candidate。

共享规格输入：
- 首版本地运行包必须产出一个可分发 zip，zip 根目录就是 candidate root；release/package E2E 必须从该 zip 解压目录启动 candidate，不得只验证内部 staging 目录或源码工作区。
- 首版本地运行包必须定义最小产物边界：可启动 app 产物、启动/停止入口、配置样例、运行目录占位、版本/构建 manifest 和 release candidate 描述。
- 首版用户配置面只要求 Node.js runtime 和三个 OpenAI 环境变量：`OPENAI_API_KEY`、`OPENAI_MODEL_NAME`、`OPENAI_BASE_URL`。随包配置样例必须把模型 provider credential、model name 和 base URL 映射到这些 env refs，不要求用户编辑 YAML 才能完成首次启动。
- 运行包必须提供可双击的用户启动脚本，并保留命令行等价启动方式；脚本必须从包根解析相对路径，不能依赖源码工作区、全局 npm workspace、开发 server 或构建临时目录。
- 运行包目录职责固定为 `bin/`、`config/`、`backend/`、`data/`、`logs/`、`run/`、`workspaces/`，不得替换为等价目录名或 manifest 自定义映射。
- 运行包随附配置样例必须能被 `add-ts-app-config-schema` 校验。
- 运行包配置样例中的 secret 字段只能使用 `add-ts-secret-configuration-boundary` 允许的 reference 形态，不得携带 raw secret。
- 运行包必须提供正式 entrypoint、manifest、layout/config validation 基础 evidence；真实 startup/health evidence 由 `add-ts-e2e-release-package-gate` 从实际 candidate 生成；release smoke 由 `add-ts-e2e-product-journey-gate` 独立拥有。
- 运行包 manifest 可以声明 `backend-only` 或 `with-frontend` package profile；本 change 只定义 profile 字段和基础运行包 evidence，`with-frontend` 的前端 npm 包产物、静态资源托管、route precedence、前端版本证据和 hosting manifest validation 由 `refine-ts-fullstack-packaging-boundary` 定义。
- 本 change 只负责“运行包是什么、如何启动、如何作为 candidate 被识别”，不负责发布资格 verdict。
- `PackageCandidateEvidence` 的唯一实现 owner 固定为 `packages/agent-app/src/packaging/package-candidate-evidence.ts`，并通过 `@nextagent/agent-app/packaging` public subpath 暴露；pack、release/package E2E gate 和 qualification 必须复用该 owner。

非目标：
- 不提供安装器、系统服务注册、自动升级、GUI 配置器或 Node.js runtime 捆绑；Node.js 是用户本机前置条件。

并行边界：
- 不得在本 change 中重写 request lifecycle、terminal commit、stream projection、model invocation 或 capability invocation 语义。
- 不得把运行包目录、本地路径或构建内部细节泄漏到公共 runtime/channel/model/capability contract。
- 不得在本 change 中重复定义 fullstack 静态资源 route ownership、route fallback、前端 artifact package contract 或前端版本锁步；这些属于 `refine-ts-fullstack-packaging-boundary`。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
