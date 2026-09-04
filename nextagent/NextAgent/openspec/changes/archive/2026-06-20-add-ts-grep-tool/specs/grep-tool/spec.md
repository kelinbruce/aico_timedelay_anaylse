## ADDED Requirements

### Requirement: Grep 是显式受治理的内建 Tool

系统 SHALL 提供一个通过 `defineTool` 定义并显式注册在自有内建 Tool 清单中的 PascalCase `Grep` 内建 Tool。该 Tool SHALL 要求受控的 `workspaceFiles` 依赖，并 SHALL 声明 `IDEMPOTENT` replay policy。

该 Tool SHALL NOT 引入小写别名、隐式注册、平行调用 contract、交付目标 contract、Grep 专用 provider、宿主 shell 命令或 ripgrep 包装。

#### Scenario: Grep descriptor 通过既有框架投影

- **WHEN** 内建 Tool catalog 组合时带有 `workspaceFiles`
- **THEN** 它通过既有 capability 发现路径暴露 `Grep` descriptor
- **AND** 可执行查找保持 provider 感知

#### Scenario: 缺失依赖阻止执行

- **WHEN** 内建 Tool catalog 组合时不带 `workspaceFiles`
- **THEN** `Grep` 在调用之前不可用
- **AND** 不执行任何文件系统搜索

#### Scenario: 既有内建治理控制 model 可见性

- **WHEN** `Grep` 被注册为内建 Tool
- **THEN** 它遵循既有的内建默认启用 policy
- **AND** 显式禁用的 Agent binding 会将其从 request 可见的 capability 视图中移除
- **AND** 本 change 不引入 Grep 专属的交付或可见性 policy

### Requirement: Grep 具有严格的 pattern 与路径 contract

Grep SHALL 接受一个严格对象，包含：

- `pattern`（字符串，必需）：一个非空的 ECMAScript 正则表达式 source，应用于每个候选文件的每一行；
- `path`（字符串，可选）：一个非空的显式 workspace 相对搜索目录；
- `glob_filter`（字符串，可选）：一个非空的可移植 glob pattern，将候选文件限定为其匹配集合；
- `output_mode`（`files_with_matches` 或 `content`，可选，默认 `files_with_matches`）：返回的 payload 形状；
- `case_insensitive`（布尔，可选，默认 `false`）：regex 是否以 `i` 标志编译；
- `max_results`（整数，可选，默认 `100`，范围 `1..500`）：返回匹配或匹配文件的上限。

每个字符串 SHALL 至多包含 4096 个 UTF-16 code unit。`max_results` SHALL 是不超过 500 的正整数。未知属性 SHALL 被拒绝。

对于 `files_with_matches` 模式，Grep SHALL 返回：

- `filenames`：使用 `/` 的规范化 workspace 相对普通文件路径；
- `total_files_with_matches`：至少包含一个匹配的不同文件的整数计数；
- `total_matches`：在硬预算下观察到的所有匹配的整数计数；
- `truncated`：是否至少有一个匹配被硬边界省略。

对于 `content` 模式，Grep SHALL 返回：

- `matches`：一个对象数组，每个对象带有 `file_path`、`line_number`（1 起始）和 `line`（被匹配的行，截断到 4096 个 code unit）；
- `total_files_with_matches`：至少包含一个匹配的不同文件的整数计数；
- `total_matches`：在硬预算下观察到的所有匹配的整数计数；
- `truncated`：是否至少有一个匹配被硬边界省略。

输出 SHALL NOT 包含 duration、regex source、解析后的路径、glob 过滤器、workspace 根、宿主绝对路径、完整文件内容或未匹配的行。

#### Scenario: 最小有效输入使用全部有效 Read 根

- **WHEN** model 只以一个有效的 `pattern` 调用 `Grep`
- **THEN** Grep 搜索有效 Read 与 Write 根的规范化并集
- **AND** 缺失的 `readDirectories` 配置意味着整个 workspace 是有效根
- **AND** 匹配的文件名以 `files_with_matches` 输出形状返回

#### Scenario: Content 模式返回带稳定 key 的匹配行

- **WHEN** model 以 `output_mode="content"` 调用 `Grep`
- **THEN** `matches` 中的每个条目带有 `file_path`、`line_number` 和 `line`
- **AND** `line` 是被匹配的行，截断到 4096 个 code unit
- **AND** 未匹配的行和完整文件内容不存在

#### Scenario: 未知输入在搜索前被拒绝

- **WHEN** 调用包含未知属性、空字符串、超长字符串、错误的值类型或超出 `1..500` 的 `max_results`
- **THEN** 调用以安全的校验错误失败
- **AND** 不执行任何文件系统搜索

### Requirement: Grep 使用定义的 Regex 与 Glob 子集

