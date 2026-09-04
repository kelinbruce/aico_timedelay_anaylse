## ADDED Requirements

### Requirement: Skill 脚本用 workspace 承载结果、用 temp 承载中间文件

系统 SHALL 通过 sandbox 提供的进程环境定义 Skill Python 脚本的输出
root 契约。产生文件的 Skill Python 脚本 SHOULD 将最终对用户或会话
可见的结果数据写入由
`NEXTAGENT_WORKSPACE_DIR` 标识的进程路径之下，并将中间
数据、scratch 文件和瞬态执行产物写入
`NEXTAGENT_TEMP_DIR`。

sandbox adapter MAY 仅在能够从当前已授权脚本路径或
module 调用派生可信 Skill projection root 时，向子进程暴露
`NEXTAGENT_SKILL_ROOT`。该值 MUST 来自既有的
run-scoped Skill projection 授权事实，且 MUST NOT 授予对
`.nextagent` 的写入权限。

返回给模型的 sandbox stdout 和 stderr SHALL 将当前请求 filesystem roots 下的
物理路径投影回逻辑执行路径，例如
`workspace/`、`temp/`、`.nextagent/skills/...` 和 `shared-data/...`。
在 LOCAL 模式下，如果 sandbox 结果包含一个恰好指向请求
`defaultCwd` 子树下普通文件的精确物理路径，且存在 run-scoped
`temp` root，adapter MAY 在 `temp/` 下以相同
相对路径复制该被引用文件，并将模型可见路径投影为 `temp/...`。
adapter MUST NOT 扫描 `defaultCwd`、发布未被引用的文件、复制
目录、复制 `defaultCwd` 之外的文件，或在 capability result 中
暴露 host 物理路径。

#### Scenario: Skill 脚本区分中间输出与结果输出

- **WHEN** 一个 Skill 脚本处理其已授权 Skill projection 中的数据
- **AND** 它通过 `NEXTAGENT_TEMP_DIR` 写入中间文件
- **AND** 它通过 `NEXTAGENT_WORKSPACE_DIR` 写入最终结果文件
- **THEN** 中间文件保持为 run-scoped temp 数据
- **AND** 最终结果文件落在持久 workspace root 中

#### Scenario: 本地物理输出路径只以逻辑路径对模型可见

- **WHEN** 一个 LOCAL sandboxed Skill 脚本打印
  `workspace`、`temp`、已授权 Skill projection root 或执行
  `defaultCwd` 之下的物理路径
- **THEN** capability result 的 stdout/stderr 只包含逻辑执行
  路径
- **AND** `defaultCwd` 下被引用的普通文件在该 root 存在时
  被放置到 run-scoped `temp/` 逻辑 root 下，
  使后续文件工具可以读取投影后的路径
