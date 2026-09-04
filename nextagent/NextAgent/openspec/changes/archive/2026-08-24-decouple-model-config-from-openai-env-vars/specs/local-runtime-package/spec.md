## MODIFIED Requirements

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