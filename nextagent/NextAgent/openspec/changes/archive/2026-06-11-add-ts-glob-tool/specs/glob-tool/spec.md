## ADDED Requirements

### Requirement: Glob 是显式受治理的 Builtin Tool

系统 SHALL 提供一个通过 `defineTool` 定义并显式注册到自有 builtin Tool 清单中的小写 `glob` builtin Tool。该 Tool SHALL 要求受控的 `workspaceFiles` 依赖，并 SHALL 声明 `IDEMPOTENT` replay policy。

该 Tool SHALL NOT 引入大写别名、隐式注册、平行调用契约、delivery-target 契约或 Glob 专用 provider。

#### Scenario: Glob descriptor 通过既有框架投影

- **WHEN** builtin Tool catalog 与 `workspaceFiles` 一起组合
- **THEN** 它通过既有 capability discovery 路径暴露 `glob` descriptor
- **AND** 可执行查找保持 provider 感知

#### Scenario: 缺少依赖阻止执行

- **WHEN** builtin Tool catalog 组合时没有 `workspaceFiles`
- **THEN** `glob` 在调用之前不可用
- **AND** 不执行任何文件系统搜索

#### Scenario: 既有 builtin 治理控制模型可见性

- **WHEN** `glob` 被注册为 builtin Tool
- **THEN** 它遵循既有 builtin 默认启用 policy
- **AND** 显式 disabled Agent binding 会把它从请求可见的 capability view 中移除
- **AND** 本 change 不引入 Glob 专用的 delivery 或可见性 policy

### Requirement: Glob 具有严格的 Pattern 与 Path 契约

Glob SHALL 接受一个严格对象，包含：

- `pattern`（string，必需）：相对于每个有效搜索 root 的非空 glob 表达式；
- `path`（string，可选）：非空的显式 workspace 相对搜索目录。

每个字符串 SHALL 至多包含 4096 个 UTF-16 code unit。未知属性 SHALL 被拒绝。

Glob SHALL 返回：

- `filenames`：使用 `/` 的归一化 workspace 相对普通文件路径；
- `truncated`：匹配结果是否因硬遍历边界而被省略。

输出 SHALL NOT 包含 duration、重复计数、文件 metadata、workspace root 或宿主绝对路径。

#### Scenario: 最小有效输入使用全部有效 Read root

- **WHEN** 模型只以有效 `pattern` 调用 `glob`
- **THEN** Glob 搜索有效 Read 和 Write root 的归一化并集
- **AND** 缺失 `readDirectories` 配置意味着整个 workspace 是有效 root
- **AND** 匹配的 filenames 以定义的输出 shape 返回

#### Scenario: 未知输入在搜索前被拒绝

- **WHEN** 调用包含未知属性、空字符串、超长字符串或错误值类型
- **THEN** 调用以安全校验错误失败
- **AND** 不执行任何文件系统搜索

### Requirement: Glob 使用定义的可移植 Pattern 子集

