# add-ts-sandbox-deny-by-default-adapter

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Sandbox Execution

状态：active
类型：实施 change
主要 owner：gateway adapter packages、`agent-app`
依赖：`establish-ts-core-contracts`

目标：
- 提供默认拒绝或不可用的 sandbox adapter，使动态执行无法绕过 gateway 边界。

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

并行边界：
- capability、hook、policy 不得直接执行 shell、python、脚本或模型生成代码；必须通过 sandbox gateway。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
