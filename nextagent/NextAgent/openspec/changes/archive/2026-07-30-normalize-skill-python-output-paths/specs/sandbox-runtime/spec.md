## ADDED Requirements

### Requirement: Skill Python 执行获得按请求划分的输出路径环境变量

系统 SHALL 为已授权的 Skill Python 执行提供按请求划分的输出路径
环境变量。当受限的本地 sandbox 为已授权的 Skill script 或 Skill module
调用启动 Python 进程时，它 MUST 从当前
`SandboxExecutionRequest.filesystem` roots 派生进程本地的输出路径环境变量。
`NEXTAGENT_WORKSPACE_DIR` MUST 指向当前请求的 workspace root，
用于最终的持久结果文件。`NEXTAGENT_TEMP_DIR` MUST 指向
当前请求的 run-scoped temp root，
用于中间文件、scratch 数据和瞬态输出。

这些环境变量 MUST 只设置在被 spawn 的子进程上。它们 MUST NOT
写入全局进程环境、跨请求缓存，或从模型输入、客户端
metadata、Skill metadata 或 host 默认值派生。Sandbox cwd MUST
保持为 execution view root。系统 MUST NOT 在进程退出后
扫描文件来推断哪些输出是最终结果。

#### Scenario: Skill script 获得当前 workspace 与 temp 路径

- **WHEN** Python 执行一个已授权的 `.nextagent/skills/<projection>/<skill>/scripts/export.py` 脚本
- **THEN** 子进程环境 MUST 包含从当前 workspace root 派生的 `NEXTAGENT_WORKSPACE_DIR`
- **AND** 它 MUST 包含从当前 run temp root 派生的 `NEXTAGENT_TEMP_DIR`
- **AND** 通过 `NEXTAGENT_TEMP_DIR` 写入的文件 MUST 与其他请求的 temp root 隔离

#### Scenario: 不通过扫描推断输出意图

- **WHEN** 一个 Skill script 在 `NEXTAGENT_WORKSPACE_DIR` 和 `NEXTAGENT_TEMP_DIR` 之外写入文件
- **THEN** sandbox adapter MUST NOT 把这些文件移动到 `workspace/`
- **AND** 它 MUST NOT 按名称、扩展名或创建时间把文件归类为最终结果
