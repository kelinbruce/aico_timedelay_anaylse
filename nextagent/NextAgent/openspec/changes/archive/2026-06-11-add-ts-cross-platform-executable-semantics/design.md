## 背景和现状（Context）

当前 NextAgent 已经具备基础的 capability 发现和调用能力：

- `BuiltinToolModule` 提供静态注册的内置工具
- `SandboxGatewayPort`（`agent-contracts/gateway`）提供沙箱执行环境
- `CapabilityDescriptor` 提供统一的能力描述格式

缺口在于**没有跨平台可执行事实适配抽象**：
- 不同平台上的相同工具在提交 sandbox 前形成的命令、参数、路径和环境事实可能不一致
- 工具定义中的路径、环境变量等缺乏平台适配
- executor 内部缺少平台信息、工作目录和文件路径归一化的统一传递方式

## 目标和非目标（Goals / Non-Goals）

### 目标

- 建立内置工具的跨平台执行前适配机制，首版通过 `agent-capability` 内部 helper 为 bash/python 产出 platform-adapted executable facts
- 定义 bash/python 等解释器解析、工作目录、文件路径归一化和环境变量 allowlist 的一致语义
- 明确 timeout、stdout/stderr 大小限制、exit code 和 sandbox failure 的最终结果映射由 `add-ts-executable-tool-sandbox-runtime` 拥有

### 非目标

- **不适用于 API-backed Tool、Skill Tool、Agent Tool 等其他 Tool 类型** — 其他 Tool 类型由各自的 source/provider 自行处理平台差异
- 不定义 macOS 适配实现；首版只实现 Windows/Linux
- 不定义工具的打包和分发格式
- 不定义平台特定的安全策略
- 不定义跨平台调试工具
- 不定义 sandbox gateway 核心设计、discovery 行为、执行编排、sandbox adapter、sandbox execution result mapping 或跨平台执行回退策略
- 不修改 `CapabilityInvocationRequest`、`SandboxGatewayPort` 或任何 `agent-contracts` 公共契约
- 不要求 Windows 平台必须提供 bash sandbox adapter；local 默认 restricted sandbox 或 remote sandbox 缺少 sandbox-backed / 受控 bash 解释器时安全失败

## 黑盒目标（Blackbox Goal）

当 Builtin Tool invocation 需要形成可执行工作项时，本 change 在 `agent-capability` executor 内部基于当前可信平台、受控解释器配置、工作目录根、参数模板和 env allowlist，产出 platform-adapted executable facts。该产物只作为 `add-ts-executable-tool-sandbox-runtime` 构造 `SandboxExecutionRequest` 的输入；本 change 不启动命令、不调用 `SandboxGatewayPort`、不选择 sandbox adapter，也不把 `SandboxExecutionResult` 映射为 `CapabilityInvocationResult`。

## 相邻 Change 边界（Adjacent Change Boundaries）

- `add-ts-executable-tool-sandbox-runtime`：拥有 sandbox execution 主链，包括 `SandboxExecutionRequest` 构造、`SandboxGatewayPort` 调用、timeout/output/exit code/sandbox failure 的最终结果映射和最小安全 observability；真实远端 sandbox 平台实现不归本 change。
- `add-ts-sandbox-deny-by-default-adapter`：拥有 restricted local / remote sandbox 不可用、禁用、未配置或平台不支持时的 deny/unavailable adapter，不消费本 change 的平台细节来尝试执行。
- `add-ts-gateway-configuration`：拥有 gateway section 配置冻结，不拥有平台适配或 sandbox execution。

## 设计决策（Design Decisions）

### D1: Minimal Executable Facts Preparation

**Decision**: 首版不建立通用 `CrossPlatformDescriptor` / `PlatformAdapterRegistry` 框架，而是在 `agent-capability` executor 内部提供 `prepareBuiltinExecutableFacts(...)` 或等价 helper，专门服务 bash/python 的执行前事实准备。

