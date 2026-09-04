## 设计决策（Design Decisions）

### D1: Builtin Tool 形态

Write 的 capability id 为小写 `write`，不提供 `Write` alias。它通过 `defineTool` 定义并显式加入 owned builtin Tool list，复用现有 `ToolCatalog`、`BuiltinToolExecutor`、`CapabilityInvocationPort` 和 `CapabilityInvocationResult`。

Tool 实现只接收校验后的业务 input 和受控 dependencies，不接收 `CapabilityInvocationRequest`，也不直接返回 capability result envelope。

### D2: 输入和输出

模型可见输入：

```yaml
file_path: string  # workspace-relative 文件路径
content: string    # 非空文本，UTF 编码后不超过 maxTextBytes
```

成功业务输出：

```yaml
type: create | update
file_path: string  # 规范化 workspace-relative 路径，分隔符为 /
```

Write 不在结果中重复返回新内容、旧内容、diff、字节数或宿主路径。完整调用参数继续由现有 tool-use message 持久化，并通过 `toolCallId` 与结果关联。

### D3: Agent-scoped workspaceFiles 配置

SDK 集成方在受信 Agent 配置中提供：

```typescript
interface WorkspaceFilesConfig {
  readonly readDirectories?: readonly string[];
  readonly writeDirectories?: readonly string[];
  readonly maxTextBytes?: number;
}
```

- `readDirectories` 未配置时保留现有整个 workspace 可读行为。
- `writeDirectories` 默认空；目录自动进入有效 Read 范围。
- 有效 Read 范围为 configured/default Read 范围与 `writeDirectories` 的并集。
- 目录项是规范化 workspace-relative 目录；精确目录及其子目录可访问。
- `"."` 表示整个 workspace；禁止绝对路径、`..`、glob、符号链接、junction、reparse point 和 workspace 逃逸。
- 重叠目录在编译时规范化去重。
- `maxTextBytes` 默认和系统硬上限均为 `256_000` bytes，只允许收紧。
- 非整数、非正数、超过硬上限或非法目录使对应 Agent assembly 编译失败，不静默忽略或降级，也不影响其他 Agent。

配置由 app composition 基于已固化的 Agent assembly/version 创建 Agent-scoped `workspaceFiles` dependency。workspace root、目录授权和配置值不得进入模型 input、Tool result、SafeError、日志、audit 或 metadata。

### D4: 与 Read 共享受控文件边界

`WorkspaceFilePort` 同时拥有 Read 和 Write 所需的窄操作。Read 和 Write Tool 均只调用该 dependency，不直接使用宿主文件 API。

Port 接收可信 `ToolExecutionContext`，并按 `agentId + agentVersion + runId + normalized file path` 维护进程内完整 Read 快照。只有单次 `offset=0` 且 `truncated=false` 的 Read 才形成完整快照；分段读取不拼接为写授权。

已有文件在 Write 前必须存在同一 run 的完整 Read 快照。写入成功后，port 使用新内容更新该 run 的完整快照。快照不持久化，run 结束、进程重启或恢复后必须重新完整 Read。

`workspaceFiles` 不拥有 request lifecycle。`agent-app` 必须通过既有 runtime terminal observation 装配 run cleanup，在 terminal fact 出现后调用 dependency 的内部清理入口；不得为文件快照创建第二套 scheduler、terminal event 或持久化 store。

### D5: 路径和文件类型

`file_path` 必须位于已授权 `writeDirectories` 内。以下输入必须在产生文件副作用前拒绝：

- 绝对路径、UNC、device path、`..`、glob 或 workspace 逃逸；
- 目标或任何已存在父目录是 symlink、junction 或 reparse point；
- 已存在目标的 hard-link count 大于 1；
- 目标是目录、device、socket、FIFO 或其他非普通文件；
- 二进制或不支持的文本编码；
- 空 `content`。

Write 不设置扩展名 allowlist，也不增加与 Read 不一致的固定敏感目录黑名单。目录授权由 SDK 集成方通过 `writeDirectories` 收紧；内容 DLP/secret 治理由后续通用 policy/hook change 承担。

### D6: 文本编码和容量

新文件使用 UTF-8 without BOM。已有文件支持并保留：

- UTF-8 without BOM；
- UTF-8 with BOM；
- UTF-16 LE with BOM；
- UTF-16 BE with BOM。