Glob SHALL 支持 `*`、`?`、`**`、字符类、取反字符类和有限 brace 备选项。`/` SHALL 是规范 pattern 分隔符，`\` SHALL 在所有受支持宿主上归一化为分隔符。

匹配 SHALL 包含隐藏文件，SHALL NOT 读取或应用 `.gitignore`、`.ignore` 或其他仓库 ignore 文件。匹配 SHALL 在 Windows 上大小写不敏感，在 Linux 和 macOS 上大小写敏感。

每个 brace SHALL 至多包含 32 个备选项，完整 pattern SHALL 展开至多 256 个组合。Glob SHALL 以 `CAPABILITY_INPUT_INVALID` 拒绝超出的备选项或组合。

Glob SHALL 在文件系统访问之前拒绝畸形构造、extglob、正则表达式、前导取反 pattern、空 brace 备选项、brace 范围、NUL、控制字符、绝对路径、UNC 路径、设备路径、带驱动器号的路径和任何 `..` 段。

#### Scenario: 递归 pattern 在选定 path 之下匹配

- **WHEN** `pattern="**/*.log"` 在授权 path 下求值
- **THEN** 遍历限制内的普通 `.log` 文件被返回
- **AND** 返回的名称相对于可信 workspace

#### Scenario: 不受支持或逃逸的 pattern 被拒绝

- **WHEN** 某 pattern 畸形、不受支持、绝对、设备限定或包含父级段
- **THEN** Glob 返回安全的校验或 path 拒绝错误
- **AND** 不执行任何目录遍历

### Requirement: Glob 使用 Agent-Scoped Read 权限

Glob SHALL 只在为已受理 Agent assembly/version 编译的有效 Read 权限内搜索。有效 Read 权限 SHALL 使用配置的 `readDirectories`，包含 `writeDirectories`，并且只在 `readDirectories` 缺失时保持整个 workspace 的 Read 兼容性。

可信 workspace root 和目录权限 SHALL 只来自 app composition 基于固定 Agent assembly/version 的输入。模型输入、客户端 metadata、capability 参数或请求 payload SHALL NOT 覆盖它们。

当 `path` 缺失时，Glob SHALL 搜索每个归一化且互不重叠的有效 Read 权限 root，合并并去重结果，并应用单一全局排序和容量预算。当 `path` 存在时，它 SHALL 被某一个有效 Read 权限 root 完全包含。

#### Scenario: 授权目录被搜索

- **WHEN** `path` 解析为某个精确授权 Read 目录或其后代
- **THEN** 受控依赖可以搜索该目录
- **AND** 所有返回的文件都保持在有效 Read 权限之内

#### Scenario: 未授权目录被拒绝

- **WHEN** `path` 位于每个有效 Read 目录之外
- **THEN** Glob 返回 `CAPABILITY_PATH_REJECTED`
- **AND** 不遍历任何未授权目录

### Requirement: Glob 使用共享的受控文件系统边界

Glob SHALL 只通过既有的 Agent-scoped `workspaceFiles` 依赖访问文件系统 discovery。该依赖 SHALL 拥有包含关系、权限、遍历、link 检查、文件类型检查、归一化和容量强制限制。

Glob SHALL NOT 直接导入宿主文件系统 API、接收 workspace root、执行宿主命令、调用 ripgrep，或经 sandbox gateway 路由。

`agent-capability` SHALL 把 `picomatch` 声明为直接依赖，并 SHALL 只用它编译和匹配归一化的相对路径。`picomatch`、`tinyglobby` 和其他 glob 包 SHALL NOT 拥有遍历或权限强制限制。

#### Scenario: Read Write 和 Glob 共享同一权限边界

- **WHEN** Read、Write 和 Glob 为同一 Agent assembly/version 组合
- **THEN** 它们使用同一个 `workspaceFiles` 依赖
- **AND** 它们不创建平行的 workspace root 或授权规则

#### Scenario: Glob 无需 sandbox 即可执行

- **WHEN** Glob 在 `workspaceFiles` 依赖可用时被调用
- **THEN** 它执行受控的只读 discovery
- **AND** 它不要求或调用 sandbox 依赖

### Requirement: Glob 不穿越 Link 也不返回特殊文件

搜索 root SHALL 存在、已授权且是目录。遍历 SHALL NOT 跟随 symlink、junction 或 reparse point。结果 SHALL 只包含保持在可信 workspace 和有效 Read 权限之内的普通文件。

目录、设备、socket、FIFO 和其他非普通文件 SHALL NOT 被返回。不可读的 root、不可访问的后代目录或遍历 I/O 失败 SHALL 安全失败，而不返回部分成功。

检查过程中被删除的普通文件 SHALL 被跳过且遍历 SHALL 继续。Symlink、junction 和 reparse point SHALL 被跳过而不使调用失败。

Glob SHALL NOT 读取文件内容或修改文件、目录、时间戳、权限或系统状态。

#### Scenario: 链接子树不被遍历

- **WHEN** 某授权目录包含指向任意位置的 symlink、junction 或 reparse point
- **THEN** Glob 不经由该条目向下遍历
- **AND** 不通过链接路径返回任何目标文件

#### Scenario: 遍历失败不产生部分成功

- **WHEN** 某个必需的后代无法被安全检查
- **THEN** Glob 返回安全的失败结果
- **AND** 已发现的 filenames 不作为成功部分结果返回

### Requirement: Glob 遍历有界且确定

Glob SHALL 实施固定的、不可由模型配置的硬限制：

- 每个搜索 root 之下至多 10 个目录边；
- 至多 500 个返回 filenames；
- 整个调用期间至多 20000 个已检查的文件系统条目。

结果 SHALL 按归一化 workspace 相对路径以稳定字典序排序。当至少一个匹配结果因结果、深度或扫描限制被省略时 `truncated` SHALL 为 `true`，否则为 `false`。

实现 SHALL 保持遍历内存有界，并 SHALL 在扫描预算用尽后停止。对同一稳定文件系统状态和输入，结果顺序和截断语义 SHALL 是确定的。

#### Scenario: 结果限制被强制执行

- **WHEN** 超过 500 个普通文件匹配
- **THEN** 恰好以定义的字典序返回前 500 个路径
- **AND** `truncated=true`

#### Scenario: 深度或扫描预算被强制执行

- **WHEN** 某个可能匹配的子树超出深度 10 或遍历达到 20000 个已检查条目
- **THEN** 遍历在适用的硬边界处停止
- **AND** `truncated=true`

### Requirement: Glob 尊重 Cancellation 和安全 Observability

Glob SHALL 接收并尊重 `AbortSignal`。遍历之前或期间的取消 SHALL 停止工作，并 SHALL 使用既有的 capability/runtime 取消语义，而不返回部分成功。

Logs、metrics、traces、audit 字段、SafeError 和结果 metadata SHALL NOT 包含 pattern、输入 path、filenames、workspace root、宿主绝对路径、raw 宿主异常或目录配置。安全 observability MAY 包含稳定的调用标识符、capability id、状态、duration bucket、result-count bucket、truncated 标志和低基数 reason code。

#### Scenario: 取消停止遍历

- **WHEN** 调用 signal 在搜索之前或期间被 abort
- **THEN** Glob 停止遍历
- **AND** 它不把部分 filenames 作为成功返回

#### Scenario: 运维信号省略敏感文件系统值

- **WHEN** Glob 成功或失败
- **THEN** 运维信号只包含允许的低基数字段
- **AND** pattern、路径、filenames、权限配置和 raw 宿主错误都不出现
