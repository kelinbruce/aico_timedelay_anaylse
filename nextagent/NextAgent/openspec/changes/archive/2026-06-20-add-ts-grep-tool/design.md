## 设计决策（Design Decisions）

### D1: Builtin Tool 形态

Grep 的 capability id 为 PascalCase `Grep`，不提供 lowercase `grep` alias。它通过 `defineTool` 定义并显式加入 owned builtin Tool list，复用现有 `ToolCatalog`、`BuiltinToolExecutor`、`CapabilityInvocationPort` 和 `CapabilityInvocationResult`。

Grep metadata 声明：

- `requiredDependencies: ["workspaceFiles"]`
- `replayPolicy: "IDEMPOTENT"`
- provider 继续为 `builtin-tools`

Tool 实现只接收校验后的业务 input、`ToolExecutionContext`、受控 dependencies 和 `AbortSignal`。它不接收 `CapabilityInvocationRequest`，不直接返回 capability result envelope，也不接触 workspace root、宿主绝对路径、`node:fs`、宿主 shell 或 ripgrep。

Grep 注册到 builtin catalog 后沿用当前 builtin Tool 默认启用策略。可信 Agent binding 可显式禁用，provider enablement 和 capability governance 继续决定最终请求可见 descriptor 和可执行能力。本 change 不新增 `deliveryTarget`、环境类型或 Grep 专属 visibility policy。

### D2: 输入和输出

模型可见输入：

```yaml
pattern: string          # 必填，相对于每个有效搜索根的 ECMAScript 正则
path?: string            # 可选，显式 workspace-relative 搜索目录
glob_filter?: string     # 可选，相对于同一搜索根的 glob 模式，限定候选文件
output_mode?: "files_with_matches" | "content"  # 可选，默认 files_with_matches
case_insensitive?: boolean  # 可选，默认 false
max_results?: integer    # 可选，受硬边界限制，默认 100，上限 500
```

输入 schema 为严格对象，拒绝未知字段。所有字符串最大 4096 个 UTF-16 code units；`max_results` 必须为正整数且不超过 500。

成功业务输出（`files_with_matches` 模式）：

```yaml
filenames: string[]           # workspace-relative 规范路径，分隔符为 /
total_files_with_matches: integer
total_matches: integer
truncated: boolean
```

成功业务输出（`content` 模式）：

```yaml
matches: { file_path: string; line_number: integer; line: string }[]
total_files_with_matches: integer
total_matches: integer
truncated: boolean
```

输出不包含 `durationMs`、workspace root、宿主路径、文件元数据、未匹配行内容或宿主读取异常。耗时只进入低基数观测信号。

### D3: 正则与模式语义

`pattern` 必须是受信任的 ECMAScript 正则字面量；Grep 在执行前 `new RegExp(pattern, flags)` 编译，对应 flags 来自 `case_insensitive`（其它 flag 由 Grep 固定为 `g`）。`pattern` 长度受 4096 限制。

`pattern` 在编译前必须通过与 `glob` 相同的目录与路径语法过滤：禁止绝对路径、UNC、device path、drive-qualified path、任何 `..` 段、NUL 与控制字符；这些情况在编译前返回 `CAPABILITY_INPUT_INVALID`。

`pattern` 的语法或运行时构造错误同样返回 `CAPABILITY_INPUT_INVALID`，不读取任何文件。

`glob_filter` 复用与 `glob-tool` 相同的便携子集与硬边界：32 alternatives per brace、256 total combinations；同样在编译前拒绝非法、绝对、转义或扩展过度的模式。

匹配按 UTF-16 code unit 顺序逐行处理；`content` 模式下最长匹配行长 4096 code units，超长行视为不匹配但仍计入已读取字节与已检查条目。

### D4: Agent-scoped Read authority

Grep 使用与 Read、Glob 相同的有效 Read authority：

- `workspaceFiles.readDirectories` 未配置时，保留整个可信 workspace 可读；
- 配置后，只允许精确目录及其子目录；
- `writeDirectories` 自动并入有效 Read authority；
- authority 和 workspace root 只能来自已固化 Agent assembly/version 的 app composition。

省略 `path` 时，Grep 分别搜索所有有效 Read authority 根目录；显式 `path` 时，该目录必须规范化为 workspace-relative 路径，并完整位于一个有效 Read authority 根内。模型参数、客户端 metadata、Capability 参数或请求体不得扩大当前 Agent 的 authority。

### D5: 共享 workspaceFiles 边界

`WorkspaceFilePort` 增加窄化的内容搜索操作，输入只包含 grep 业务 input 和规范化前的 workspace-relative `path`，并接收可信 `ToolExecutionContext` 与 `AbortSignal`。

目录授权、workspace containment、文件系统遍历、链接检查、文件类型检查、二进制文件跳过、读取预算和结果规范化由 `workspaceFiles` dependency 拥有。Grep Tool 本身只负责 schema、metadata 和调用该 operation。

