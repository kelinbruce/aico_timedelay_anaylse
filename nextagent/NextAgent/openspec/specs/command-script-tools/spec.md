# command-script-tools Specification

## Purpose
定义 Bash 与 Python Tool 通过 sandbox gateway 执行命令和脚本的统一黑盒契约，包括可纠正输入诊断、进程完成结果、guard、执行边界失败、超时、取消和安全输出语义。

## Function

- **所属 Function**：`FN-5.5 执行命令和脚本`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
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

### Requirement: Bash 补全唯一匹配的 Skill 相对脚本路径

当 Bash 的解析结果表示直接解释器执行时，系统 MUST 只对首个脚本参数应用 Skill 相对执行路径兼容规则。受支持的解释器与脚本后缀组合 MUST 恰好为 `python`/`python3` 与 `.py`、`bash`/`sh` 与 `.sh`；候选参数 MUST 是 `scripts/<file>` 或 `<skill-name>/scripts/<file>` 形式的纯相对路径，且 `<file>` MUST 至少包含一个非空文件名 segment。

系统 MUST 只在当前 accepted execution scope 的已提交且验证通过的 Skill projections 中查找候选。`scripts/<file>` 在恰好一个 Skill 中匹配时，系统 MUST 把提交给 sandbox 的对应 argv 替换为该文件的 root-qualified 逻辑路径；`<skill-name>/scripts/<file>` MUST 只查找同名 Skill，并在恰好一个匹配时执行相同替换。系统 MUST 保持原始 Bash Tool 输入不变。