**Rationale**:
- 当前代码已有 bash tool 和 sandbox gateway path，最小增量是把 bash/python 提交前事实收敛到一个内部准备点
- 只有 bash/python 需要首版受控解释器、工作目录和 env allowlist 语义，提前铺 registry 会制造无验证收益的扩展点
- helper 仍保持工具定义与平台执行细节分离，但不把未来框架固化为当前任务

### D2: Trusted Execution Context Input

**Decision**: executor 内部 helper 的输入只能来自可信 app composition、resolved AgentAssembly、tool execution context 或已治理配置；不得从 `CapabilityInvocationRequest` public payload 读取 `platform`、`arch`、`workingDir`、`workspaceRoot` 或等价字段。

**Rationale**:
- 平台、工作目录根和解释器配置是可信装配事实，不是客户端可覆盖输入
- 这些信息不得添加到 `CapabilityInvocationRequest` public payload，也不得要求修改 sandbox gateway contract

### D3: Scope Limited To Executable Builtin Tools

**Decision**: 本 change 的内部 executable facts 准备路径仅适用于 Builtin Tool 中需要 sandbox execution 的 bash/python 类可执行工具，**不适用于** API-backed Tool、Skill Tool、Agent Tool 等其他 Tool 类型。

**Rationale**:
- Builtin Tool（bash、python 等）是平台相关的可执行工具，需要在 executor 内部进行平台适配
- API-backed Tool、Skill Tool、Agent Tool 等由各自的 source/provider 自行处理平台差异，不走此路径
- 平台适配是内部执行层 concern，不应泄漏到 capability descriptor 公共 API
- CapabilityDescriptor 是静态声明元数据，不应包含运行时执行路径/参数/环境变量等执行细节
- 避免污染已冻结的 `CapabilityDescriptor` 契约

### D4: Helper Resolves Platform-Specifics

**Decision**: 内部 helper 负责把已解析的 builtin tool invocation、可信执行上下文和受控配置转换为平台特定的可执行事实，或者返回解释器缺失、工作目录逃逸、env allowlist 拒绝、platform unsupported 等执行前 safe failure。

**Rationale**:
- 工具执行路径只需要一个提交前事实来源
- helper 处理路径分隔符、参数格式、解释器来源、工作目录和 env allowlist 等差异
- 该事实随后交给 `add-ts-executable-tool-sandbox-runtime` 进入 sandbox gateway path

### D5: Supported Platform Rule

**Decision**: 首版支持 Windows 和 Linux。bash/python 的平台支持由内部规则和受控解释器配置决定；macOS 不在首版实现范围。缺少受控解释器或平台不支持时返回 safe failure，不尝试 ad hoc host execution。

**Rationale**:
- 不是所有工具都支持所有平台
- Windows bash 不得静默切换 PowerShell
- Python 不得默认查系统 PATH

### D6: Interpreter, working directory, and environment normalization

内置工具请求 `bash`、`python` 等解释器时，内部 facts helper 必须使用显式配置或平台可识别的受控来源解析为允许的二进制引用，不能把不确定的系统 `PATH` 当作默认答案。

- Windows 上请求 `bash` 不得静默切换为 PowerShell；local 默认 restricted sandbox 或 remote sandbox 缺少 sandbox-backed / 受控 bash 解释器时返回 unavailable SafeError。
- 请求 `python` 必须使用已配置解释器引用；缺失解释器返回 unavailable SafeError。
- 工作目录必须落在 sandbox 分配目录或 Skill root 的安全子目录内，归一后不得逃逸允许根目录。
- 环境变量必须经过 allowlist 过滤；raw secret 不得进入诊断、日志、审计、stream 或 SafeError。
- 解释器缺失、工作目录逃逸、env allowlist 拒绝和 platform unsupported 必须在 sandbox submission 前返回稳定 safe failure。
- command not found、permission denied、timeout、canceled、non-zero exit 和 output too large 等真实执行结果由 `add-ts-executable-tool-sandbox-runtime` 基于 `SandboxExecutionResult` 做最终映射；本 change 只定义这些结果不得导致 unsandboxed fallback。

## 选定方案（Chosen Design）

### 1. 内部 executable facts 准备模型

