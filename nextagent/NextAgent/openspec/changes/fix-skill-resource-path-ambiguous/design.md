## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.5 执行命令和脚本` | Skill 脚本路径补全在裸路径场景下利用激活 Skill 上下文消歧；SYSTEM_PROMPT workspace 指引补充 Skill 脚本路径解析说明 | `command-script-tools` | `FN-5.5 执行命令和脚本` |

## `FN-5.5 执行命令和脚本`

### 目标与规范依据

本设计落实 proposal 中"裸路径场景下利用激活 Skill 上下文消歧"的目标。实现只改变 `resolveSkillResourcePath` 中候选过滤逻辑，不改变 Skill 投影、manifest 验证、文件安全检查或 sandbox 执行边界。

#### 本 Function 的目标 Requirements

canonical spec：`command-script-tools`

- `MODIFIED`：`Bash 补全唯一匹配的 Skill 相对脚本路径`

### 当前实现

- `packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts` 的 `resolveSkillResourcePath` 在 `parsed.skillName` 为 `undefined` 时不按 Skill name 过滤，所有已加载 Skill 都参与匹配。
- `packages/agent-core/src/tools/tool-loop.ts` 在 Skill 加载成功后把 `skillName` 写入 `flowVariables.activeSkillContext`。
- `resolveSkillResourcePath` 已接收 `context: ToolExecutionContext`，可访问 `context.flowVariables`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 裸路径在多 Skill 同名脚本时用激活 Skill 消歧 | 不按 Skill name 过滤 | 需要从 `activeSkillContext.skillName` 获取并用于过滤 |
| 含 Skill name 的路径行为不变 | 精确匹配 | 保持不变 |
| 无激活 Skill 时行为不变 | 所有 Skill 参与匹配 | `effectiveSkillName` 为 `undefined` 时不过滤，行为一致 |

### 修改方案

在 `resolveSkillResourcePath` 中：

1. 新增 `readActiveSkillName` helper，从 `flowVariables.activeSkillContext` 安全读取 `skillName`。
2. 计算 `effectiveSkillName = parsed.skillName ?? readActiveSkillName(context.flowVariables)`。
3. 将过滤条件从 `parsed.skillName` 改为 `effectiveSkillName`。

此外更新 SYSTEM_PROMPT 的 `workspace.md`（`packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/workspace.md`），补充指引模型：Skill 脚本执行时必须先解析当前加载 Skill 的 root-qualified 路径，再使用其加载源路径 `<SKILL_SOURCE_PATH>` 执行脚本。Bash 和 Python 保持既有受治理工作目录语义。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可测试性 | `Bash 补全唯一匹配的 Skill 相对脚本路径` | 消歧逻辑在 workspace-file-port 内可由集成测试观察 resolveSkillResourcePath 返回值 | 多 Skill 同名脚本 + 激活 Skill 消歧、无激活 Skill 回退 ambiguous |

## 验证策略

- 新增测试：两个 Skill 同名 `scripts/run.py` + `activeSkillContext.skillName` 存在时裸路径解析为激活 Skill。
- 新增测试：无 `activeSkillContext` 时裸路径行为不变（ambiguous）。
- 既有 skill-resource-projection 测试全部通过。
- `tsc --noEmit` 无错误。

## 长期基线刷新计划

归档前需要同步：
- stable spec `openspec/specs/command-script-tools/spec.md`：合并 MODIFIED Requirement。
- Function 文档：无新增映射。
- architecture、modules、ADR、Feature、overview：无影响。
