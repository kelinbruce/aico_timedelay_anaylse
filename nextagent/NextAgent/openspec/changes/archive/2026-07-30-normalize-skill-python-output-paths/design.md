## 背景（Context）

执行 roots 已经以 `SandboxExecutionRequest.filesystem.defaultCwd`
和 `roots[]` 的形式提供给 sandbox adapter。本地开发 sandbox
执行使用执行视图 root 作为 cwd，
因此 `.nextagent/skills/...`、`workspace/...`、`temp/...` 等
以 root 限定的路径对 root 感知命令保持可用。把 cwd
改为物理 workspace root 会破坏 Skill 脚本路径解析，并与当前
`skill-resource-access` 基线相矛盾。

## 决策（Decisions）

### D1: 环境变量是按请求的 adapter 事实

`restricted-local-sandbox` 在构建子进程环境时从请求文件系统
roots 派生输出目录变量。它不写入
`process.env`，也不全局缓存值。这使并行 run
保持在各自的请求文件系统布局下隔离。

### D2: 使用已解析的执行路径，而非运行后文件分类

adapter 注入供脚本作者使用的路径：

- `NEXTAGENT_WORKSPACE_DIR`：最终持久输出。
- `NEXTAGENT_TEMP_DIR`：中间文件、临时数据和瞬时导出。
- `NEXTAGENT_SKILL_ROOT`：可用时当前可信 Skill 投影 root。

系统不在执行后扫描 `scopeBase` 来判断文件是中间产物还是最终产物。
只有脚本知道这一意图，猜测会把中间或敏感
文件当作持久输出发布，带来风险。

### D3: 投影模型可见的 sandbox 输出路径

local sandbox adapter 在返回 capability 结果之前，把有界
stdout/stderr 中的物理路径投影回逻辑执行命名空间。
投影只限于当前
`SandboxExecutionRequest.filesystem` 中已有的 roots：`workspace/`、
`temp/`、`.nextagent/skills/...` 和其他已授权的逻辑 roots。adapter 按物理
root 路径长度降序排序，使诸如
`.nextagent/skills/<key>/<skill>` 这样的嵌套 root 优先于执行 base。

对于遗留 LOCAL cwd 场景，当存在 run 作用域可写 `temp` root 时，adapter
还可以把 `filesystem.defaultCwd` 下已精确输出的物理路径投影到
`temp/<relative-path>`。这不是目录扫描或输出
分类：它只对已出现在有界进程输出中的具体路径做出反应，
只复制普通文件，并使目录、
缺失文件、链接和 `defaultCwd` 之外的路径保持不发布。这处理了
旧脚本用 `os.getcwd()` 构造输出路径的情况，同时让文件工具
保持在逻辑路径上。

### D4: Skill root 从既有授权派生

对于 Python 脚本路径模式，只有当第一个参数匹配已授权的文件系统 root
时才会被翻译。如果该 root 是 Skill 投影 root，
adapter 可以把该 root 以 `NEXTAGENT_SKILL_ROOT` 暴露给
子进程。对于 Python module 模式，既有的单 root module
选择提供同一可信 Skill root。歧义 root 在 module 模式下保持
fail-closed。

## 非目标（Non-Goals）

- 不把 cwd 改为物理 `workspace/`。
- 不做宽泛的自动输出搬迁或运行后 `scopeBase` 扫描。
- 不新增公开 gateway 字段或模型 tool 参数。
- 不新增通用输出 manifest 格式。

## 风险（Risks）

- 脚本仍可能忽略这些变量并向 cwd 写入未被引用的文件。
  只有有界 stdout/stderr 中精确输出的普通文件路径会被投影
  到 `temp/`；未被引用的 cwd 文件对文件工具保持不可用。
- 本地 sandbox 路径是宿主路径，因为当前 local adapter 只是
  尽力而为的进程隔离。它们保持为进程本地环境事实，
  不得被复制进 tool 结果、safe 错误、日志或公开 DTO。