无 BOM 且不是有效 UTF-8，或无法安全识别为上述文本编码时拒绝覆盖。`content` 的换行按调用方提供值原样写入，不自动保留或转换 LF/CRLF。

Write 输入编码后的字节数不得超过 `workspaceFiles.maxTextBytes`。Read 输出和 Write 输入共享同一限制，保证可覆盖文件能够通过单次完整 Read 建立快照。

### D7: Read-before-Write 和并发防护

新文件不要求预读。已有文件缺少完整快照时返回 `WRITE_REQUIRES_FULL_READ`、category=`CONFLICT`。

进入 mutation section 前必须比较当前目标与完整 Read 快照；取得同目标写锁后、创建任何文件副作用前必须再次校验：

- 已有目标发生变化时返回 `WRITE_TARGET_CHANGED`、category=`CONFLICT`；
- 首次检查时不存在但第二次检查前被创建时同样返回 `WRITE_TARGET_CHANGED`；
- 冲突后不得自动重试，必须重新完整 Read 后再发起 Write。

版本判断必须包含足以避免仅依赖低精度 mtime 的内容或稳定 fingerprint 校验。

### D8: 人工确认和当前可用性

目标架构仍要求每次 create 或 update 都进行 operation-specific runtime-owned 人工确认，不支持 session-wide、路径通配或批量授权。但当前版本先启用 Write，人工确认流程由后续独立 Capability Approval change 实现。

当前 Write 声明 `requiredDependencies: ["workspaceFiles"]`。系统不得注入伪造的 approval readiness，也不得把未确认执行记录为已确认。内置 `default-agent` 显式配置 `writeDirectories: ["."]`，因此可在自身可信 workspace 内调用 Write；其他 Agent 仍由 SDK/集成配置决定目录权限。

后续通用 Capability Approval change 必须：

- 由 runtime 拥有确认 lifecycle；
- 支持 capability invocation 挂起和恢复；
- 提供 create/update、规范化路径以及完整新旧内容的受控确认信息；
- 不把完整内容写入普通 stream、日志、audit、trace、SafeError 或 metadata；
- 恢复 Write 的 `approval` required dependency，并在完成确认及恢复调用后才提供 readiness。

用户拒绝、确认超时和 root cancellation 复用 runtime 通用 pending/approval 结果语义，不新增 Write 专属拒绝或超时错误码。

### D9: 原子写入

第二次版本校验通过后：

1. 在授权 workspace 内递归创建缺失父目录，使用宿主默认安全权限，不接受 `mode`；
2. 在目标同一目录创建不可预测且不覆盖既有文件的临时文件；
3. 写入完整编码内容并完成必要 flush；
4. 使用平台原子替换创建或覆盖目标；
5. 清理本次调用创建的临时文件。

原子替换无法保证时安全失败，不退化为直接覆盖。覆盖不得主动修改原文件权限、执行 chmod、清除 Windows read-only 属性或提权。

写临时文件期间收到 `AbortSignal` 时取消并清理。进入最终原子替换后以文件完整性优先，不承诺中途取消；替换完成即视为写入成功。

### D10: Replay、结果和可观测性

Write replay policy 为 `NON_IDEMPOTENT`。runtime recovery 不得自动重放；timeout 或结果丢失后不得假定未写入，后续尝试必须重新检查目标，已有文件必须重新完整 Read。

日志、audit、trace、metric、SafeError 和 result metadata 不得包含：

- 新旧文件内容或 diff；
- 宿主绝对路径或临时文件名；
- workspace root；
- 高基数目录配置或 fingerprint。

安全观测只允许稳定 invocation/toolCall 标识、capability id、create/update、status、duration bucket 和低基数 reason code。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| input/output schema、显式 catalog 注册、NON_IDEMPOTENT | unit/contract tests |
| 缺少 approval 时 descriptor 仍 AVAILABLE，且不伪造确认 | capability integration tests |
| Agent-scoped 目录配置和非法配置失败 | config/assembly tests |
| workspace、目录授权、symlink/junction/hardlink/special-file negative cases | security integration tests |
| 完整 Read 快照、stale write、新文件竞争 | contract/integration tests |
| UTF 编码、空内容、maxTextBytes | table-driven unit tests |
| 原子写、取消、清理、权限保持 | filesystem integration tests |
| 无直接 node:fs、无第二套 filesystem path | architecture tests |
| 内容和宿主路径不进入安全边界 | output/logging tests |
| OpenSpec 一致性 | `openspec validate --all --strict` |