Grep SHALL 在任何文件系统访问之前通过 `new RegExp(pattern, "g" + (case_insensitive ? "i" : ""))` 编译 `pattern`。该 regex SHALL 在 UTF-16 code unit 上逐行匹配。Grep SHALL 以 `CAPABILITY_INPUT_INVALID` 拒绝包含绝对路径、UNC 路径、设备路径、带盘符限定路径、任何 `..` 段、NUL 或控制字符的 pattern source。Regex 编译错误也 SHALL 以 `CAPABILITY_INPUT_INVALID` 拒绝，并 SHALL NOT 读取任何文件。

当 `glob_filter` 存在时，Grep SHALL 应用与 `glob` Tool 相同的可移植子集：`*`、`?`、`**`、字符类、取反字符类和有限的 brace 备选。每个 brace SHALL 至多包含 32 个备选，完整 pattern SHALL 展开为至多 256 个组合。Grep SHALL 在文件系统访问之前拒绝畸形构造、extglob、正则表达式、前导取反 pattern、空 brace 备选、brace 范围、NUL、控制字符、绝对路径、UNC 路径、设备路径、带盘符限定路径和任何 `..` 段。`/` SHALL 是规范 pattern 分隔符，`\` SHALL 在所有受支持宿主上规范化为分隔符。匹配 SHALL 包含隐藏文件，并 SHALL NOT 读取或应用 `.gitignore`、`.ignore` 或其他仓库忽略文件。匹配 SHALL 在 Windows 上大小写不敏感，在 Linux 和 macOS 上大小写敏感。

#### Scenario: Regex 在所选路径下跨多个文件匹配

- **WHEN** `pattern="alarmId=\\d+"` 在一个已授权路径下求值
- **THEN** Grep 编译该 regex，扫描候选文件，并只返回至少包含一个匹配的文件
- **AND** 返回的名称相对于可信 workspace

#### Scenario: 非法 regex 或转义 pattern 被拒绝

- **WHEN** `pattern` 不可编译、包含绝对路径、包含父目录段或包含控制字符
- **THEN** Grep 返回安全的校验错误
- **AND** 不读取任何文件

#### Scenario: glob_filter 收窄候选文件

- **WHEN** model 以 `pattern` 和 `glob_filter="*.log"` 调用 `Grep`
- **THEN** 只有相对路径匹配该 glob 的普通文件被扫描内容匹配
- **AND** 不匹配的文件在不产生 I/O 的情况下被排除在结果之外

### Requirement: Grep 使用 Agent 作用域的 Read 授权

Grep SHALL 只在为已接受 Agent assembly/version 编译的有效 Read 授权内扫描。有效 Read 授权 SHALL 使用配置的 `readDirectories`，包含 `writeDirectories`，并仅在 `readDirectories` 缺失时保持整 workspace Read 兼容。

可信的 workspace 根和目录授权 SHALL 只来自基于固定 Agent assembly/version 的 app composition。model 输入、客户端 metadata、capability 参数或请求 payload SHALL NOT 覆盖它们。

当 `path` 缺失时，Grep SHALL 扫描每个规范化的不重叠有效 Read 授权根，合并并去重候选文件，并应用一个全局排序和容量预算。当 `path` 存在时，它 SHALL 被一个有效 Read 授权根完整包含。

#### Scenario: 已授权目录被搜索

- **WHEN** `path` 解析为一个精确授权的 Read 目录或其后代
- **THEN** 受控依赖可以扫描该目录
- **AND** 所有返回的文件保持在有效 Read 授权之内

#### Scenario: 未授权目录被拒绝

- **WHEN** `path` 位于每个有效 Read 目录之外
- **THEN** Grep 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 不遍历任何未授权目录

### Requirement: Grep 使用共享的受控文件系统边界

Grep SHALL 只通过既有的 Agent 作用域 `workspaceFiles` 依赖访问文件系统内容搜索。该依赖 SHALL 拥有包含性、授权、遍历、链接检查、文件类型检查、二进制检测、单文件读取预算、regex 编译协调和结果规范化。

Grep SHALL NOT 直接 import 宿主文件系统 API、接收 workspace 根、执行宿主命令、调用 ripgrep、spawn 子进程或经 sandbox gateway 路由。`agent-capability` SHALL 只使用 JavaScript 内建 `RegExp` 进行内容匹配；`glob_filter` 的校验与匹配 SHALL 复用 `picomatch`。SHALL NOT 添加任何第三方 ripgrep、ag 或 shell 包装。

#### Scenario: Read Write Glob 与 Grep 共用一个授权边界

- **WHEN** Read、Write、Glob 和 Grep 为一个 Agent assembly/version 组合
- **THEN** 它们使用一个 `workspaceFiles` 依赖
- **AND** 它们不创建平行的 workspace 根或授权规则

#### Scenario: Grep 在无 sandbox 或 ripgrep 的情况下执行

- **WHEN** Grep 以一个可用的 `workspaceFiles` 依赖被调用
- **THEN** 它执行受控的只读内容搜索
- **AND** 它不要求或调用 sandbox 依赖
- **AND** 它不 spawn 宿主进程或调用 ripgrep

### Requirement: Grep 不跨越链接且不返回特殊或二进制文件

搜索根 SHALL 存在、已授权且是目录。遍历 SHALL NOT 跟随 symlink、junction 或 reparse point。结果 SHALL 只包含保持在可信 workspace 和有效 Read 授权之内的普通文件。

目录、设备、socket、FIFO 和其他非普通文件 SHALL NOT 被打开。一个文件的前 8 KiB 扫描窗口包含 NUL 字节时 SHALL 被视为二进制并跳过而不产生匹配。不可读的根、不可访问的后代目录或遍历 I/O 失败 SHALL 安全失败而不返回部分成功。

一个在检查期间被删除的普通文件 SHALL 被跳过且遍历 SHALL 继续。Symlink、junction 和 reparse point SHALL 被跳过而不使调用失败。

Grep SHALL NOT 读取目录条目，也不修改文件、目录、时间戳、权限或系统状态。

#### Scenario: 链接的子树不被遍历

- **WHEN** 一个已授权目录包含指向任意位置的 symlink、junction 或 reparse point
- **THEN** Grep 不穿过该条目下降
- **AND** 不通过链接路径打开任何目标文件

#### Scenario: 二进制文件被跳过

- **WHEN** 一个候选文件的前 8 KiB 包含 NUL 字节
- **THEN** Grep 不为该文件产生匹配
- **AND** 该文件只通过低基数计数被报告

#### Scenario: 遍历失败不产生部分成功

- **WHEN** 一个必需的后代无法被安全检查
- **THEN** Grep 返回安全的失败结果
- **AND** 已发现的匹配不作为成功的部分结果返回

### Requirement: Grep 匹配预算有界且确定

Grep SHALL 在 model 提供的任何 `max_results` 之上强制固定的不可由 model 配置的硬限制：

- 每个搜索根之下至多 10 个目录边；
- 至多 500 个返回条目（`files_with_matches` 模式下的 `filenames` 长度，`content` 模式下的 `matches` 长度）；
- 整个调用期间至多检查 20000 个文件系统条目；
- 每个文件至多读取 512 KiB；
- 整个调用期间至多读取 32 MiB；
- 每个匹配行至多 4096 个 UTF-16 code unit。

`max_results` SHALL 被钳制到 1..500 范围，并 SHALL 是返回条目的上限；500、20000、32 MiB、512 KiB 和 4096 code unit 限制 SHALL 仍然适用。

结果 SHALL 按稳定的字典序以 `(file_path, line_number)` 排序，`content` 模式条目 SHALL 从该顺序展平。当至少有一个匹配因 `max_results`、文件读取预算、深度限制、扫描预算、总读取预算或单行上限而被省略时 `truncated` SHALL 为 `true`，否则为 `false`。

实现 SHALL 保持遍历内存有界，并 SHALL 在扫描预算用尽后停止。对于同一稳定的文件系统状态和输入，结果顺序和截断语义 SHALL 是确定性的。

#### Scenario: 结果上限被强制执行

- **WHEN** 在 `files_with_matches` 模式下有超过 `max_results` 个普通文件匹配，或在 `content` 模式下有超过 `max_results` 行匹配
- **THEN** 按定义的字典序精确返回前 `max_results` 个条目
- **AND** `truncated=true`

#### Scenario: 深度或扫描预算被强制执行

- **WHEN** 一个可能匹配的子树超过深度 10，或遍历达到 20000 个已检查条目
- **THEN** 遍历在适用的硬边界处停止
- **AND** `truncated=true`

#### Scenario: 总读取预算被强制执行

- **WHEN** 在所有匹配返回之前累计文件读取达到 32 MiB
- **THEN** Grep 停止读取后续文件
- **AND** `truncated=true`

### Requirement: Grep 遵循 cancellation 与安全可观测性

Grep SHALL 接收并遵循 `AbortSignal`。遍历之前或期间的 cancellation SHALL 停止工作，并 SHALL 使用既有的 capability/runtime cancellation 语义而不返回部分成功。

日志、metric、trace、audit 字段、SafeError 和结果 metadata SHALL NOT 包含 pattern、glob 过滤器、输入路径、匹配或未匹配的文件内容、超出返回 `file_path` key 之外的文件名、workspace 根、宿主绝对路径、原始宿主异常或目录配置。安全可观测性 MAY 包含稳定的调用标识符、capability id、status、duration bucket、结果计数 bucket、`truncated`、`output_mode` 和低基数 reason code。

#### Scenario: Cancellation 停止遍历

- **WHEN** 调用 signal 在搜索之前或期间被 abort
- **THEN** Grep 停止遍历
- **AND** 它不以成功形式返回部分匹配

#### Scenario: 运营信号省略敏感文件系统值

- **WHEN** Grep 成功或失败
- **THEN** 运营信号只包含允许的低基数字段
- **AND** pattern、glob 过滤器、路径、文件内容、授权配置和原始宿主错误不存在
