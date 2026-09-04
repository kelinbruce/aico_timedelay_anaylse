# command-script-tools Delta Specification

所属 Function：`FN-5.5 执行命令和脚本`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: Bash 对可纠正命令格式错误返回完整诊断

Bash MUST 在进入 sandbox gateway 前把 `command` 解析为唯一可信 token sequence。控制字符、引号不闭合和无法唯一 tokenization 的输入 MUST 在当前本地语义校验阶段一次返回全部可独立判断的违规，MUST 使用 `FAILED`、稳定 code `COMMAND_NOT_ALLOWED`、`safeError.category=VALIDATION` 和 `safeError.retryable=false`，MUST NOT 使用 `AUTHORIZATION`。

`safeError.message` MUST 说明命令格式校验失败、要求修正 `safeError.safeDetails.violations` 后重新调用。每项 violation MUST 使用公共 `{path,constraint,expected}` 结构；引号不闭合 MUST 产生 `{path:"/command",constraint:"balancedQuotes",expected:"a single command with every quoted argument closed"}`，并 MUST 保留 `safeError.safeDetails.reasonCode=BASH_COMMAND_UNCLOSED_QUOTE`。message、violations 和其他安全字段 MUST NOT 回显原始 command。Bash MUST NOT 自动闭合引号或把修正后的命令提交给 sandbox。

Bash MUST NOT 拥有 shell built-in、shell composition、interpreter mode 或 executable 的最终 authorization/policy 判断；格式合法的 token sequence MUST 继续提交给 sandbox gateway，由 sandbox policy 决定是否允许执行。

**需求类别**：功能性需求

#### Scenario: 引号不闭合一次返回可操作诊断

- **WHEN** 模型提交包含不闭合 quoted argument 的 Bash command
- **THEN** Bash MUST 在 sandbox dispatch 前返回 `COMMAND_NOT_ALLOWED + VALIDATION + retryable=false`
- **AND** `safeError.safeDetails.violations` MUST 包含 `/command` 的 `balancedQuotes` 违规
- **AND** `safeError.safeDetails.reasonCode` MUST 为 `BASH_COMMAND_UNCLOSED_QUOTE`
- **AND** `safeError.message` MUST 要求闭合所有 quoted arguments 后重新调用
- **AND** 结果 MUST NOT 回显原始 command

#### Scenario: 多个独立命令格式违规一次返回

- **WHEN** 同一 Bash command 同时包含控制字符和不闭合引号
- **THEN** 本次失败 MUST 返回当前语义阶段的两项 violations
- **AND** sandbox invocation count MUST 为 `0`

#### Scenario: 合法 shell composition 交给 sandbox policy

- **WHEN** Bash 可以把包含 shell composition 的 command 唯一解析为 token sequence
- **THEN** Bash MUST 把该 token sequence 提交给 sandbox gateway
- **AND** Bash MUST NOT 仅因 shell composition 在本地语义阶段返回格式错误或权限错误

### Requirement: Bash 结果有界且忠实表达进程完成事实

Bash 成功、非零退出和 timeout 的 stdout/stderr payload MUST 受声明的独立字节上限约束；任一 channel 超过上限时 MUST 在有效边界截断并只设置对应 truncation flag。日志、metric、trace 和 audit MUST NOT 复制原始 command、stdout 或 stderr。

Sandbox execution 正常完成时，无论 `exit_code` 是否为零、stdout 或 stderr 是否为空，Bash MUST 返回 `CapabilityInvocationResult.status="SUCCEEDED"`，MUST 保留有界 `stdout`、`stderr`、`exitCode`、`stdoutTruncated` 和 `stderrTruncated`，并 MUST NOT 仅因非零退出、空输出或安全截断改为 `DEGRADED` 或 `FAILED`。非零 exit code 是明确的进程完成事实，后续模型步骤可以依据该结构化结果决定是否修改命令或采取其他动作。

Sandbox execution timeout MUST 返回 `TIMED_OUT`；stdout 或 stderr 含安全部分输出时 MUST 保留声明的有界 payload，两者都为空时 MUST 使用空 payload。策略拒绝、sandbox unavailable/canceled、platform unsupported、response shape invalid、output overflow 或其他 execution-boundary failure MUST 按真实事实返回安全 `FAILED`、`TIMED_OUT` 或取消结果，MUST NOT 伪装成正常进程完成或 `DEGRADED`。

**需求类别**：功能性需求

#### Scenario: stdout 和 stderr 独立截断

