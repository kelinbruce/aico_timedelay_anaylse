## Why

电信网络智能体使用存量 Skill 执行诊断、巡检或数据处理脚本时，Skill 说明经常以 `scripts/query.py` 或 `<skill-name>/scripts/query.py` 引用随 Skill 发布的脚本。系统虽然已经把这些资源投影到当前执行作用域的只读逻辑根，但 Bash 默认从 workspace 执行，模型必须先识别并拼接完整投影路径。路径拼接错误会产生无效执行轮次，也容易促使 Skill 作者写入依赖部署细节的路径。

直接对 Bash 命令文本执行正则替换会把搜索文本、内联代码或普通参数误判为脚本路径，并可能在多个 Skill 同名资源之间错误选择。系统需要一个受限、确定且 fail-closed 的兼容机制，仅在直接解释器执行脚本时补全当前作用域内唯一、已验证的 Skill 脚本逻辑路径。

## 目标与非目标

### 目标

- Bash 直接使用 `python`、`python3`、`bash` 或 `sh` 执行 Skill `scripts/` 下的相对脚本时，系统能够在提交 sandbox 前解析为当前执行作用域内唯一的已验证 Skill 脚本逻辑路径。
- 同时接受 `scripts/<file>` 和 `<skill-name>/scripts/<file>` 两种存量写法；显式 Skill 名称只能匹配同名 Skill。
- 无匹配时保持原有参数和执行行为；多个匹配时在 sandbox 前安全拒绝并返回可操作的候选逻辑路径。
- 路径补全不扩大 Skill 资源授权，不暴露物理路径，不修改原始 Tool 输入。

### 非目标

- 不对任意 Bash 文本或任意参数执行正则替换。
- 不处理 `bash -c`、`bash -lc`、`python -c`、管道、重定向、命令替换、shell wrapper 或嵌套命令中的路径。
- 不自动补全 `references/`、`assets/` 或普通数据参数；首版只处理 `scripts/` 下与解释器类型匹配的 `.py` 或 `.sh` 文件。
- 不改变 Python Tool 的代码片段语义、Bash/Python 默认 cwd、sandbox executable policy、Skill projection 生命周期或 Read/Write/Edit/Glob/Grep 路径语义。
- 不接受绝对路径、父级穿越或已经带 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/`、`shared-data/` 等逻辑 root 的路径作为自动补全输入。

## What Changes

- Bash 在完成现有输入解析后、提交 sandbox 前，对直接解释器执行的首个脚本参数应用 Skill 相对执行路径兼容规则。
- `python` 和 `python3` 只解析 `.py` 脚本；`bash` 和 `sh` 只解析 `.sh` 脚本。候选路径必须位于 `scripts/` 子树。
- 系统只在当前 accepted execution scope 的 committed、完整性验证通过的 Skill projections 中解析候选；唯一匹配时把 sandbox argv 中的脚本参数替换为 root-qualified 逻辑路径。
- 无匹配时不改写参数；多匹配时返回稳定错误 `SKILL_RESOURCE_PATH_AMBIGUOUS` 和候选逻辑路径，且不调用 sandbox。
- 显式 `<skill-name>/scripts/...` 不允许回退到其他 Skill；其不存在时保持原参数。
- 复杂 shell 表达式和不满足窄规则的输入保持既有行为。

## Function 影响（OpenSpec Capabilities）

| 变更类型 | Function | canonical name | 对应 spec | 变化边界 | 系统质量属性 |
|---|---|---|---|---|---|
| 修改 | `FN-5.5` | 执行命令和脚本 | `command-script-tools` | Bash 直接解释器执行增加 Skill 相对脚本路径的唯一匹配补全和歧义拒绝；其他命令与 sandbox 执行语义不变 | 安全、可靠性/恢复、可测试性 |

## Feature 影响

- 修改 `F-5.3 命令执行工具`：Skill 脚本的两种常见相对路径写法可由 Bash 安全兼容执行，同时保持 sandbox 授权边界和复杂命令行为不变。

## 影响范围

- Agent 与 Skill 作者：存量 Skill 可继续使用受支持的相对脚本写法；歧义时必须改用返回的 root-qualified 逻辑路径。
- 运维与平台集成：不新增配置或物理路径约定；同一执行作用域挂载多个含同名脚本的 Skill 时会显式失败而不是猜测。
- 公共 Tool 输入与输出 schema 不变；新增的歧义失败使用既有 `SafeError` 边界。
- 实现和测试影响集中在 Bash 输入准备、受治理 Skill projection 路径解析及对应 capability/security tests。
