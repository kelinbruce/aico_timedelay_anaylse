## ADDED Requirements

### Requirement: Builtin Tool 适配的 Executable 事实 MUST 平台一致

系统 MUST 为可执行的 **builtin tool** 事实提供跨平台抽象，使同一受治理的 builtin tool 能在 Windows 和 Linux 上一致地被适配，而不把平台特定的执行规则直接嵌入共享 capability 契约。该抽象 MUST 保持为 `agent-capability` executor 内部关注点，MUST NOT 向 `CapabilityInvocationRequest`、`CapabilityDescriptor`、`SandboxGatewayPort` 或其他公开的 `agent-contracts` surface 添加字段。

**范围**：本需求只适用于 Builtin Tools（bash、python、glob、read、write）。API-backed Tools、Skill Tools、Agent Tools 和其他 Tool 类型不属于这条内部 executable 事实准备路径的范围。

#### Scenario: 平台特定执行派生自单一受治理抽象

- **WHEN** 系统为一个 builtin tool 准备 sandbox 提交
- **THEN** 它 MUST 从受治理的跨平台抽象派生平台特定的 executable 事实
- **AND** 它 MUST NOT 要求每个调用方自行发明平台特定的执行规则
- **AND** 在本 change 中它 MUST NOT 执行 tool 或映射 sandbox 执行结果

### Requirement: 平台支持 MUST 显式声明

支持跨平台执行的 Builtin tools MUST 显式声明所支持的平台集合。第一版支持 Windows 和 Linux。macOS MUST NOT 由本 change 实现。一个不支持当前 runtime 平台的 builtin tool MUST NOT 在该平台上被视为可执行。

#### Scenario: 不支持的平台安全失败

- **WHEN** runtime 尝试在某 builtin tool 的支持平台集合之外的平台上执行它
- **THEN** 系统 MUST 返回安全的不支持平台 outcome
- **AND** 它 MUST NOT 在该平台上尝试临时执行

### Requirement: 内部事实准备解析平台特定的执行细节

系统 MUST 使用 `agent-capability` executor 内部的事实准备边界，为 builtin tools 解析平台特定的路径、参数格式化、interpreter 引用、工作目录引用和环境归一化。

#### Scenario: 内部事实准备解析平台特定的命令细节

- **WHEN** runtime 为特定平台准备一个 builtin tool
- **THEN** 内部事实准备路径 MUST 解析该平台所需的平台特定执行细节
- **AND** 准备好的事实 MUST 保持受治理的 executable 语义，不添加公开 contract 字段

### Requirement: Interpreter 解析 MUST 受控且显式

Builtin tools 中对 `bash` 和 `python` 等 interpreter 的请求 MUST 只通过显式配置或其他受控的、平台可识别的来源解析。系统 MUST NOT 依赖不确定的系统 `PATH` 作为默认答案。

Windows 的 `bash` 请求 MUST NOT 静默切换到 PowerShell 或其他 interpreter。当前组合的受限本地或远端 sandbox 中缺失 sandbox 支撑或受控的 interpreter 时 MUST 返回安全的不可用 outcome。

#### Scenario: Windows bash 不静默切换 interpreter

- **WHEN** 一个 builtin tool 在 Windows 上请求 `bash`
- **AND** 没有配置允许的 `bash` interpreter，或受控解析路径无法提供
- **THEN** 系统 MUST 返回安全的不可用 outcome
- **AND** 它 MUST NOT 把该请求静默切换到 PowerShell 或其他 interpreter
- **AND** 它 MUST NOT 回退到未沙箱化的宿主执行

#### Scenario: Python 要求受控的 interpreter 解析

- **WHEN** 一个 builtin tool 请求 `python`
- **THEN** 系统 MUST 通过显式配置或其他受控的允许来源解析该 interpreter
- **AND** 它 MUST NOT 依赖不确定的系统 `PATH` 查找作为默认答案

