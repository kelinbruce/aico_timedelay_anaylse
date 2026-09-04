## MODIFIED Requirements

### Requirement: Pre-Execution Validation Happens Before Sandbox Submission

在可执行能力提交到 sandbox 前，系统 MUST 至少校验 capability visibility、invocation arguments、risk policy outcome、已组合的 sandbox dependency 存在性，以及工作目录约束。可执行命令的 allow/deny policy SHALL 由已组合的 sandbox gateway policy 拥有，而不是由 Bash capability 拥有。

当 `sandbox.enabled=true` 时，restricted local sandbox gateway SHALL 以 trusted executable denylist 作为 `bash` 请求的唯一命令级预拒绝来源。若请求命中配置 denylist，gateway MUST 安全拒绝该请求。若请求未命中 denylist，gateway MUST 继续准备并执行该请求；是否需要 shell built-in、shell chaining 或 direct executable 解析，MUST 由 gateway adapter 在 sandbox 内部处理，而不是作为 capability 级预拒绝条件。gateway MUST NOT 在这一层因为 `cd`、`&&`、`||`、`|` 等 shell built-in 或 shell composition 本身而拒绝请求。

当 `sandbox.enabled=false` 时，restricted local sandbox gateway MUST 跳过 denylist 命令级校验，并直接进入 trusted execution path selection。该模式仍 MUST 保持在 sandbox gateway boundary 内。

#### Scenario: Gateway rejects denied executable

- **WHEN** Bash capability invocation names an executable that is in the configured denylist
- **THEN** the sandbox gateway MUST reject the request safely
- **AND** Bash capability MUST NOT bypass the gateway or execute the command directly

#### Scenario: Gateway allows non-denied shell-builtins and composition

- **WHEN** a Bash capability invocation names a command that is not in the configured denylist
- **AND** the trusted token sequence includes `cd`, `&&`, `||`, `|` or other shell-builtins / shell composition tokens
- **THEN** the sandbox gateway MUST continue to prepare and execute the request
- **AND** the gateway MUST NOT reject the request only because shell interpretation is required

#### Scenario: Disabled validation skips denylist command rejection

- **WHEN** trusted local startup configuration sets `sandbox.enabled=false`
- **AND** a Bash capability invocation names a command that would otherwise match the configured denylist
- **THEN** the sandbox gateway MUST skip denylist command rejection
- **AND** it MUST continue to trusted execution path selection inside the sandbox boundary

### Requirement: Sandbox Failure And Resource Limits Are Explicit

Sandbox unavailability、policy denial、timeout、cancellation、command failure、output too large 和 resource exceeded 条件 MUST 产生显式 safe failure outcomes。系统 MUST NOT 静默截断输出，也 MUST NOT 在 sandbox execution 失败时回退到 unsandboxed local execution。

当 local restricted sandbox 处理 Bash 请求时，gateway SHALL 根据 trusted token sequence 选择 direct executable 或 trusted shell interpreter 执行路径。该选择在 `sandbox.enabled=true` 与 `sandbox.enabled=false` 两种模式下都 MUST 保持在 sandbox gateway boundary 内，并继续使用 adapter-owned `cwd`、sanitized environment、timeout、cancellation 和 output limits。`sandbox.enabled` 控制 trusted validation mode：`true` 时执行 denylist 校验，`false` 时跳过 denylist 校验；它不得再被解释为“strict 模式禁止 shell built-in / chaining”。

#### Scenario: Enabled validation still allows shell interpretation for non-denied command

- **WHEN** local trusted startup configuration omits `sandbox.enabled` or sets it to `true`
- **AND** a sandbox Bash request names a command that is not in the configured denylist
- **AND** the trusted token sequence contains `cd` or `&&`
- **THEN** the restricted local sandbox MUST reconstruct and execute the command through an adapter-owned execution path inside the sandbox boundary
- **AND** it MUST still enforce adapter-owned cwd, sanitized environment, timeout, cancellation, and output byte limits

#### Scenario: Disabled validation skips deny but keeps execution controls

- **WHEN** local trusted startup configuration sets `sandbox.enabled=false`
- **AND** a sandbox Bash request names a command that matches the configured denylist
- **THEN** the restricted local sandbox MUST skip denylist rejection
- **AND** it MUST still enforce adapter-owned cwd, sanitized environment, timeout, cancellation, and output byte limits

#### Scenario: Trusted shell unavailability fails closed

- **WHEN** a Bash request requires shell interpretation
- **AND** the trusted local adapter cannot resolve the required shell interpreter
- **THEN** the restricted local sandbox MUST return an explicit safe failure outcome
- **AND** it MUST NOT fall back to unsandboxed execution

### Requirement: Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration

restricted local sandbox SHALL 拥有 Bash 请求的本地 executable denylist policy。trusted app composition MAY 配置 adapter 的 `deniedExecutables` policy。该配置 MUST 保持为 trusted startup/app composition input，MUST NOT 从 model input、client metadata 或 capability arguments 读取。该 denylist policy 在 `sandbox.enabled=true` 时生效，在 `sandbox.enabled=false` 时跳过。

adapter MUST 仍然通过 trusted executable locator 解析 `clipc`，通过 trusted paths 解析 python interpreter，并通过 trusted platform shell 或可解析 executable 执行其余非 deny 命令。对于需要 shell built-in 或 shell composition 的请求，adapter MUST 通过 trusted shell interpreter 执行；对于不需要 shell 解释的 direct executable，请求 MUST 继续通过 `shell: false` 的 direct execution 路径执行。adapter 在 binary 或 shell interpreter 无法解析时 MUST fail closed。

#### Scenario: Denied executable is rejected

- **WHEN** trusted app composition configures the restricted local sandbox denylist with an executable name
- **AND** trusted local startup configuration omits `sandbox.enabled` or sets it to `true`
- **AND** a sandbox request names that executable
- **THEN** the restricted local sandbox MUST reject the request safely
- **AND** the rejection MUST map to `COMMAND_NOT_ALLOWED` at the capability boundary

#### Scenario: Disabled validation does not reject denied executable

- **WHEN** trusted app composition configures the restricted local sandbox denylist with an executable name
- **AND** trusted local startup configuration sets `sandbox.enabled=false`
- **AND** a sandbox request names that executable
- **THEN** the restricted local sandbox MUST NOT reject the request based on denylist alone
- **AND** it MUST continue to trusted direct or shell execution path selection

#### Scenario: Non-denied direct executable resolves and executes

- **WHEN** a sandbox request names an executable not in the denylist
- **AND** the command does not require shell interpretation
- **AND** the binary can be resolved from trusted locations
- **THEN** the restricted local sandbox MUST execute that binary through `shell: false`
- **AND** the execution MUST still use adapter-owned cwd, sanitized environment, timeout, cancellation, and output limits

#### Scenario: Non-denied shell composition executes through trusted shell

- **WHEN** a sandbox request names a command not in the denylist
- **AND** the trusted token sequence requires shell interpretation
- **THEN** the restricted local sandbox MUST execute the reconstructed command through a trusted shell interpreter inside the sandbox boundary
- **AND** the execution MUST still use adapter-owned cwd, sanitized environment, timeout, cancellation, and output limits

#### Scenario: Unresolvable execution path fails closed

- **WHEN** a sandbox request names a command not in the denylist
- **AND** neither a trusted direct executable path nor a required trusted shell interpreter path can be resolved
- **THEN** the restricted local sandbox MUST return an explicit unavailable safe result
- **AND** it MUST NOT fall back to unsandboxed execution