```typescript
type SupportedPlatform = "WINDOWS" | "LINUX" | "ALL"

interface PlatformAdaptedExecutableFacts {
  executable: "bash" | "python";
  command: string;
  args: readonly string[];
  workingDirectoryRef?: string;
  environment: Record<string, string>;
}

interface BuiltinExecutableFactsInput {
  toolId: string;
  platform: SupportedPlatform;
  invocation: JsonObject;
  allowedRoots: readonly string[];
  interpreterConfig: JsonObject;
  environmentAllowlist: readonly string[];
}
```

### 2. 跨平台工具适配流程

```
[BuiltinToolInvocation]
    │
    ▼
[Build trusted facts input]
    │
    ▼
[prepareBuiltinExecutableFacts(...)]
    │
    ├── resolve controlled interpreter
    ├── normalize working directory
    ├── filter environment allowlist
    └── produce pre-submission safe failure when invalid
    │
    ▼
[Build PlatformAdaptedExecutableFacts]
    │
    ▼
[Hand off to add-ts-executable-tool-sandbox-runtime]
    │
    ▼
[Sandbox runtime builds SandboxExecutionRequest and maps result]
```

## 接口位置

| 接口 | 模块 | 说明 |
|------|------|------|
| `prepareBuiltinExecutableFacts(...)` 或等价 helper | agent-capability (内部) | 首版 bash/python 执行前事实准备入口 |
| `PlatformAdaptedExecutableFacts` | agent-capability (内部) | 适配后的可执行事实，仅 executor 内部流转并交给 sandbox runtime |
| helper 输入结构 | agent-capability (内部) | 从可信 app composition、AgentAssembly、tool execution context 或配置派生，不进入 public payload |

**重要**：以上所有接口均为 `agent-capability` 内部实现接口，不进入 `agent-contracts` 公共契约。

## 影响模块

| 模块 | 影响 |
|------|------|
| agent-contracts | **无影响** - 不新增公共契约接口 |
| agent-capability | 新增内部 bash/python executable facts 准备逻辑 |
| agent-runtime | 无直接影响；runtime 不接收跨平台 public payload |

## 与其他 Change 的关系

### 依赖

- `add-ts-capability-core-governance`: **无继承**，跨平台适配是 executor 内部 concern
- `add-ts-executable-tool-sandbox-runtime`: 需要沙箱的工具把平台适配结果交给 executable sandbox runtime 构造既有 sandbox request；本 change 不修改 sandbox contract，不拥有 sandbox execution result mapping

### 被依赖

- `add-ts-api-backed-tool-source`: CLIP-backed 工具可选择支持跨平台（内部集成）
- `add-ts-capability-conflict-resolution`: 冲突解决**无需**考虑跨平台描述符（内部实现细节）

## 与既有静态兼容性事实的关系

本 change 只定义 builtin tool executor 内部的平台执行适配。若上游已经提供静态平台兼容性事实，executor 可以消费这些事实判断工具是否适合当前平台，但本 change **不得**新增、要求、重解释或 refinement 任何 `CapabilityDescriptor` 兼容性字段。

| 对象 | 用途 | 所在层级 |
|---|---|---|
| 既有静态兼容性事实 | 判断某个已治理 tool 是否适合当前平台 | 上游 discovery/catalog 输入 |
| `prepareBuiltinExecutableFacts(...)` 或等价 helper | 在 invocation 时将已允许执行的 builtin tool 适配为当前平台的命令、路径、参数和环境事实 | `agent-capability` executor 内部 |

关系：
- 本 change 只消费既有静态事实，不新增或要求 `CapabilityDescriptor`、`CapabilityInvocationRequest`、`SandboxGatewayPort` 或任何 `agent-contracts` public surface 字段。
- 对于 executable builtin tool，内部 helper 在 executor 内部提供运行时平台适配能力，不进入 public descriptor 或 invocation payload，且不直接执行。
- 静态事实回答“此 tool 是否适合当前平台”；内部 helper 回答“已允许执行的 builtin tool 在该平台上如何形成 sandbox submission facts”。
