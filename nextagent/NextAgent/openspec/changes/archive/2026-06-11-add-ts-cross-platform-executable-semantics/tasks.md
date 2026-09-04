## 1. 内部 executable facts 准备模型

注意：以下所有结构均为 `agent-capability` 内部实现，**不进入 agent-contracts 公共契约**。不得修改已冻结的 `CapabilityDescriptor`、`CapabilityInvocationRequest`、`SandboxGatewayPort`、`SandboxExecutionRequest` 或 `SandboxExecutionResult`。

- [x] 1.1 在 `agent-capability` 内部新增首版 `SupportedPlatform` type string literal union（`"WINDOWS" | "LINUX" | "ALL"`），不得定义为 TypeScript enum；macOS 不在首版实现范围
  来源：spec requirement "Platform Support Must Be Declared Explicitly"；design 选定方案 §1
- [x] 1.2 在 `agent-capability` 内部新增 `PlatformAdaptedExecutableFacts` 或等价内部结构，表达平台适配后的 executable、command、args、workingDirectoryRef 和 allowlisted environment；该结构不是已执行结果
  来源：spec requirement "Builtin Tool Adapted Executable Facts Must Be Platform-Consistent"；design D1、D4
- [x] 1.3 新增 `prepareBuiltinExecutableFacts(...)` 或等价内部 helper，输入来自可信 app composition、resolved AgentAssembly、tool execution context 或已治理配置；不得从 public invocation payload 接收 platform/workspace/root 字段
  来源：spec requirement "Internal Facts Preparation Resolves Platform-Specific Execution Details"；design D1、D2、D4

## 2. bash/python 执行前事实适配

- [x] 2.1 在 helper 内实现 Windows/Linux platform 支持判断；unsupported platform 返回 stable safe failure，不执行命令
  来源：spec requirement "Platform Support Must Be Declared Explicitly" scenario "Unsupported platform fails safely"；design D5
- [x] 2.2 实现 Windows `bash` 不静默切换 PowerShell；没有 sandbox-backed 或受控 bash 解释器时返回 unavailable safe failure
  来源：spec requirement scenario "Windows bash does not silently switch interpreter"；design D1, 选定方案 §2
- [x] 2.3 实现 `python` 只通过显式配置或受控平台来源解析，不依赖不确定系统 PATH；缺失解释器返回 unavailable safe failure
  来源：spec requirement scenario "Python requires controlled interpreter resolution"；design D6
- [x] 2.4 实现工作目录归一和 allowed roots 校验；只允许 sandbox assigned dir 或 safe skill/workspace 子目录，路径归一后不得逃逸允许根目录
  来源：spec requirement "Working Directory Must Stay Within Allowed Roots"；design D6
- [x] 2.5 实现 environment allowlist 过滤；raw secret 不进入诊断、日志、审计、stream 或 SafeError
  来源：spec requirement "Environment Variables Must Be Allowlisted"；design D6
- [x] 2.6 将解释器缺失、工作目录逃逸、env allowlist 拒绝和 platform unsupported 映射为执行前 stable safe failure；command not found、permission denied、timeout、canceled、non-zero exit、output too large 仍由 executable sandbox runtime 处理
  来源：spec requirement "Pre-Submission Platform Failures Map To Stable Safe Outcomes"；design D6

## 3. Builtin executable tool 集成

注意：跨平台语义是 executor 内部执行层 concern，**不修改 CapabilityDescriptor 公共契约**。

- [x] 3.1 将 bash/python executable builtin tool 的 sandbox submission 前逻辑接入 `prepareBuiltinExecutableFacts(...)` 或等价 helper；不得在本 change 中调用 `SandboxGatewayPort` 或执行命令
  来源：spec requirement "Builtin Tool Adapted Executable Facts Must Be Platform-Consistent" scenario "Platform-specific execution is derived from one governed abstraction"；design D3、D4
- [x] 3.2 将平台适配后的命令、参数、工作目录引用和环境 allowlist 作为 `PlatformAdaptedExecutableFacts` 交给 `add-ts-executable-tool-sandbox-runtime` 构造既有 sandbox execution request；不得修改 `SandboxExecutionRequest` / `SandboxExecutionResult`
  来源：spec requirement "Cross-Platform Semantics Integrate With Sandbox Execution" scenario "Platform-adapted execution still uses sandbox boundary"；design 选定方案 §2
- [x] 3.3 确认 API-backed Tool、Skill Tool、Agent Tool 等其他 Tool 类型不接入本 helper，不由本 change 处理其平台差异
  来源：spec Scope；design D3

## 4. 公共契约边界

- [x] 4.1 编写 contract negative test，确认本 change 不新增 `CapabilityInvocationRequest.platform`、`CapabilityInvocationRequest.workspaceRoot/workspaceDir`、`CapabilityDescriptor` 跨平台字段或修改 `SandboxGatewayPort`
  来源：design 非目标；AGENTS.md 验证门禁
- [x] 4.2 确认本 change 不选择 sandbox adapter、不调用 sandbox、不映射 `SandboxExecutionResult`；这些行为只归 `add-ts-executable-tool-sandbox-runtime`
  来源：spec requirement "Cross-Platform Semantics Integrate With Sandbox Execution"；design 相邻 Change 边界

## 5. 验证

- [x] 5.1 编写 `prepareBuiltinExecutableFacts(...)` 或等价 helper 的单元测试，覆盖 Windows/Linux facts 生成；不得在本 change 中执行工具
  来源：AGENTS.md 验证门禁
- [x] 5.2 编写跨平台路径解析 / 工作目录归一测试
  来源：AGENTS.md 验证门禁
- [x] 5.3 编写 Windows `bash` 不静默切换 PowerShell、缺失解释器返回 unavailable SafeError 的测试
  来源：spec requirement scenario "Windows bash does not silently switch interpreter"；AGENTS.md 验证门禁
- [x] 5.4 编写 `python` 不依赖不确定系统 PATH 的测试
  来源：spec requirement scenario "Python requires controlled interpreter resolution"；AGENTS.md 验证门禁
- [x] 5.5 编写 workingDirectory 逃逸和 env allowlist negative tests
  来源：spec requirement scenario "Escaping working directory is rejected", "Disallowed environment data is filtered"；AGENTS.md 验证门禁
- [x] 5.6 编写执行后错误不在本 change 中映射的边界测试，确认 timeout、stdout/stderr 超限、exit code 等由 executable sandbox runtime 消费 `SandboxExecutionResult` 后处理；本 change 只验证无 unsandboxed fallback
  来源：spec requirement scenario "Output-too-large is explicit"；AGENTS.md 验证门禁
- [x] 5.7 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：AGENTS.md 验证门禁
- [x] 5.8 运行 `openspec validate add-ts-cross-platform-executable-semantics --strict`
  来源：AGENTS.md 验证门禁

## 归档前基线提升检查（非实施任务）

归档时需要把长期有效内容提炼到以下基线：
- `openspec/specs/capability-descriptor/spec.md`
- `openspec/designs/contracts/cross-platform-tool.md`
