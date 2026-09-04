## 背景与问题（Why）

Skill Python 脚本投影在只读的 `.nextagent/skills/...`
资源树下，而持久输出属于 `workspace/`，中间
文件属于 run 作用域的 `temp/`。今天，一个写入相对路径文件
而不带显式 root 的脚本会写到执行视图 cwd 下，这既不是
持久 workspace 输出，也不是隔离的 run temp 输出。

系统需要一个小的、显式的 runtime 契约，使 Skill 脚本能够
正确路由中间文件和最终文件，而不改变 sandbox cwd，也不在执行后
扫描和移动文件。

## 变更范围（What Changes）

- 受限 local sandbox 注入从当前 `SandboxExecutionRequest.filesystem` roots 派生
  的按请求环境变量：
  - `NEXTAGENT_WORKSPACE_DIR` 用于最终持久结果文件。
  - `NEXTAGENT_TEMP_DIR` 用于 run 作用域中间文件。
  - `NEXTAGENT_SKILL_ROOT` 用于当前 Python 调用拥有单个可信
    Skill 投影 root 的场景。
- 这些值是为当前 sandbox 进程由 adapter 解析的执行路径。它们 MUST NOT
  来自全局进程状态、模型输入、客户端 metadata、Skill
  metadata 或命令参数，唯一例外是用于标识正在执行的
  已授权 Skill 脚本路径。
- sandbox cwd 保持为执行视图 root。系统 MUST NOT 在进程退出后通过扫描
  执行 base 下的新文件来推断输出意图。

## 影响范围（Impact）

- `sandbox-runtime`：为 Skill 脚本文件输出和中间文件新增按进程
  的环境契约。
- `skill-resource-access`：澄清 `workspace/` 承载最终输出、
  `temp/` 通过 adapter 提供的进程路径承载中间文件。
- 不新增 Web API、tool schema、gateway DTO、持久化表或公开结果
  字段。

## 验证（Verification）

- 聚焦的受限 local sandbox 测试证明：
  - 来自 `NEXTAGENT_WORKSPACE_DIR` 的最终输出路径落在当前
    workspace root；
  - 来自 `NEXTAGENT_TEMP_DIR` 的中间路径落在当前 run temp
    root；
  - 两个具有不同 temp roots 的并发式请求收到隔离的
    temp 路径；
  - `NEXTAGENT_SKILL_ROOT` 从已授权的 Skill 投影 root 派生。
- `openspec validate normalize-skill-python-output-paths --strict`。
