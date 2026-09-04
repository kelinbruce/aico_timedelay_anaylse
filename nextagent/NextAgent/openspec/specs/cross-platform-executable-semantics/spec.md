# cross-platform-executable-semantics Specification

## Purpose
定义 builtin 工具（bash、python、glob、read、write）的内部 executable facts 准备边界，使同一个受治理 builtin 工具在 Windows 和 Linux 上以一致方式适配。平台适配仍是 `agent-capability` executor 内部关注点。

## Requirements

### Requirement: Builtin 工具适配后的 executable facts 必须平台一致

系统 MUST 为可执行 **builtin tool** facts 提供一个跨平台抽象，使同一个受治理 builtin 工具可以在 Windows 和 Linux 上以一致方式适配，而无需把平台特定执行规则直接嵌入共享 capability contract。该抽象 MUST 保持为 `agent-capability` executor 内部关注点，且 MUST NOT 向 `CapabilityInvocationRequest`、`CapabilityDescriptor`、`SandboxGatewayPort` 或其他公共 `agent-contracts` surface 添加字段。

**Scope**：本 requirement 只适用于 Builtin 工具（bash、python、glob、read、write）。API-backed Tool、Skill Tool、Agent Tool 及其他 Tool 类型不在此内部 executable facts 准备路径范围内。

#### Scenario: 平台特定执行派生自单一受治理抽象

- **WHEN** 系统为一个 builtin tool 准备 sandbox 提交
- **THEN** 它 MUST 从受治理的跨平台抽象派生平台特定 executable facts
- **AND** 它 MUST NOT 要求每个调用方自行发明平台特定执行规则
- **AND** 它 MUST NOT 在本 change 中执行工具或映射 sandbox 执行结果

### Requirement: 平台支持必须显式声明

支持跨平台执行的 builtin 工具 MUST 显式声明受支持平台集合。第一版支持 Windows 和 Linux。本 change MUST NOT 实现 macOS。不支持当前运行平台的 builtin 工具 MUST NOT 被视为在该平台上可执行。

#### Scenario: 不支持的平台安全失败

- **WHEN** runtime 试图在不在某 builtin tool 受支持平台集合中的平台上执行该工具
- **THEN** 系统 MUST 返回安全的不支持平台结果
- **AND** 它 MUST NOT 在该平台上尝试临时执行

### Requirement: 内部 facts 准备解析平台特定执行细节

系统 MUST 使用 `agent-capability` executor 内部的 facts 准备边界，为 builtin 工具解析平台特定路径、参数格式化、解释器引用、工作目录引用和环境规范化。

#### Scenario: 内部 facts 准备解析平台特定命令细节

- **WHEN** runtime 为特定平台准备 builtin 工具
- **THEN** 内部 facts 准备路径 MUST 解析该平台所需的平台特定执行细节
- **AND** 准备好的 facts MUST 保持受治理的可执行语义，且不添加公共 contract 字段

### Requirement: 解释器解析必须受控且显式

builtin 工具中对 `bash` 和 `python` 等解释器的请求 MUST 只通过显式配置或其他受控的、平台可识别的来源解析。系统 MUST NOT 依赖不确定的系统 `PATH` 作为默认答案。

Windows `bash` 请求 MUST NOT 静默切换到 PowerShell 或其他解释器。当前组合的受限本地或远程 sandbox 中缺失 sandbox 支持或受控解释器时，MUST 返回安全的不可用结果。

#### Scenario: Windows bash 不静默切换解释器

- **WHEN** builtin 工具在 Windows 上请求 `bash`
- **AND** 未配置允许的 `bash` 解释器，也无法通过受控解析路径获得
- **THEN** 系统 MUST 返回安全的不可用结果
- **AND** 它 MUST NOT 静默把该请求切换到 PowerShell 或其他解释器
- **AND** 它 MUST NOT 回退到未沙箱化的宿主执行

#### Scenario: Python 需要受控解释器解析

