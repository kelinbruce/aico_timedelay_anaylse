## 1. Tool 契约与注册

- [x] 1.1 定义 Bash 输入、输出和配置 schema。
- [x] 1.2 定义 `bashToolDefinition`，带 `requiredDependencies: ["sandbox"]`。
- [x] 1.3 在自有 builtin Tool 列表中注册 Bash 并导出其公共实现面。
- [x] 1.4 验证 `run_in_background` 不存在且被输入 schema 拒绝。

## 2. 严格命令策略

- [x] 2.1 实现严格的单命令解析器，绝不把原始输入传给 shell。
- [x] 2.2 为 `ls`、`cat`、`grep`、`head`、`tail` 和 `wc` 实现表驱动策略。
- [x] 2.3 实现精确的 Python 脚本 allowlist 和严格的 Python 参数校验。
- [x] 2.4 拒绝复杂语法、不支持的命令、写操作、网络 CLI 命令、绝对路径、目录穿越、设备文件和 symlink 逃逸。
- [x] 2.5 确保可信配置只能缩减默认命令集。

## 3. 受限本地 gateway 适配器

- [x] 3.1 新增面向 Tool 的适配器，把可信执行上下文和解析后的命令数据映射到 `SandboxGatewayPort`。
- [x] 3.2 实现受限本地 gateway 适配器，包含可信 workspace cwd、净化后的环境、网络 CLI 拒绝、timeout、AbortSignal 和独立输出限制。
- [x] 3.3 保持宿主 shell 探测和进程执行为 gateway 适配器私有。
- [x] 3.4 默认组装受限本地适配器，同时保留依赖注入以支持后续隔离 sandbox 适配器。

## 4. 结果与可观测性语义

- [x] 4.1 返回 Tool 业务输出，由 `BuiltinToolExecutor` 包装为 `CapabilityInvocationResult`。
- [x] 4.2 把非零退出、超时、中止、策略拒绝和适配器不可用映射到规定的安全结果。
- [x] 4.3 仅通过既有 tool-use 消息和稳定的 `toolCallId` 保持完整命令可追溯性。
- [x] 4.4 确保日志、audit、trace、metric、SafeError 和结果元数据不含命令文本、stdout、stderr、脚本内容和宿主路径。

## 5. 验证

- [x] 5.1 新增描述符、输入/输出/配置 schema 和成功调用测试。
- [x] 5.2 为每一类被禁止的语法和命令类别新增 negative policy 测试。
- [x] 5.3 新增 workspace、symlink、只读和网络 CLI 拒绝测试。
- [x] 5.4 新增超时、取消、非零退出和独立截断测试。
- [x] 5.5 新增架构测试，证明 Tool/Core/Runtime 不直接使用宿主进程 API。
- [x] 5.6 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict`。
- [x] 5.7 为每个允许的命令、超时边界、依赖可用性和独立 stderr 截断新增表驱动 unit test。
- [x] 5.8 新增 app composition 集成测试，覆盖 model tool-use、可信 sandbox 请求映射、生命周期事件、持久化和后续 model context。
- [x] 5.9 在后续 provider 请求中保留成对的 assistant tool-call 和 tool-result 消息，并保留原始 capability 名。
- [x] 5.10 在 Windows 上强制直接结构化进程执行、精确的 `ls` 选项策略，以及可替换的、感知取消/截断的 `SandboxGatewayPort`。
