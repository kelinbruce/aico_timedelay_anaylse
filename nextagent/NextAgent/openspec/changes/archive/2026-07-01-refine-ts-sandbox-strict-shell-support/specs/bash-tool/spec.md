## MODIFIED Requirements

### Requirement: Bash Accepts Only Strict Single Commands

Bash Tool MUST 将 `command` 解析为一个受信 token sequence，并在 gateway execution 前完成 deterministic tokenization。它 MUST 拒绝 control characters、malformed quoting、无法唯一 token 化的输入，以及任何会导致 trusted token sequence 不确定的语法。对于 malformed quoted syntax，Bash MUST 保持现有 public safe error code `COMMAND_NOT_ALLOWED`，并提供足以帮助模型修正命令的 safe details。

Bash Tool MUST NOT 因为 token sequence 包含 `|`、`&&`、`||`、`cd` 或其他 shell-builtins / shell composition token 而在 capability 层直接拒绝请求。只要命令字符串能够被唯一 token 化并通过既有输入校验，Bash MUST 将该 token sequence 提交给 sandbox gateway，由 gateway 决定采用 direct execution 还是 trusted shell execution。

#### Scenario: Rejects unclosed quoted Python query before execution

- **WHEN** the model invokes Bash with `python .nextagent/skills/.../scripts/rag_query.py --query "SET BYPASSRM recovery command`
- **THEN** Bash MUST reject the command before sandbox submission
- **AND** the rejection MUST be a retryable `COMMAND_NOT_ALLOWED` authorization failure
- **AND** safe details reason code MUST be `BASH_COMMAND_UNCLOSED_QUOTE`
- **AND** the safe hint MUST tell the model to close the quoted argument

#### Scenario: Shell composition with deterministic tokenization is forwarded to gateway

- **WHEN** the model invokes Bash with `cd logs && cat alarm.txt`
- **THEN** Bash MUST deterministically tokenize the command
- **AND** Bash MUST submit the resulting token sequence to the sandbox gateway
- **AND** Bash MUST NOT reject the request only because shell composition is present

### Requirement: Bash Default Commands Are Local And Read Only

当 `sandbox.enabled=true` 时，restricted local sandbox policy SHALL 使用 executable denylist 作为命令级关闭机制。默认 denylist MAY 为空，意味着所有可解析或可由 trusted shell 解释的非 deny 命令都允许进入 sandbox 执行。denylist MUST 被视为 sandbox gateway policy configuration，而不是 Bash capability-owned command authority。

当 `sandbox.enabled=false` 时，Bash MUST 继续把命令提交给 sandbox gateway，但 gateway 跳过 denylist 命令级拒绝；Bash capability 仍然不得自持第二套 deny/allow policy。

#### Scenario: Configuration denies dangerous executables at gateway boundary

- **WHEN** trusted app composition configures the sandbox gateway denylist with a dangerous executable
- **AND** trusted local startup configuration omits `sandbox.enabled` or sets it to `true`
- **THEN** Bash MUST NOT reject that executable before sandbox submission
- **AND** the sandbox gateway MUST reject it based on the denylist

#### Scenario: Non-denied shell built-in is not blocked by capability policy

- **WHEN** the model invokes Bash with a command that is not in the configured denylist
- **AND** the command requires shell built-in or shell composition support
- **THEN** Bash MUST still submit the command to the sandbox gateway
- **AND** Bash MUST NOT maintain a parallel capability-level command allowlist

#### Scenario: Disabled validation does not reintroduce capability-owned deny

- **WHEN** trusted local startup configuration sets `sandbox.enabled=false`
- **AND** the model invokes Bash with a command that matches the configured denylist
- **THEN** Bash MUST still submit the command to the sandbox gateway
- **AND** Bash MUST NOT add a capability-level deny rejection to compensate for disabled validation

### Requirement: Bash Is Workspace Scoped And Network CLI Is Denied

executable deny decisions SHALL 由 sandbox gateway denylist policy 或更强的平台 sandbox enforcement 执行。Bash MAY 提供模型 guidance，但 MUST NOT 成为 executable policy 的最终安全边界。路径约束、filesystem root checks、environment validation 和 file-type checks 不是 Bash capability 的职责；若形成执行边界，MUST 由 sandbox adapter 或 platform isolation 承载。

#### Scenario: Denied executable is rejected by sandbox policy

- **WHEN** Bash submits an executable in the configured denylist
- **THEN** the sandbox gateway MUST reject the request safely
- **AND** the capability-facing result MUST preserve a safe sandbox rejection reason

#### Scenario: Non-denied shell composition remains gateway-owned

- **WHEN** Bash submits a deterministically tokenized shell composition command that is not in the configured denylist
- **THEN** policy ownership MUST remain at the sandbox gateway boundary
- **AND** Bash MUST NOT add a second command-category rejection path for shell composition

### Requirement: Bash policy follows frozen local sandbox disable switch

builtin `bash` tool SHALL consume frozen app composition only to preserve model-facing configuration compatibility。restricted local sandbox gateway SHALL consume `sandbox.enabled` as the trusted validation-mode switch。validation enabled 时，命令级预拒绝来源 MUST 收敛到 trusted denylist；validation disabled 时，gateway MUST 跳过 denylist 命令级预拒绝。Bash MUST 继续通过 sandbox dependency 提交请求，并 MUST NOT 在 capability 层直接调用 host shell APIs。

当 validation enabled 时，gateway MUST 继续执行 denylist policy，并 MUST 允许非 deny 的 shell-builtins / shell composition 进入 sandbox execution。當 validation disabled 时，gateway MAY 放宽其他 trusted local validation，并 MUST 跳过 denylist 命令级校验。

#### Scenario: Enabled validation still keeps shell execution gateway-owned

- **WHEN** trusted local startup configuration omits `sandbox.enabled` or sets it to `true`
- **AND** the model submits `cd logs && cat alarm.txt`
- **THEN** Bash MUST submit the request through the sandbox dependency
- **AND** Bash capability MUST not directly invoke host shell APIs
- **AND** the command MUST NOT be rejected only because shell interpretation is required

#### Scenario: Disabled validation remains gateway-owned

- **WHEN** trusted local startup configuration sets `sandbox.enabled=false`
- **THEN** the restricted local sandbox gateway MAY use trusted shell mode
- **AND** the gateway MUST skip denylist command rejection
- **AND** Bash capability MUST not directly invoke host shell APIs