### Requirement: 工作目录 MUST 保持在允许的 root 之内

Builtin tool 执行 MUST 在执行前归一化工作目录路径。归一化后的工作目录 MUST 保持在 sandbox 分配的目录或 Skill root 的安全子目录之内，MUST NOT 逃逸出允许的 root。

#### Scenario: 逃逸的工作目录被拒绝

- **WHEN** 归一化的工作目录解析逃逸出允许的执行 root
- **THEN** 系统 MUST 以安全失败 outcome 拒绝执行
- **AND** 它 MUST NOT 继续使用该工作目录

### Requirement: 环境变量 MUST 走 allowlist

传入 builtin tool 执行的环境变量 MUST 经 allowlist 过滤。Raw secret 和不允许的环境值 MUST NOT 被传播进执行 diagnostics、logs、audit、stream 或 safe errors。

#### Scenario: 不允许的环境数据被过滤

- **WHEN** builtin tool 执行以环境变量做准备
- **THEN** 系统 MUST 通过受治理的 allowlist 过滤这些变量
- **AND** 不允许的或 secret 的值 MUST NOT 出现在 diagnostics、logs、audit、stream 或 safe errors 中

### Requirement: 提交前的平台失败映射到稳定的安全 outcome

Builtin tools 的 interpreter 缺失、工作目录逃逸、不允许的环境输入和不支持平台条件 MUST 在 sandbox 提交之前映射到稳定的安全失败 outcome。

Command-not-found、permission-denied、timeout、canceled、non-zero exit、stdout/stderr overflow 和 output-too-large 属于 sandbox 执行 outcome。它们 MUST 由 `add-ts-executable-tool-sandbox-runtime` 从 `SandboxExecutionResult` 映射，而不是由本 change 映射。

#### Scenario: Output-too-large 是显式的

- **WHEN** builtin tool 执行产生超出允许安全边界的 stdout 或 stderr
- **THEN** executable sandbox runtime MUST 从 sandbox 结果返回显式的安全失败或安全的 result-ref outcome
- **AND** 本 change MUST NOT 定义与之竞争的 stdout/stderr 截断或结果映射路径

#### Scenario: 命令失败映射到稳定的安全 outcome

- **WHEN** builtin tool 执行因 command-not-found、permission-denied、non-zero exit、timeout 或 cancellation 而失败
- **THEN** executable sandbox runtime MUST 把该 outcome 映射为面向调用方的稳定安全失败 code
- **AND** 本 change MUST 只提供已提交给该 runtime 的平台适配 executable 事实

### Requirement: 跨平台语义与 Sandbox 执行集成

Builtin tool 平台适配 MUST 输入给 `add-ts-executable-tool-sandbox-runtime`，而不是创建与之竞争的执行路径。本 change MUST NOT 调用 `SandboxGatewayPort`、定义未沙箱化的 fallback 行为、选择 sandbox adapter，或为需要沙箱化的 builtin tools 映射 `SandboxExecutionResult`。

#### Scenario: 平台适配的执行仍使用 sandbox 边界

- **WHEN** 一个 builtin tool 需要沙箱化执行
- **THEN** 平台适配的 executable 事实 MUST 交给 executable sandbox runtime 用于构造 sandbox 请求
- **AND** 本 change MUST NOT 创建与之竞争的未沙箱化 fallback 路径

#### Scenario: 没有 sandbox 支撑的 interpreter 时 Windows bash 可以不可用

- **WHEN** 在 Windows 上请求 `bash`
- **AND** 当前组合的受限本地或远端 sandbox 路径无法提供 sandbox 支撑或受控的 bash interpreter
- **THEN** 系统 MUST 返回安全的不可用 outcome
- **AND** 它 MUST NOT 要求本 change 定义 Windows bash sandbox adapter
- **AND** 它 MUST NOT 作为 fallback 直接在宿主进程上执行 bash
