# add-ts-executable-tool-sandbox-runtime

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Sandbox Execution

状态：active
类型：实施 change
主要 owner：`agent-capability`、gateway sandbox port
依赖：`add-ts-capability-core-governance`、`add-ts-sandbox-deny-by-default-adapter`

目标：
- 支持 `bash`、`python`、模型生成代码等可执行类能力通过本地受限执行 sandbox 或远端 sandbox gateway 调用。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 保证动态可执行内容必须通过 sandbox gateway 边界，并在受支持平台上保持一致可用性、超时和失败解释。

共享规格输入：
- 最小内核不涉及 `bash` 和 `python`。
- TS 首个发行版本需要同时支持本地受限执行 sandbox 和远端 sandbox gateway。
- deny-by-default adapter 是安全默认/不可用适配器，不能替代发行版 sandbox 能力。
- TS 首个发行版本正式支持 Windows 和 Linux；不要求 macOS。
- Windows 上 `bash` 明确要求 Git Bash；若 Git Bash 不可用，返回 unavailable/safe error 或通过远端 sandbox gateway 执行。
- Windows/Linux 必须定义一致语义，包括工作目录隔离、环境变量白名单、超时、stdout/stderr 大小限制、exit code 映射、command not found、permission denied、timeout、canceled、output too large。
- `python` 通过配置的 interpreter 或 sandbox gateway，不假设系统 PATH。
- `CapabilityInvocationRequest` 不携带 `workspaceDir`；sandbox 工作目录、隔离根目录和 provider 执行环境必须由 capability/provider 模块基于 `AgentAssembly.workspaceDir`、provider configuration 和 sandbox policy 解析。
- `CapabilityInvocationResult` 使用 `structuredPayload` 承载安全结构化结果，不使用 `safeOutput`；保留 `resultRef`、`generatedMessages`、`contextPatch`、`artifactRefs`、`error`、`fallbackTriggered`、`metadata`。
- `generatedMessages` 只允许 `USER` role，字段为 `role`、`content`、`meta`；inline Skill 可通过它把 Skill 内容或生成的 USER message 注入当前 request/run 后续模型上下文，`meta=true` 表示对用户隐藏但可进入模型上下文。
- `contextPatch` 字段为 `allowedTools?`、`modelName?`、`modelOptions?`；它只影响当前 request/run 后续模型步骤，不得永久修改 Agent assembly、session 配置、provider 配置或 catalog state。
- `contextPatch.allowedTools` 不得越权扩大当前 Agent 已授权能力；`modelName`、`modelOptions` 必须经过 model selection/governance 校验。
- `resultRef` 指向完整结果或外部内容引用，适用于结果过大、截断或不适合内联的场景；`artifactRefs` 指向由 artifact gateway 管理的文件、生成输出或 Agent 结果附件 metadata。用户输入附件通过 `attachmentIds` 和 `RequestAttachment` 管理，只有被显式转化为输出产物时才进入 artifact metadata。
- capability result 不包含 `durationMs`、`auditRef` 或 `resultMessageId`；这些由 runtime、wrapper、timeline、audit 或 gateway 层产生。

并行边界：
- capability、hook、policy 不得直接执行 shell、python、脚本或模型生成代码；必须通过 sandbox gateway。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
