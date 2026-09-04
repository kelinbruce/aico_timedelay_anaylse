## 背景与问题（Why）

内置工具（Builtin Tools，如 bash、python、glob、read、write）需要在首版受支持平台上提供一致的平台适配语义。不同平台（Windows、Linux）上的工具执行环境存在差异：
- 路径分隔符不同（`\` vs `/`）
- 命令行参数格式不同（`--flag value` vs `/flag:value`）
- 环境变量格式不同
- 脚本解释器不同（bash vs cmd.exe vs powershell）

`add-ts-cross-platform-executable-semantics` 旨在为 **Builtin Tool** 定义跨平台可执行事实适配抽象，确保：
- Builtin Tool 定义与平台解耦
- Builtin Tool 在 Windows/Linux 上形成一致的 platform-adapted executable facts
- 平台差异可被正确适配
- 跨平台规则只处理 bash/python 解释器受控解析、工作目录和文件路径归一化、参数/env 归一等执行前事实，不改变 Capability 公共契约，也不拥有 sandbox 执行或结果映射

**Scope**：本 change **仅适用于 Builtin Tool**。API-backed Tool、Skill Tool、Agent Tool 等其他 Tool 类型由各自的 source/provider 自行处理平台差异，不在本 change 范围内。

## 变更范围（What Changes）

- **新增** `add-ts-cross-platform-executable-semantics` change
- **新增** `agent-capability` 内部的 executable facts 准备路径，首版围绕 bash/python 形成 `PlatformAdaptedExecutableFacts` 或等价内部结果
- **新增** Builtin Tool 的 bash/python 受控解释器解析、工作目录、文件路径归一化和 env allowlist 的跨平台一致性约束
- **明确** 首版不要求建立通用 `CrossPlatformDescriptor` / `PlatformAdapterRegistry` 框架；只有出现多个 builtin 可执行族共享复杂平台差异时，才可在后续独立收敛中抽象
- **明确** timeout、stdout/stderr 大小限制、exit code 和 sandbox failure 的最终执行结果映射由 `add-ts-executable-tool-sandbox-runtime` 拥有；本 change 只提供平台适配后的可执行事实和执行前校验结果
- **无修改** `add-ts-capability-core-governance` 基线：跨平台语义是内部执行层 concern，不修改 CapabilityDescriptor 公共契约
- **无修改** `agent-contracts`：所有接口均为 `agent-capability` 内部实现

## Capability 影响（Capabilities）

### 新增的内部实现
- `agent-capability` 内部 - `prepareBuiltinExecutableFacts(...)` 或等价内部 helper、`PlatformAdaptedExecutableFacts`、最小执行上下文输入

### 无修改
- `agent-contracts` - **无修改**，不新增公共契约接口
- `CapabilityDescriptor` - **无修改**，跨平台语义是内部执行层 concern

## 影响范围（Impact）

- `modules/agent-contracts` - **无影响**
- `modules/agent-capability` - 新增内部 bash/python executable facts 准备逻辑；不强制新增通用 adapter registry
- `modules/agent-runtime` - 无直接影响；runtime 不接收跨平台 public payload，也不执行平台适配后的工具

## 外部依赖

- 无外部依赖

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- **不适用于 API-backed Tool、Skill Tool、Agent Tool 等其他 Tool 类型**
- 不定义通用平台适配框架或未来工具族扩展点
- 不定义跨平台工具的打包和分发机制
- 不定义平台特定的安全策略（由 sandbox runtime 处理）
- 不定义 sandbox gateway 核心设计、discovery 行为、执行编排、sandbox adapter、sandbox execution result mapping 或跨平台执行回退策略
- 不要求 Windows 平台必须提供 bash sandbox adapter；local 默认 restricted sandbox 或 remote sandbox 缺少 sandbox-backed / 受控 bash 解释器时返回 safe unavailable，不定义 unsandboxed host execution fallback
- 不实现 macOS platform adapter；首版只覆盖 Windows 和 Linux，macOS 作为后续独立扩展
