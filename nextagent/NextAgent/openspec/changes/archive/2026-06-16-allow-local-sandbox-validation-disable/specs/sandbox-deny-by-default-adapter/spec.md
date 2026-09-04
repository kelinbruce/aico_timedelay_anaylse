## ADDED Requirements

### Requirement: Local restricted sandbox can disable function validation only by frozen local config

系统 SHALL 在 local restricted sandbox 中支持由冻结 app composition 配置显式关闭函数校验。该开关 MUST 只来自 startup validation 后的 `DefaultSystemConfig.sandbox.disable`，默认值 MUST 为 `false`。当该值为 `true` 时，restricted local sandbox SHALL 跳过 adapter 内部的命令 allowlist、路径参数、环境变量和 working directory 校验；动态执行仍 MUST 通过 `SandboxGatewayPort.execute()` 提交，并继续使用 adapter 拥有的固定 workspace cwd、清洗后的环境、timeout、cancellation 和 stdout/stderr byte limit。该开关 MUST NOT 允许调用方、模型输出、tool input、capability 参数、client metadata 或 request payload 覆盖。

#### Scenario: Default local sandbox validation remains enabled
- **WHEN** local startup configuration omits `sandbox.disable`
- **THEN** frozen runtime configuration behaves as `sandbox.disable=false`
- **AND** restricted local sandbox continues to reject unsupported commands, unsafe path arguments, non-empty request environment, and request working directory override

#### Scenario: Explicit local config disables adapter function validation
- **WHEN** local startup configuration sets `sandbox.disable=true`
- **THEN** restricted local sandbox skips command allowlist, path argument, request environment, and request working directory validation
- **AND** execution still goes through `SandboxGatewayPort.execute()`
- **AND** execution still uses the adapter-owned workspace cwd, sanitized process environment, timeout, cancellation, and output byte limits

#### Scenario: Request input cannot disable sandbox validation
- **WHEN** a tool input, model output, capability argument, client metadata, or request payload attempts to disable sandbox validation
- **THEN** the system ignores that input as authorization state
- **AND** only the frozen startup configuration determines whether local sandbox function validation is enabled
