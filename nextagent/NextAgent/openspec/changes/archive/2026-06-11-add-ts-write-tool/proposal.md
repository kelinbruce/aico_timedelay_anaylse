## 背景与问题（Why）

NextAgent 需要一个受治理的内置 `write` Tool，用于在当前 Agent 的可信 workspace 内创建或完整重写文本文件。原始规格中的宿主绝对路径、未定义文件访问控制和 YAML Tool 注册方式，与当前可信 workspace、显式 Builtin Tool catalog 和 Tool dependency 架构冲突。

Write 具有文件副作用，最终目标仍是每次 create/update 都经过 runtime-owned 人工确认。当前系统尚未具备 Capability 发起确认、挂起 Tool 调用、提交答案并恢复原调用的完整产品路径。根据当前交付决策，本 change 先在保留全部 workspace 文件安全边界的前提下启用 Write，人工确认由后续独立 Capability Approval change 实现。

## 变更范围（What Changes）

- **新增** 小写 `write` Builtin Tool，通过 `defineTool` 和 owned builtin Tool list 显式注册。
- **扩展** `workspaceFiles` 受控 dependency，使 Read 和 Write 共享可信 workspace、目录授权、文本大小和 request/run 局部完整读取快照。
- **新增** Agent-scoped `workspaceFiles.readDirectories`、`writeDirectories` 和 `maxTextBytes` 可信配置；模型和 capability 参数不能覆盖。
- **新增** workspace 内文本文件创建、完整重写、并发修改防护、原子替换、编码保持和安全结果语义。
- **启用** 当前 Write：仅要求 `workspaceFiles` dependency，不伪造 approval readiness，不建立私有确认流。
- **默认配置** 内置 `default-agent` 的 `writeDirectories` 为 `["."]`，允许其在自身可信 workspace 内写入；其他 Agent 仍须由集成方显式配置。
- **明确延期** 通用 Capability Approval contract、全量确认信息、Tool 调用挂起/恢复和 channel answer 接入由后续独立 change 定义；落地后必须恢复 operation-specific approval。

## Capability 影响（Capabilities）

### 新增 Capability

- `write-tool`：受治理的 workspace 文本文件创建和完整重写能力。

### 修改的 Capability

- `builtin-tool-framework`：扩展受控 `workspaceFiles` dependency，并预留后续 `approval` dependency 名称。
- `app-config-schema`：增加 Agent-scoped workspace file access 配置的编译和校验要求。

## 非目标（Non-Goals）

- 不在本 change 实现通用 Capability Approval contract、私有确认状态机、UI 展示或完整内容确认 payload。
- 不实现 Edit、patch、append、binary write、chmod、提权、文件历史、Git diff、LSP 通知或内容 DLP/secret 扫描。
- 不允许 Write 直接使用 `node:fs`、宿主绝对路径、sandbox process execution 或 gateway-local private implementation。
- 不放宽目录授权、完整 Read、并发冲突、链接、特殊文件、编码、容量、原子写、取消或安全输出约束。
