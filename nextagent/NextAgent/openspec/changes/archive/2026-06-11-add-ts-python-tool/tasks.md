## 1. Python Tool 契约与身份

- [x] 1.1 定义独立 `python` builtin tool id、descriptor、input schema 和 output schema，不得挂在 `bash` 之下
- [x] 1.2 将 Python tool 输入固定为 `{ code: string, args?: string[], timeout_ms?: integer > 0 }`
- [x] 1.3 固定 DFX 约束：`timeout_ms` 默认 `10000` / 最大 `120000`，`args` 最多 `100` 个且总字节数不超过 `8192`，`stdout/stderr` 各自最大 `65536` UTF-8 bytes
- [x] 1.4 明确本 change 的独立 `python` tool 不重定义也不隐式删除 `bash` 中既有的受限 Python 脚本调用语义

## 2. Python Tool Handler

- [x] 2.1 实现 Python tool handler，接收代码片段而不是命令字符串
- [x] 2.2 在 handler 中校验 `code`、`args`、`timeout_ms` 和 args budget
- [x] 2.3 构造 Python trusted submission facts / sandbox submission mapping，并保持调用隔离语义
- [x] 2.4 将 sandbox execution result 映射为 `CapabilityInvocationResult`

## 3. Sandbox Boundary

- [x] 3.1 通过 tool-facing Python sandbox dependency 提交代码执行，并由该依赖映射到 `SandboxGatewayPort`
- [x] 3.2 确保 sandbox unavailable / deny / failure 返回 safe result，不得回退到 host execution
- [x] 3.3 确保 sandbox submission 只使用 trusted run/owner/timeout/output-budget facts，不从模型输入或客户端 metadata 读取执行身份与宿主配置
- [x] 3.4 确保 `python` 不通过 `bash` 子命令路径、也不直接调用宿主进程 API

## 4. 测试与验证

- [x] 4.1 测试独立 Python tool descriptor 注册和 discovery
- [x] 4.2 测试有效 `code` 调用返回结构化执行结果
- [x] 4.3 测试 `args` 数量/字节预算、默认/最大 timeout、stdout/stderr 截断
- [x] 4.4 测试 timeout、abort、sandbox unavailable、execution failure 的 safe result
- [x] 4.5 测试 submission request 使用 trusted run/owner facts 和受控输出预算
- [x] 4.6 测试 Python 调用不经过 `bash` 路径，且绕过 sandbox 的路径被拒绝
- [x] 4.7 测试独立 `python` tool 不复用 Bash command parser / allowlist 语义
- [x] 4.8 运行 `openspec validate add-ts-python-tool --strict`