Read、Write、Glob 和 Grep 必须共享同一个 Agent assembly/version-scoped dependency。不得新增 Grep 专属 workspace root、filesystem gateway、host process、ripgrep shell command、`child_process` 调用路径或第二套目录授权逻辑。Grep 是受控只读文件内容访问，不经过 sandbox gateway。

### D6: 文件系统和链接边界

搜索起始 `path` 必须存在、位于有效 Read authority 内且是普通目录。遍历时：

- 不跟随 symlink、junction 或任何 reparse point；
- 只读取普通文件，跳过目录、device、socket、FIFO、字符/块设备与其它特殊文件；
- 二进制文件（包含 NUL 字节的前 8 KiB 扫描窗）整文件跳过，不计入 `total_matches`；
- 搜索根目录不可访问、子目录无权限或出现其他遍历 I/O 错误时，整个调用安全失败，不返回可能误导的部分成功；
- 普通文件在检查期间被并发删除时跳过并继续；symlink、junction 和 reparse point 安全跳过；
- `AbortSignal` 在开始前或遍历中触发时立即停止，不返回部分结果。

Grep 只观察文件内容用于匹配，不修改文件、目录、时间戳、权限或其他系统状态。

### D7: 有界匹配和决定性结果

Grep 使用固定硬边界，不允许模型覆盖单文件读取量与扫描预算：

- 每文件最多读取 `defaultMaxReadBytes = 512 KiB`（`workspaceFiles` option 仍可下浮）；
- 单个匹配行长 4096 code units；
- 最多匹配 500 个结果；
- 最多检查 20000 个文件系统条目；
- 最多读取 `maxTotalReadBytes = 32 MiB` 内容。

`max_results` 在模型显式传入时优先（受 500 上限），不暴露其它限制。`files_with_matches` 模式下，每个匹配文件只贡献 1 个返回条目；`content` 模式下，每个匹配行贡献 1 个返回条目。

结果按 `(file_path, line_number)` 稳定字典序排序；`files_with_matches` 模式同时附带 `total_matches` 与 `total_files_with_matches`，`content` 模式同时附带 `total_matches` 与 `total_files_with_matches`；`truncated=true` 表示至少一个匹配结果因 `max_results`、文件读取上限、深度上限、扫描预算或读取总字节上限未返回。

实现必须在扫描过程中保持有界内存，并在达到扫描预算后停止。对同一稳定文件系统状态和同一输入，输出顺序及 `truncated` 必须一致。

### D8: 错误、取消和可观测性

以下失败在产生外部文件系统副作用前返回稳定 SafeError：

- 非法 input、pattern、glob_filter：`CAPABILITY_INPUT_INVALID`，`VALIDATION`；
- 非法、越权或逃逸路径：`CAPABILITY_PATH_REJECTED`，`AUTHORIZATION`；
- 起始目录不存在、不是目录或遍历 I/O 失败：复用现有安全文件不可用错误语义；
- dependency 缺失：descriptor 在执行前为 `UNAVAILABLE`；
- 取消和超时：复用现有 capability/runtime cancellation 语义。

不得把 raw host exception、pattern、`path`、glob_filter、文件名、文件内容片段、workspace root、宿主绝对路径或目录配置写入日志、metric、trace、audit、SafeError 或 result metadata。安全观测只允许稳定 invocation/toolCall 标识、capability id、status、duration bucket、result-count bucket、`truncated` 和低基数 reason code。

### D9: 架构与归档

实现归属：

- `agent-capability`：Grep Tool definition、schema、受控 workspace file content search 和相关测试；
- `agent-app`：继续在唯一 composition root 中按已固化 Agent assembly/version 创建 `workspaceFiles` dependency；
- `agent-runtime`、`agent-core`、`agent-channel-web`：无 Grep 专属 lifecycle、routing 或 DTO。

归档时将 `grep-tool` 新规格提升为 baseline，并把 `workspaceFiles` 的内容搜索 operation 合并进 `builtin-tool-framework` baseline。不得创建不存在的 `agent-builtin-tools` package、平行公共 Tool contract 或 ripgrep 子进程。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| 小写 id、schema、IDEMPOTENT、显式 catalog | unit/contract tests |
| builtin 默认启用、Agent 显式禁用和 dependency readiness | capability integration tests |
| 正则语法、`case_insensitive`、跨平台分隔符、`glob_filter` 协同 | table-driven unit tests |
| Read authority、workspace containment、非法路径 | security integration tests |
| symlink/junction/reparse/special-file/binary 跳过负例 | filesystem integration tests |
| 文件读取上限、扫描预算、决定性截断 | capacity/integration tests |
| 取消、I/O 失败和无部分成功 | integration tests |
| 无直接 `node:fs`、sandbox、shell/ripgrep 路径 | architecture tests |
| 敏感路径/pattern/内容不进入安全边界 | output/logging tests |
| OpenSpec 一致性 | `openspec validate --all --strict` |