- **WHEN** stdout 或 stderr 超过对应字节上限
- **THEN** 超限 channel MUST 被截断并把对应 truncation flag 设为 `true`
- **AND** 未超限 channel 的 truncation flag MUST 保持其真实值
- **AND** 安全截断本身 MUST NOT 把正常完成结果改为 `DEGRADED`

#### Scenario: 非零退出且有诊断输出

- **WHEN** Bash sandbox execution 正常完成且 `exit_code != 0`
- **AND** stdout 或 stderr 非空
- **THEN** 结果 MUST 为 `SUCCEEDED`
- **AND** 结果 MUST 保留完整声明的有界进程 payload

#### Scenario: 非零退出且输出为空

- **WHEN** Bash sandbox execution 正常完成且 `exit_code != 0`
- **AND** stdout 与 stderr 都为空
- **THEN** 结果 MUST 仍为 `SUCCEEDED`
- **AND** 结果 MUST 保留真实 `exitCode`、空 stdout/stderr 和真实 truncation flags

#### Scenario: Bash timeout 没有部分输出

- **WHEN** Bash sandbox execution 超时且 stdout 与 stderr 都为空
- **THEN** 结果 MUST 为 `TIMED_OUT` 并使用空 payload
- **AND** 系统 MUST NOT 合成业务执行结果

#### Scenario: Bash timeout 保留安全部分输出

- **WHEN** Bash sandbox execution 超时且 stdout 或 stderr 包含安全部分输出
- **THEN** 结果 MUST 为 `TIMED_OUT` 并保留声明的有界 stdout/stderr payload 和真实 truncation flags
- **AND** 系统 MUST NOT 把部分输出伪装成正常完成或 `DEGRADED`

#### Scenario: Sandbox execution boundary failure 保持失败

- **WHEN** Bash 因 sandbox unavailable/canceled、platform unsupported、invalid response shape、output overflow 或其他 execution-boundary failure 未得到正常进程完成事实
- **THEN** 结果 MUST 按真实事实返回安全 `FAILED`、`TIMED_OUT` 或取消结果
- **AND** 系统 MUST NOT 返回 `SUCCEEDED` 或 `DEGRADED`

### Requirement: Python guard 和执行失败使用统一安全语义

Python sandbox execution 正常完成时 MUST 返回包含 `exit_code`、`stdout`、`stderr` 和 `timed_out` 的结构化结果，`stdout` 与 `stderr` MUST 受声明的安全字节上限约束并在有效 UTF-8 边界截断。正常完成且 `exit_code != 0` MUST 保持普通结构化结果，系统 MUST NOT 仅因非零 exit code 把它提升为 Capability-level `FAILED`、`TIMED_OUT` 或 `DEGRADED`。

Python code safety guard 拒绝 MUST 使用 `FAILED + NL2PY_GUARD_BLOCKED + VALIDATION + retryable=false`。`safeError.safeDetails.violations` MUST 精确包含 `{path:"/code",constraint:"codeSafetyPolicy",expected:"Python code that satisfies the declared code safety policy"}`，MUST NOT 包含与 `safeError.code` 重复的 `reasonCode`，也 MUST NOT 返回 provider 原始 message。

缺少 sandbox 或可信 execution context、sandbox response 不符合内部 contract，以及未知执行异常 MUST 使用标准 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`，不得建立 Python-specific validation code。Sandbox 明确返回 unavailable 或 deny 时 MUST 保留对应安全失败并收敛为 Capability-level `FAILED`。Python timeout MUST 收敛为 Capability-level `TIMED_OUT`；stdout 或 stderr 含安全部分结果时 MUST 保留声明 payload，并在安全 message 中要求检查已有输出、缩小代码或输入后再决定下一步；stdout 与 stderr 都为空时 MUST 使用空 payload，MUST NOT 合成业务执行结果。Python replay policy 保持 `NON_IDEMPOTENT`，因此 timeout MUST NOT 自动同参重试。

**需求类别**：功能性需求

#### Scenario: Python 正常完成返回结构化结果

- **WHEN** Python sandbox execution 在 timeout 前正常完成
- **THEN** 结果 MUST 包含 `exit_code`、`stdout`、`stderr` 和 `timed_out`
- **AND** stdout 和 stderr MUST 保持声明的有界安全输出语义

#### Scenario: Python 非零退出保持普通结构化结果

- **WHEN** Python sandbox execution 正常完成且 `exit_code != 0`
- **THEN** 结果 MUST 保持普通结构化结果
- **AND** 系统 MUST NOT 仅因非零 exit code 返回 Capability-level `FAILED`、`TIMED_OUT` 或 `DEGRADED`

#### Scenario: Python guard 返回精确 code violation

- **WHEN** Python code safety guard 拒绝输入
- **THEN** 结果 MUST 使用 `NL2PY_GUARD_BLOCKED + VALIDATION + retryable=false`
- **AND** 唯一 violation MUST 精确指向 `/code` 并使用 `codeSafetyPolicy`
- **AND** `safeDetails.reasonCode` MUST 缺失
- **AND** provider 原始 message MUST NOT 进入公共结果

#### Scenario: Python 内部执行边界失败统一映射

- **WHEN** sandbox/context 缺失或 sandbox 返回不符合内部 contract 的响应
- **THEN** 结果 MUST 使用 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`
- **AND** message MUST 要求停止该动作并报告错误

