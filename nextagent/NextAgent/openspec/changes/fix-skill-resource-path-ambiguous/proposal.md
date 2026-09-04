## 背景与问题（Why）

当同一个 execution scope 下加载了多个 Skill，且这些 Skill 的 `scripts/` 目录下存在同名脚本文件时，模型在 Bash 中使用裸路径（如 `python scripts/test.py`）会被系统判定为 `SKILL_RESOURCE_PATH_AMBIGUOUS` 并拒绝执行。原因是路径解析在 `parsed.skillName` 为 `undefined` 时不按 Skill name 过滤候选，所有已加载 Skill 都参与匹配。

Tool-loop 在 Skill 加载成功后已将当前激活 Skill 的 `skillName` 写入 `flowVariables.activeSkillContext`，但 `resolveSkillResourcePath` 未利用该上下文消歧。

## 变更范围（What Changes）

- 当模型写裸路径 `scripts/foo.py`（不含 Skill name 前缀）时，`resolveSkillResourcePath` 从 `context.flowVariables.activeSkillContext.skillName` 获取当前激活的 Skill name，用它过滤候选，只匹配当前激活的 Skill。
- 模型显式写了 Skill name 的路径（如 `my-skill/scripts/foo.py`）行为不变。
- 没有激活 Skill 上下文时（`activeSkillContext` 不存在）行为不变。
- 更新 SYSTEM_PROMPT 的 `workspace.md`，明确指引模型：Skill 脚本执行时必须先解析当前加载 Skill 的 root-qualified 路径，再使用其加载源路径 `<SKILL_SOURCE_PATH>` 执行脚本。

## Non-Goals

- 不改变 Skill 投影、manifest 验证、文件安全检查逻辑。
- 不改变 `ToolExecutionContext` 接口或 `flowVariables` 结构。
- 不改变 tool-loop 写入 `activeSkillContext` 的逻辑。
- 不为非 Bash 工具或非 Skill 脚本路径添加消歧逻辑。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-5.5 执行命令和脚本`：修改其主规格 `command-script-tools`，使 Skill 脚本路径补全在裸路径场景下利用激活 Skill 上下文消歧。

## Feature 影响

- 无 Feature delta。不新增用户可见 Feature；本次修复提升既有 Skill 脚本路径补全的准确性。

## 影响范围（Impact）

- `agent-capability`：修改 `workspace-file-port.ts` 中 `resolveSkillResourcePath` 函数，新增 `readActiveSkillName` helper。
- `agent-context-engine`：更新 SYSTEM_PROMPT 的 `workspace.md`，补充 Skill 脚本路径解析指导。
- tests：新增 2 个测试用例（激活 Skill 消歧、无激活 Skill 回退）。
- 不修改 `agent-contracts`、runtime lifecycle、sandbox gateway、persistence 或 security boundary。
- **BREAKING**：无。