- **WHEN** builtin 工具请求 `python`
- **THEN** 系统 MUST 通过显式配置或其他受控允许来源解析该解释器
- **AND** 它 MUST NOT 依赖不确定的系统 `PATH` 查找作为默认答案

### Requirement: 工作目录必须保持在允许 root 内

builtin 工具执行 MUST 在执行前规范化工作目录路径。规范化后的工作目录 MUST 保持在 sandbox 分配的目录或 Skill root 的安全子目录内，且 MUST NOT 逃逸出允许的 root。

#### Scenario: 逃逸的工作目录被拒绝

- **WHEN** 规范化后的工作目录解析逃逸出允许的执行 root
- **THEN** 系统 MUST 以安全失败结果拒绝执行
- **AND** 它 MUST NOT 继续使用该工作目录

### Requirement: 环境变量必须经允许列表过滤

传入 builtin 工具执行的环境变量 MUST 经 allowlist 过滤。原始 secret 和被禁止的环境值 MUST NOT 被传播到执行诊断、日志、audit、stream 或 safe error 中。

#### Scenario: 被禁止的环境数据被过滤

- **WHEN** builtin 工具执行在准备时带有环境变量
- **THEN** 系统 MUST 通过受治理的 allowlist 过滤这些变量
- **AND** 被禁止或 secret 值 MUST NOT 出现在诊断、日志、audit、stream 或 safe error 中

### Requirement: 提交前平台失败映射到稳定安全结果

builtin 工具的解释器缺失、工作目录逃逸、被禁止的环境输入和不支持平台等状况 MUST 在 sandbox 提交之前映射到稳定的安全失败结果。

command-not-found、permission-denied、timeout、canceled、non-zero exit、stdout/stderr overflow 和 output-too-large 属于 sandbox 执行结果。它们 MUST 由 `add-ts-executable-tool-sandbox-runtime` 从 `SandboxExecutionResult` 映射，而不是由本 change 映射。

#### Scenario: Output-too-large 是显式的

- **WHEN** builtin 工具执行产生超出允许安全边界的 stdout 或 stderr
- **THEN** executable sandbox runtime MUST 从 sandbox 结果返回显式的安全失败或安全 result-ref 结果
- **AND** 本 change MUST NOT 定义与之竞争的 stdout/stderr 截断或结果映射路径

#### Scenario: 命令失败映射到稳定安全结果

- **WHEN** builtin 工具执行因 command-not-found、permission-denied、non-zero exit、timeout 或取消而失败
- **THEN** executable sandbox runtime MUST 为调用方把该结果映射到稳定的安全失败 code
- **AND** 本 change MUST 只提供已提交给该 runtime 的平台适配 executable facts

### Requirement: 跨平台语义与 sandbox 执行集成

builtin 工具平台适配 MUST 供给 `add-ts-executable-tool-sandbox-runtime`，而不是创建与之竞争的执行路径。本 change MUST NOT 调用 `SandboxGatewayPort`、定义未沙箱化的 fallback 行为、选择 sandbox adapter，或为需要沙箱化的 builtin 工具映射 `SandboxExecutionResult`。

#### Scenario: 平台适配后的执行仍使用 sandbox 边界

- **WHEN** 一个 builtin 工具需要沙箱化执行
- **THEN** 平台适配后的 executable facts MUST 交给 executable sandbox runtime 用于 sandbox 请求构造
- **AND** 本 change MUST NOT 创建与之竞争的未沙箱化 fallback 路径

#### Scenario: 没有 sandbox 支持的解释器时 Windows bash 可能不可用

- **WHEN** 在 Windows 上请求 `bash`
- **AND** 当前组合的受限本地或远程 sandbox 路径没有可用的 sandbox 支持或受控 bash 解释器
- **THEN** 系统 MUST 返回安全的不可用结果
- **AND** 它 MUST NOT 要求本 change 定义 Windows bash sandbox adapter
- **AND** 它 MUST NOT 以直接在宿主进程上执行 bash 作为 fallback