#### Scenario: Python sandbox 安全拒绝保持失败

- **WHEN** sandbox boundary 返回安全 unavailable 或 deny 失败
- **THEN** Python invocation MUST 返回 Capability-level `FAILED`
- **AND** 公共结果 MUST NOT 伪装成正常结构化执行结果

#### Scenario: Python timeout 保留安全部分输出

- **WHEN** Python 已产生安全 stdout 或 stderr 后超时并确认执行停止
- **THEN** `TIMED_OUT` 结果 MUST 保留该声明的部分输出
- **AND** message MUST 要求检查已有输出并缩小代码或输入
- **AND** 统一边界 MUST NOT 自动重试该 `NON_IDEMPOTENT` 调用

#### Scenario: Python timeout 没有部分输出

- **WHEN** Python sandbox execution 超时且 stdout 与 stderr 都为空
- **THEN** `TIMED_OUT` 结果 MUST 使用空 payload
- **AND** 系统 MUST NOT 合成业务执行结果
- **AND** 统一边界 MUST NOT 自动重试该 `NON_IDEMPOTENT` 调用

## Function 变更汇总

### 输入

- 变更类型：修改
- 目标内容：Bash 在 sandbox 前一次返回全部可独立判断的命令格式违规；Python guard 拒绝以 `/code` 的 `codeSafetyPolicy` violation 表达可纠正约束。
- 依据 Requirements：`Bash 对可纠正命令格式错误返回完整诊断`、`Python guard 和执行失败使用统一安全语义`

### 输出

- 变更类型：修改
- 目标内容：Bash 可修改的 command 格式错误使用 `COMMAND_NOT_ALLOWED + VALIDATION + retryable=false` 和公共 violations；Bash 正常完成的零/非零退出均返回有界 `SUCCEEDED` 进程结果；Python 正常与非零执行保持结构化结果，guard 使用精确 `/code` violation，缺失执行边界、sandbox 安全拒绝、无效 sandbox response 和 timeout 使用统一安全语义。
- 依据 Requirements：`Bash 对可纠正命令格式错误返回完整诊断`、`Bash 结果有界且忠实表达进程完成事实`、`Python guard 和执行失败使用统一安全语义`

### 处理过程

- 变更类型：修改
- 目标内容：Bash 只完成 deterministic tokenization 和格式校验，格式合法后的执行许可仍由 sandbox policy 判断；Bash 依据 sandbox 的正常完成、timeout 或 boundary failure 事实选择结果状态，不依据 stdout/stderr 是否为空推导状态；Python 对 guard 信息安全化并校验 sandbox response，保留正常结构化结果并保持 `NON_IDEMPOTENT`，因此 timeout 不自动同参重试。
- 依据 Requirements：`Bash 对可纠正命令格式错误返回完整诊断`、`Bash 结果有界且忠实表达进程完成事实`、`Python guard 和执行失败使用统一安全语义`

### 主规格

- 变更类型：修改
- 目标内容：`command-script-tools` 成为 `FN-5.5 执行命令和脚本` 的主规格，承载本次触及的 Bash 与 Python 失败行为。
- 依据 Requirements：`Bash 对可纠正命令格式错误返回完整诊断`、`Bash 结果有界且忠实表达进程完成事实`、`Python guard 和执行失败使用统一安全语义`

### 关联规格

- 变更类型：修改
- 目标内容：`bash-tool`、`python-tool` 和 `cross-platform-executable-semantics` 承载本 Requirement 未覆盖的对应工具行为。
- 依据 Requirements：`Bash 对可纠正命令格式错误返回完整诊断`、`Bash 结果有界且忠实表达进程完成事实`、`Python guard 和执行失败使用统一安全语义`