没有匹配时，系统 MUST 保持原 argv 和既有 sandbox 执行行为。以下穷尽条件中的任一条件成立时，系统 MUST NOT 自动补全：解释器或后缀组合不受支持；脚本参数不是首个解释器参数；路径位于 `scripts/` 之外；路径是绝对路径、包含空 segment 或父级穿越；路径已带 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/` 或 `shared-data/` 逻辑 root；命令使用 `-c`、`-lc`、管道、重定向、命令替换或嵌套 shell wrapper。

**需求类别**：功能性需求

#### Scenario: Skill 名称前缀的 Python 脚本唯一匹配

- **WHEN** Bash 解析结果为 `python demo_skill/scripts/query.py`
- **AND** 当前 execution scope 中已验证 Skill `demo_skill` 恰好包含 `scripts/query.py`
- **THEN** 系统 MUST 向 sandbox 提交 `python .nextagent/skills/<projection>/demo_skill/scripts/query.py`
- **AND** 原始 Bash Tool 输入 MUST 保持 `python demo_skill/scripts/query.py`

#### Scenario: 不带 Skill 名称的 shell 脚本唯一匹配

- **WHEN** Bash 解析结果为 `sh scripts/collect.sh`
- **AND** 当前 execution scope 的全部已验证 Skill 中恰好一个包含 `scripts/collect.sh`
- **THEN** 系统 MUST 把该脚本参数替换为唯一匹配的 root-qualified 逻辑路径后提交 sandbox

#### Scenario: 显式 Skill 名称不存在时不跨 Skill 回退

- **WHEN** Bash 解析结果为 `python missing_skill/scripts/query.py`
- **AND** 当前 scope 的另一个 Skill 包含 `scripts/query.py`
- **THEN** 系统 MUST 保持 `missing_skill/scripts/query.py` 不变
- **AND** 系统 MUST NOT 改写到另一个 Skill

#### Scenario: 无匹配时保持既有执行行为

- **WHEN** 受支持形式的相对脚本路径在当前 scope 没有匹配文件
- **THEN** 系统 MUST 保持原 argv 并继续既有 sandbox 执行路径

#### Scenario: 复杂命令和非脚本参数不自动补全

- **WHEN** Bash 输入使用 `python -c`、`bash -lc`、管道、重定向、命令替换、`references/input.json` 或其他不满足窄规则的参数
- **THEN** 系统 MUST NOT 对任何参数应用 Skill 路径补全
- **AND** 后续行为 MUST 与引入本兼容规则前一致

### Requirement: Skill 相对脚本解析保持 projection 安全边界

Skill 相对脚本解析 MUST 仅消费当前 Agent Scope、Owner Scope 和 accepted execution scope 中已经通过 committed projection manifest、完整性与 containment 验证的逻辑路径。系统 MUST NOT 扫描 Skill 源目录、未提交 projection、其他 execution scope 或物理文件系统路径，MUST NOT 通过成功结果、失败结果、候选项、日志或公共诊断暴露物理路径。

当不带 Skill 名称的 `scripts/<file>` 在至少两个已验证 Skill 中匹配时，系统 MUST 在 sandbox dispatch 前返回 `FAILED`、`safeError.code=SKILL_RESOURCE_PATH_AMBIGUOUS`、`safeError.category=VALIDATION` 和 `safeError.retryable=false`。`safeError.safeDetails.candidates` MUST 包含全部匹配的 root-qualified 逻辑路径并按字典序排列，MUST NOT 包含物理路径；sandbox invocation count MUST 为 `0`。

任一候选在最终验证时发生链接逃逸、manifest 不一致、文件缺失或 scope 不一致时，系统 MUST 把该候选视为不匹配，MUST NOT 使用该候选完成补全。候选过滤后为零个时 MUST 保持原 argv；为一个时 MUST 按唯一匹配规则补全；仍为至少两个时 MUST 返回歧义失败。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 同名脚本歧义时拒绝猜测

- **WHEN** 当前 scope 的两个已验证 Skill 都包含 `scripts/run.py`
- **AND** Bash 解析结果为 `python scripts/run.py`
- **THEN** 系统 MUST 返回 `SKILL_RESOURCE_PATH_AMBIGUOUS + VALIDATION + retryable=false`
- **AND** `safeError.safeDetails.candidates` MUST 按字典序包含两个 root-qualified 逻辑路径
- **AND** sandbox invocation count MUST 为 `0`

#### Scenario: 显式 Skill 名称消除同名歧义

- **WHEN** 多个 Skill 包含 `scripts/run.py`
- **AND** Bash 解析结果为 `python selected_skill/scripts/run.py`
- **AND** `selected_skill` 的 committed projection 验证通过
- **THEN** 系统 MUST 只补全 `selected_skill` 的逻辑路径
- **AND** 系统 MUST NOT 返回其他 Skill 的候选项

#### Scenario: 未提交或跨 scope projection 不参与匹配

- **WHEN** 同名脚本只存在于未提交 projection、其他 Agent、其他 Owner 或其他 execution scope
- **THEN** 系统 MUST 把当前 scope 的匹配数判定为零
- **AND** 系统 MUST NOT 暴露或执行该脚本

#### Scenario: 链接逃逸候选不参与匹配

- **WHEN** 候选脚本通过 symlink、junction 或 reparse point 指向 committed Skill root 之外
- **THEN** 系统 MUST 把该候选视为不匹配
- **AND** 系统 MUST NOT 把该逻辑路径提交给 sandbox

### Requirement: Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式

Bash Tool MUST 在提交 sandbox 前拒绝 `python` 和 `python3` 的不支持 CLI 模式。不支持模式 MUST 包括 `-c` inline source、`-` stdin source、除精确单参数 `--version` 以外的 interpreter option-only 调用、缺少 module 或 module 不是 dotted Python module name 的 `-m` 调用，以及会启动交互式 REPL 的零参数调用。Bash Tool MUST 允许 `python <script.py> ...`、`python3 <script.py> ...`、合法 `python -m package.module ...` 以及只有一个 `--version` 参数的版本检查。

拒绝结果 MUST 为 `status=FAILED`、`safeError.code=CAPABILITY_INPUT_INVALID`、`safeError.category=VALIDATION` 和 `safeError.retryable=true`。safe details MUST 包含稳定 reason code，并 MUST 提供使用 Python Tool `code` 字段执行 inline source，或者使用 Bash 调用现有 script/module 的修复提示。零参数调用的 reason code MUST 为 `BASH_PYTHON_REPL_UNSUPPORTED`。拒绝发生后，Bash Tool MUST NOT 调用 sandbox dependency。restricted sandbox gateway MAY 对相同模式保留 fail-closed 纵深校验；若保留，它不得建立不同的允许集合或错误语义。

**需求类别**：系统质量属性
**质量属性**：安全、可维护性
**适用范围**：该 Function

#### Scenario: 零参数 Python 和 Python3 调用被拒绝

- **WHEN** Bash 收到 command 为 `python` 或 `python3` 且 args 为空的调用
- **THEN** Bash MUST 返回 retryable `CAPABILITY_INPUT_INVALID`
- **AND** safe details 的 reason code MUST 为 `BASH_PYTHON_REPL_UNSUPPORTED`
- **AND** Python sandbox dependency MUST NOT 被调用

#### Scenario: Inline Python 调用返回修复提示

- **WHEN** Bash 收到 `python -c print(1)`、`python -` 或对应的结构化 argv
- **THEN** Bash MUST 在 sandbox 提交前拒绝
- **AND** safe details MUST 提示使用 Python Tool 执行 inline source

#### Scenario: 非法 module 和 option-only 调用被拒绝

- **WHEN** Bash 收到缺少合法 dotted module name 的 `-m`，或者除精确 `--version` 以外的 option-only 调用
- **THEN** Bash MUST 在 sandbox 提交前拒绝
- **AND** sandbox dependency MUST NOT 被调用

#### Scenario: 支持的脚本和模块调用保持可路由

- **WHEN** Bash 收到 `python path/to/script.py arg` 或 `python -m package.module arg`
- **THEN** Bash MUST 继续通过 Python sandbox dependency 路由

#### Scenario: 精确版本检查保持可路由

- **WHEN** Bash 收到只有一个 `--version` 参数的 `python` 或 `python3` 调用
- **THEN** Bash MUST 继续通过 Python sandbox dependency 路由
- **AND** `--version` 后包含额外参数时 MUST 拒绝

### Requirement: Bash 为 opt-in 的 clipc 调用注入可信用户身份 Header

Bash Tool MUST 在提交 sandbox gateway 前，识别 executable 精确等于 `clipc`、当前 active Skill 的 `metadata.extension.api_header_params` 已声明对应身份 header、且 argv 中存在 `--params` 后续值为 JSON object 的调用。对这类调用，Bash Tool MUST 把该 JSON object 的 `header` 字段规范化为 JSON object，并只把已声明的下列键合并进去：

- `X-Subject-Id`：取自当前可信 `identityContext.subjectId`
- `X-Display-Name`：取自当前可信 `identityContext.displayName`

Bash Tool MUST 用可信值覆盖模型或用户提供 的同名 `X-Subject-Id` 和 `X-Display-Name`，MUST 保留 `header` 中其他键和 `--params` 中其他字段，并 MUST NOT 注入 `tenantId` 或 `Agent-Tenant-ID`。当 executable 不是 `clipc`、当前 active Skill 未声明对应身份 header、`--params` 缺失、或 `--params` 后续值不是 JSON object 时，Bash Tool MUST NOT 合成或修改 `--params`，并 MUST 保持既有命令提交行为。

**需求类别**：功能性需求

#### Scenario: 注入可信 X-Subject-Id 和 X-Display-Name

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** 当前 active Skill 的 `api_header_params` 包含 `X-Subject-Id,X-Display-Name`
- **AND** `--params` 后续值是 JSON object
- **THEN** Bash Tool MUST 在提交 sandbox gateway 前把 `header.X-Subject-Id` 设置为 `identityContext.subjectId`
- **AND** MUST 把 `header.X-Display-Name` 设置为 `identityContext.displayName`
- **AND** MUST 保留 `--params` 中其他字段和 `header` 中其他键

#### Scenario: 模型不能覆盖身份字段

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** 当前 active Skill 已声明对应身份 header
- **AND** 模型在 `--params.header` 中提供了 `X-Subject-Id` 或 `X-Display-Name`
- **THEN** Bash Tool MUST 用可信 `identityContext` 中的对应值覆盖同名键
- **AND** MUST NOT 让模型提供的身份值进入 sandbox 请求

#### Scenario: 不注入 tenantId

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** `--params.header` 中存在模型提供的 `tenantId` 或 `Agent-Tenant-ID`
- **THEN** Bash Tool MUST NOT 用可信身份生成或覆盖该键
- **AND** MUST 保持该键的既有值不变

#### Scenario: 未 opt-in 的 clipc 调用保持原参数

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** 当前 active Skill 的 `api_header_params` 未声明任何支持的身份 header
- **THEN** Bash Tool MUST NOT 修改 `--params`
- **AND** MUST 保持既有 sandbox 提交行为

#### Scenario: 非 clipc 命令不注入身份 Header

- **WHEN** Bash Tool 收到 executable 不是 `clipc` 的调用
- **THEN** Bash Tool MUST NOT 修改 `--params`
- **AND** MUST 保持既有命令解析和 sandbox 提交行为

#### Scenario: 缺少或非法 --params 不合成身份参数

- **WHEN** Bash Tool 收到 executable 为 `clipc` 的调用
- **AND** `--params` 缺失或后续值不是 JSON object
- **THEN** Bash Tool MUST NOT 合成 `--params`
- **AND** MUST 保持既有命令提交行为
