## 设计决策（Design Decisions）

### D1: Builtin Tool 形态

Glob 的 capability id 为小写 `glob`，不提供 `Glob` alias。它通过 `defineTool` 定义并显式加入 owned builtin Tool list，复用现有 `ToolCatalog`、`BuiltinToolExecutor`、`CapabilityInvocationPort` 和 `CapabilityInvocationResult`。

Glob metadata 声明：

- `requiredDependencies: ["workspaceFiles"]`
- `replayPolicy: "IDEMPOTENT"`
- provider 继续为 `builtin-tools`

Tool 实现只接收校验后的业务 input、`ToolExecutionContext`、受控 dependencies 和 `AbortSignal`。它不接收 `CapabilityInvocationRequest`，不直接返回 capability result envelope，也不接触 workspace root、宿主绝对路径或 `node:fs`。

Glob 注册到 builtin catalog 后沿用当前 builtin Tool 默认启用策略。可信 Agent binding 可显式禁用，provider enablement 和 capability governance 继续决定最终请求可见 descriptor 和可执行能力。本 change 不新增 `deliveryTarget` 或环境类型，也不为 Glob 改写全局 builtin 默认策略。

### D2: 输入和输出

模型可见输入与 TonyClaw 的核心形态保持一致：

```yaml
pattern: string  # 必填，相对于每个有效搜索根的 glob 模式
path?: string    # 可选，显式 workspace-relative 搜索目录
```

输入 schema 为严格对象，拒绝未知字段。`pattern` 和 `path` 都必须为非空字符串，单项最大 4096 个 UTF-16 code units。

成功业务输出：

```yaml
filenames: string[]  # workspace-relative 规范路径，分隔符为 /
truncated: boolean
```

输出不包含 `durationMs`、`numFiles`、workspace root、宿主路径或文件元数据。匹配数量可由 `filenames.length` 得出，耗时只进入低基数观测信号。

### D3: Glob 模式语义

`pattern` 相对于每个有效搜索根匹配，并支持以下 v1 语法：

- `*`：匹配单个路径段内的零个或多个字符；
- `?`：匹配单个路径段内的一个字符；
- `**`：跨零个或多个目录层级匹配；
- `[abc]`、`[a-z]`、`[!abc]`：字符类；
- `{a,b}`：有限备选项。

