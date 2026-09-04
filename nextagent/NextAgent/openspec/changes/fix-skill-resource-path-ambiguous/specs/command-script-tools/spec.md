所属 Function：`FN-5.5 执行命令和脚本`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

### Requirement: Bash 补全唯一匹配的 Skill 相对脚本路径

当 Bash 的解析结果表示直接解释器执行时，系统 MUST 只对首个脚本参数应用 Skill 相对执行路径兼容规则。受支持的解释器与脚本后缀组合 MUST 恰好为 `python`/`python3` 与 `.py`、`bash`/`sh` 与 `.sh`；候选参数 MUST 是 `scripts/<file>` 或 `<skill-name>/scripts/<file>` 形式的纯相对路径，且 `<file>` MUST 至少包含一个非空文件名 segment。

系统 MUST 只在当前 accepted execution scope 的已提交且验证通过的 Skill projections 中查找候选。`scripts/<file>` 在恰好一个 Skill 中匹配时，系统 MUST 把提交给 sandbox 的对应 argv 替换为该文件的 root-qualified 逻辑路径；`<skill-name>/scripts/<file>` MUST 只查找同名 Skill，并在恰好一个匹配时执行相同替换。系统 MUST 保持原始 Bash Tool 输入不变。

当模型使用不带 Skill 名称的裸路径 `scripts/<file>` 且当前 execution scope 中多个已验证 Skill 包含同名脚本时，系统 MUST 使用 `context.flowVariables.activeSkillContext.skillName`（即当前激活 Skill 的名称）来过滤候选。当 `activeSkillContext` 不存在或 `skillName` 非字符串时，系统 MUST 保持与无激活上下文时一致的行为（所有 Skill 参与匹配，多个匹配时返回 ambiguous）。

没有匹配时，系统 MUST 保持原 argv 和既有 sandbox 执行行为。以下穷尽条件中的任一条件成立时，系统 MUST NOT 自动补全：解释器或后缀组合不受支持；脚本参数不是首个解释器参数；路径位于 `scripts/` 之外；路径是绝对路径、包含空 segment 或父级穿越；路径已带 `workspace/`、`temp/`、`.nextagent/`、`generated-skills/` 或 `shared-data/` 逻辑 root；命令使用 `-c`、`-lc`、管道、重定向、命令替换或嵌套 shell wrapper。

**需求类别**：功能性需求

#### Scenario: Skill 名称前缀的 Python 脚本唯一匹配

- **WHEN** Bash 解析结果为 `python demo_skill/scripts/query.py`
- **AND** 当前 execution scope 中已验证 Skill `demo_skill` 恰好包含 `scripts/query.py`
- **THEN** 系统 MUST 向 sandbox 提交 `python .nextagent/skills/<projection>/demo_skill/scripts/query.py`
- **AND** 原始 Bash Tool 输入 MUST 保持 `python demo_skill/scripts/query.py`

#### Scenario: 不带 Skill 名称的 shell 脚本唯一匹配

- **WHEN** Bash 解析结果为 `sh scripts/collect.sh`
- **AND** 当前 execution scope 的全部已验证 Skill 中恰好一个包含 `scripts/collect.sh`
- **THEN** 系统 MUST 把该脚本参数替换为唯一匹配的 root-qualified 逻辑路径后提交 sandbox

#### Scenario: 不带 Skill 名称的裸路径在多 Skill 同名脚本时使用激活 Skill 消歧

- **WHEN** Bash 解析结果为 `python scripts/query.py`（不含 Skill 名称前缀）
- **AND** 当前 execution scope 中多个已验证 Skill 包含 `scripts/query.py`
- **AND** `context.flowVariables.activeSkillContext.skillName` 为当前激活 Skill 的名称
- **THEN** 系统 MUST 只在激活 Skill 中查找候选
- **AND** 激活 Skill 包含该脚本时 MUST 把脚本参数替换为该 Skill 的 root-qualified 逻辑路径后提交 sandbox
- **AND** 激活 Skill 不包含该脚本时 MUST 返回 not-found

#### Scenario: 无激活 Skill 上下文时裸路径保持 ambiguous 行为

- **WHEN** Bash 解析结果为 `python scripts/query.py`（不含 Skill 名称前缀）
- **AND** 当前 execution scope 中多个已验证 Skill 包含 `scripts/query.py`
- **AND** `activeSkillContext` 不存在或 `skillName` 非字符串
- **THEN** 系统 MUST 返回 `ambiguous` 并包含所有匹配的候选路径

#### Scenario: 显式 Skill 名称不存在时不跨 Skill 回退

- **WHEN** Bash 解析结果为 `python missing_skill/scripts/query.py`
- **AND** 当前 scope 的另一个 Skill 包含 `scripts/query.py`
- **THEN** 系统 MUST 保持 `missing_skill/scripts/query.py` 不变
- **AND** 系统 MUST NOT 改写到另一个 Skill

#### Scenario: 无匹配时保持既有执行行为

- **WHEN** 受支持形式的相对脚本路径在当前 scope 没有匹配文件
- **THEN** 系统 MUST 保持原 argv 并继续既有 sandbox 执行路径

#### Scenario: 复杂命令和非脚本参数不自动补全

- **WHEN** Bash 输入使用 `python -c`、`bash -lc`、管道、重定向、命令替换、`references/input.json` 或其他不满足窄规则的参数
- **THEN** 系统 MUST NOT 对任何参数应用 Skill 路径补全
- **AND** 后续行为 MUST 与引入本兼容规则前一致

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：当模型使用不带 Skill 名称的裸路径（如 `scripts/foo.py`）且多个已验证 Skill 包含同名脚本时，系统从 `context.flowVariables.activeSkillContext.skillName` 获取当前激活 Skill 的名称来过滤候选，只匹配当前激活的 Skill。含 Skill 名称前缀的路径行为不变。
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`

### 主规格

- **变更类型**：修改
- **目标内容**：`command-script-tools`
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`
