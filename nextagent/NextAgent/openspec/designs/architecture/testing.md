# 测试架构

NextAgent 测试按被验证的 artifact 分层。源码级测试在开发 workspace 中验证 package 内部实现、公开 contract 和架构边界。TESTClaw 将解包后的二进制包作为黑盒运行时 artifact 验证。

源码级 Vitest 和 Playwright 套件仍是 TypeScript package 行为、contract 兼容性、架构边界、runtime 生命周期、安全不变量和最小内核非回归的主验证路径。这些测试在仓库 workspace 中运行，且只有当测试目的是 contract、characterization 或架构边界检查时，才可以使用 package 内部实现。

TESTClaw 位于 `tests/TESTClaw/`，与源码开发流程相互独立。它面向 `tests/TESTClaw/target/` 下解包的二进制包，验证 package 布局和命令 run-directory 假设，通过 `nextagent-self-check` 检查 secret reference 配置，为 E2E 运行启动/停止打包后的服务，并在 `tests/TESTClaw/test-output/` 下写入机器/人类可读报告。

TESTClaw 不替代发布资格。发布资格门禁决定候选包能否发布；TESTClaw 为已构建的包提供用户侧和构建后验证证据。TESTClaw 中的失败是关于候选包或其环境的诊断证据，不得被源码级测试成功所掩盖。

TESTClaw 生成的运行时 artifact，包括 `target/`、`data/`、`logs/`、`test-output/`、`docs/`、`.skills/` 和依赖目录，都被排除在仓库提交之外。可复现行为通过框架源码、runner 脚本、配置样例和生成报告承载，而不是提交运行时状态。

