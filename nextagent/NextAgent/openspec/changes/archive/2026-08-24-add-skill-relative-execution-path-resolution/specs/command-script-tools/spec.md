## Function

- **所属 Function**：`FN-5.5 执行命令和脚本`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Bash 补全唯一匹配的 Skill 相对脚本路径

当 Bash 的解析结果表示直接解释器执行时，系统 MUST 只对首个脚本参数应用 Skill 相对执行路径兼容规则。受支持的解释器与脚本后缀组合 MUST 恰好为 `python`/`python3` 与 `.py`、`bash`/`sh` 与 `.sh`；候选参数 MUST 是 `scripts/<file>` 或 `<skill-name>/scripts/<file>` 形式的纯相对路径，且 `<file>` MUST 至少包含一个非空文件名 segment。

系统 MUST 只在当前 accepted execution scope 的已提交且验证通过的 Skill projections 中查找候选。`scripts/<file>` 在恰好一个 Skill 中匹配时，系统 MUST 把提交给 sandbox 的对应 argv 替换为该文件的 root-qualified 逻辑路径；`<skill-name>/scripts/<file>` MUST 只查找同名 Skill，并在恰好一个匹配时执行相同替换。系统 MUST 保持原始 Bash Tool 输入不变。

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

### Requirement: Skill 相对脚本解析保持 projection 安全边界

Skill 相对脚本解析 MUST 仅消费当前 Agent Scope、Owner Scope 和 accepted execution scope 中已经通过 committed projection manifest、完整性与 containment 验证的逻辑路径。系统 MUST NOT 扫描 Skill 源目录、未提交 projection、其他 execution scope 或物理文件系统路径，MUST NOT 通过成功结果、失败结果、候选项、日志或公共诊断暴露物理路径。

当不带 Skill 名称的 `scripts/<file>` 在至少两个已验证 Skill 中匹配时，系统 MUST 在 sandbox dispatch 前返回 `FAILED`、`safeError.code=SKILL_RESOURCE_PATH_AMBIGUOUS`、`safeError.category=VALIDATION` 和 `safeError.retryable=false`。`safeError.safeDetails.candidates` MUST 包含全部匹配的 root-qualified 逻辑路径并按字典序排列，MUST NOT 包含物理路径；sandbox invocation count MUST 为 `0`。

任一候选在最终验证时发生链接逃逸、manifest 不一致、文件缺失或 scope 不一致时，系统 MUST 把该候选视为不匹配，MUST NOT 使用该候选完成补全。候选过滤后为零个时 MUST 保持原 argv；为一个时 MUST 按唯一匹配规则补全；仍为至少两个时 MUST 返回歧义失败。

**需求类别**：系统质量属性
**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 同名脚本歧义时拒绝猜测

- **WHEN** 当前 scope 的两个已验证 Skill 都包含 `scripts/run.py`
- **AND** Bash 解析结果为 `python scripts/run.py`
- **THEN** 系统 MUST 返回 `SKILL_RESOURCE_PATH_AMBIGUOUS + VALIDATION + retryable=false`
- **AND** `safeError.safeDetails.candidates` MUST 按字典序包含两个 root-qualified 逻辑路径
- **AND** sandbox invocation count MUST 为 `0`

#### Scenario: 显式 Skill 名称消除同名歧义

- **WHEN** 多个 Skill 包含 `scripts/run.py`
- **AND** Bash 解析结果为 `python selected_skill/scripts/run.py`
- **AND** `selected_skill` 的 committed projection 验证通过
- **THEN** 系统 MUST 只补全 `selected_skill` 的逻辑路径
- **AND** 系统 MUST NOT 返回其他 Skill 的候选项

#### Scenario: 未提交或跨 scope projection 不参与匹配

- **WHEN** 同名脚本只存在于未提交 projection、其他 Agent、其他 Owner 或其他 execution scope
- **THEN** 系统 MUST 把当前 scope 的匹配数判定为零
- **AND** 系统 MUST NOT 暴露或执行该脚本

#### Scenario: 链接逃逸候选不参与匹配

- **WHEN** 候选脚本通过 symlink、junction 或 reparse point 指向 committed Skill root 之外
- **THEN** 系统 MUST 把该候选视为不匹配
- **AND** 系统 MUST NOT 把该逻辑路径提交给 sandbox

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：命令和脚本执行工具可在直接解释器执行的窄边界内补全当前 scope 唯一匹配的 Skill 相对脚本路径，并对歧义或越权候选 fail closed。
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`、`Skill 相对脚本解析保持 projection 安全边界`

### 处理过程

- **变更类型**：修改
- **目标内容**：Bash 完成确定性输入解析后，先判定直接解释器执行及受支持脚本形态，再依据当前 scope 已验证 Skill resources 的唯一匹配结果保持、补全或拒绝脚本参数，最后才进入既有 sandbox 授权与执行。
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`、`Skill 相对脚本解析保持 projection 安全边界`

### 结果

- **变更类型**：修改
- **目标内容**：唯一匹配返回既有进程结果，无匹配保持既有执行结果，多个匹配以 `SKILL_RESOURCE_PATH_AMBIGUOUS` 在执行前失败。
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`、`Skill 相对脚本解析保持 projection 安全边界`

### 规格

- **规格项**：Skill 相对脚本路径兼容
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：仅支持 `python`/`python3` 执行 `.py` 与 `bash`/`sh` 执行 `.sh`；只补全 `scripts/<file>` 或 `<skill-name>/scripts/<file>` 的当前 scope 唯一 verified projection 匹配，歧义以 `SKILL_RESOURCE_PATH_AMBIGUOUS` 拒绝
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`、`Skill 相对脚本解析保持 projection 安全边界`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-5.3 命令执行工具` 增加受治理的 Skill 相对脚本路径兼容行为。
- **依据 Requirements**：`Bash 补全唯一匹配的 Skill 相对脚本路径`、`Skill 相对脚本解析保持 projection 安全边界`