路径分隔符统一为 `/`；输入中的 `\` 在 Windows 和 POSIX 上都作为分隔符归一化。Windows 使用大小写不敏感匹配，Linux 和 macOS 使用大小写敏感匹配。Glob 包含隐藏文件，不读取 `.gitignore`、`.ignore` 或其他仓库忽略文件。

v1 不支持 extglob、正则表达式、前导否定 pattern、多个 include/exclude pattern 或 brace range。单个 brace 最多 32 个备选项，整个 pattern 最多产生 256 个组合；超出时返回 `CAPABILITY_INPUT_INVALID`。语法错误、未闭合结构、空备选项、NUL、控制字符、绝对/UNC/device path、drive-qualified path 和任何 `..` 路径段在文件系统访问前被拒绝。

`agent-capability` 将 `picomatch` 声明为直接依赖，仅用于编译和匹配规范化相对路径。目录发现、权限、链接、容量和取消仍由 `workspaceFiles` 拥有；不得依赖传递依赖，不得用 `picomatch`、`tinyglobby` 或其他 glob package 直接遍历文件系统。

### D4: Agent-scoped Read authority

Glob 使用与 Read 相同的有效 Read authority：

- `workspaceFiles.readDirectories` 未配置时，保留整个可信 workspace 可读；
- 配置后，只允许精确目录及其子目录；
- `writeDirectories` 自动并入有效 Read authority；
- authority 和 workspace root 只能来自已固化 Agent assembly/version 的 app composition。

省略 `path` 时，Glob 分别搜索所有有效 Read authority 根目录，即规范化后的 `readDirectories ∪ writeDirectories`；若 `readDirectories` 未配置，则有效根为整个 workspace。重叠根目录在 composition 时收敛，结果合并、去重并排序。

显式 `path` 时，该目录必须规范化为 workspace-relative 路径，并完整位于一个有效 Read authority 根内。Glob 不得通过模型参数、客户端 metadata、Capability 参数或请求体扩大当前 Agent 的 authority。

### D5: 共享 workspaceFiles 边界

`WorkspaceFilePort` 增加窄化的文件发现操作，输入只包含 `pattern` 和规范化前的 workspace-relative `path`，并接收可信 `ToolExecutionContext` 与 `AbortSignal`。

目录授权、workspace containment、文件系统遍历、链接检查、文件类型检查和结果规范化由 `workspaceFiles` dependency 拥有。Glob Tool 本身只负责 schema、metadata 和调用该 operation。

Read、Write 和 Glob 必须共享同一个 Agent assembly/version-scoped dependency。不得新增 Glob 专属 workspace root、filesystem gateway、host process、ripgrep shell command 或第二套目录授权逻辑。Glob 是受控只读文件访问，不经过 sandbox gateway。

### D6: 文件系统和链接边界

搜索起始 `path` 必须存在、位于有效 Read authority 内且是普通目录。遍历时：

- 不跟随 symlink、junction 或任何 reparse point；
- 不返回目录、device、socket、FIFO 或其他非普通文件；
- 只返回仍位于有效 Read authority 和可信 workspace 内的普通文件；
- 搜索根目录不可访问、子目录无权限或出现其他遍历 I/O 错误时，整个调用安全失败，不返回可能误导的部分成功；
- 普通文件在检查期间被并发删除时跳过并继续；symlink、junction 和 reparse point 安全跳过；
- `AbortSignal` 在开始前或遍历中触发时立即停止，不返回部分结果。

Glob 只观察文件名和类型，不读取文件内容，不修改文件、目录、时间戳、权限或其他系统状态。

### D7: 有界遍历和确定性结果

Glob 使用固定硬边界，不允许模型覆盖：

- 最大目录深度：相对于每个搜索根最多 10 个目录边；
- 最大返回结果：500；
- 最大已检查条目：20000。

结果按规范化 workspace-relative 路径进行稳定字典序排序。`truncated=true` 表示至少一个匹配结果因返回上限、深度上限或扫描预算未返回；否则为 `false`。

实现必须在扫描过程中保持有界内存，并在达到扫描预算后停止。对同一稳定文件系统状态和同一输入，输出顺序及 `truncated` 必须一致。并发文件系统变化不承诺快照隔离。

### D8: 错误、取消和可观测性

以下失败在产生外部文件系统副作用前返回稳定 SafeError：

- 非法 input 或 pattern：`CAPABILITY_INPUT_INVALID`，`VALIDATION`；
- 非法、越权或逃逸路径：`CAPABILITY_PATH_REJECTED`，`AUTHORIZATION`；
- 起始目录不存在、不是目录或遍历 I/O 失败：复用现有安全文件不可用错误语义；
- dependency 缺失：descriptor 在执行前为 `UNAVAILABLE`；
- 取消和超时：复用现有 capability/runtime cancellation 语义。

不得把 raw host exception、pattern、`path`、文件名、workspace root、宿主绝对路径或目录配置写入日志、metric、trace、audit、SafeError 或 result metadata。安全观测只允许稳定 invocation/toolCall 标识、capability id、status、duration bucket、result-count bucket、`truncated` 和低基数 reason code。

### D9: 架构与归档

实现归属：

- `agent-capability`：Glob Tool definition、schema、受控 workspace file discovery 和相关测试；
- `agent-app`：继续在唯一 composition root 中按已固化 Agent assembly/version 创建 `workspaceFiles` dependency；
- `agent-runtime`、`agent-core`、`agent-channel-web`：无 Glob 专属 lifecycle、routing 或 DTO。

归档时将 `glob-tool` 新规格提升为 baseline，并把 `workspaceFiles` 的发现 operation 合并进 `builtin-tool-framework` baseline。不得创建不存在的 `agent-builtin-tools` package 或平行公共 Tool contract。

## 验证映射（Verification Map）

| 验证点 | 验证入口 |
|---|---|
| 小写 id、schema、IDEMPOTENT、显式 catalog | unit/contract tests |
| builtin 默认启用、Agent 显式禁用和 dependency readiness | capability integration tests |
| pattern 语法、隐藏文件、ignore 行为、跨平台分隔符 | table-driven unit tests |
| Read authority、workspace containment、非法路径 | security integration tests |
| symlink/junction/reparse/special-file negative cases | filesystem integration tests |
| 深度、结果、扫描预算和稳定排序 | capacity/integration tests |
| 取消、I/O 失败和无部分成功 | integration tests |
| 无直接 `node:fs`、sandbox、shell/ripgrep 路径 | architecture tests |
| 敏感路径/pattern 不进入安全边界 | output/logging tests |
| OpenSpec 一致性 | `openspec validate --all --strict` |
