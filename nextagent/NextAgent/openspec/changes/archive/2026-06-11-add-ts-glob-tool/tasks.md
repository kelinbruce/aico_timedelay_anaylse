## 1. Tool 契约与目录

- [x] 1.1 通过 `defineTool` 定义小写 `glob` 的严格输入/输出 schema、`IDEMPOTENT` metadata 和 `workspaceFiles` 依赖
- [x] 1.2 在拥有的 builtin Tool 清单中显式注册 `glob`，并验证没有引入别名、扫描、副作用注册、YAML 定义、交付目标或并行调用契约
- [x] 1.3 验证既有 builtin 默认启用、显式 Agent binding 禁用、provider 治理和依赖就绪

## 2. 共享工作区文件发现

- [x] 2.1 扩展 `WorkspaceFilePort`，新增一个窄域可取消的发现操作，接受 Glob 业务输入和可信 Tool 执行上下文
- [x] 2.2 复用编译后的 Agent 作用域有效 Read 授权；`path` 缺失时搜索规范化的 `readDirectories ∪ writeDirectories`，`readDirectories` 缺失时保持全 workspace 兼容
- [x] 2.3 使 workspace root、宿主路径、文件系统对象和目录授权不进入 Tool 的输入、输出、错误、metadata 和可观测性
- [x] 2.4 验证 Read、Write 和 Glob 共享同一个 Agent assembly/version 作用域依赖，没有第二条文件系统路径

## 3. 模式与路径校验

- [x] 3.1 新增 `picomatch` 作为只用于匹配的直接依赖，并为 `*`、`?`、`**`、字符类、否定字符类和有限 brace 备选实现 v1 可移植子集
- [x] 3.2 强制每个 brace 32 个备选、总计 256 个组合；规范化分隔符，并在文件系统访问之前拒绝畸形、不支持、空、超大、绝对、UNC、设备、带盘符、父目录段、NUL 和控制字符输入
- [x] 3.3 对照可信 workspace 包含关系和有效 Read 授权校验默认/显式搜索路径
- [x] 3.4 包含隐藏文件，忽略仓库 ignore 文件，并在 Windows 上应用大小写不敏感匹配，在 Linux/macOS 上应用大小写敏感匹配

## 4. 有界只读遍历

- [x] 4.1 实现普通文件发现，不读取内容、不修改状态、不调用 sandbox、不执行宿主命令
- [x] 4.2 不跟随 symlink、junction 或 reparse-point 条目，不返回目录或特殊文件
- [x] 4.3 强制深度 10、结果 500 和已检查条目 20000 的硬上限，内存有界
- [x] 4.4 以稳定字典序返回规范化的 workspace 相对文件名，并只在省略匹配时设置 `truncated`
- [x] 4.5 尊重取消；root/后代遍历 I/O 错误直接失败、无部分成功，但跳过并发删除的普通文件和链接条目

## 5. Safe 失败与可观测性

- [x] 5.1 把无效输入、被拒绝路径、依赖不可用、目录不可访问、取消和遍历失败映射到既有 safe capability 语义
- [x] 5.2 确保模式、路径、文件名、workspace root、目录授权和原始宿主异常绝不进入日志、metric、trace、audit、SafeError 或结果 metadata
- [x] 5.3 只输出稳定标识符、capability id、状态、时长/结果数量分桶、truncated 标志和低基数 reason code

## 6. 验证

- [x] 6.1 为 descriptor metadata、严格 schema、受支持模式、畸形模式、分隔符、隐藏文件、ignore 行为、输出 shape 和稳定排序新增 unit 测试
- [x] 6.2 为 Read 授权、穿越、绝对/UNC/设备路径、父目录段、链接、reparse point 和特殊文件新增表驱动安全测试
- [x] 6.3 为深度、结果、扫描预算、确定性截断、取消、条目竞争、不可访问后代和无部分成功新增容量和集成测试
- [x] 6.4 为显式注册、builtin 默认启用、Agent binding 禁用、依赖不可用、单一共享文件系统边界和无直接文件系统/进程/sandbox 访问新增契约/架构测试
- [x] 6.5 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict`
- [x] 6.6 在 push 前运行仓库 `nextagent-code-review` 语义检视，并解决全部阻断性问题
