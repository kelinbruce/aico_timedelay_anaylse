## Function

- **所属 Function**：`FN-5.10 访问技能资源`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Skill projection scope authority 必须可从有效提交事实恢复

本 Requirement 中，**Skill projection scope authority** 是指身份与完整性有效的 committed Skill projection 在其可信 execution scope 内形成的持续只读资源权限；该权限允许文件工具读取资源并允许受治理 sandbox 执行资源脚本，但不授予 projection 写权限或对应 Skill runtime Capability 的调用权限。系统 MUST 在 accepted run 切换、run terminal 和服务进程重启后，从当前可信 execution scope 内身份与完整性有效的 committed Skill projection 恢复相同的 Skill projection scope authority。恢复 MUST NOT 依赖先前 run 的内存状态、历史消息是否保留资源路径或当前 accepted Agent assembly 是否仍暴露对应 Skill runtime Capability。

当 projection 不存在、未提交、身份不匹配或完整性无效时，系统 MUST 将该 projection 视为没有 scope authority。系统 MUST NOT 因恢复失败而自动扩大文件访问范围；后续显式 Skill 激活可以重新建立有效 projection。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 后续 run 恢复同一 scope 的资源权限

- **GIVEN** 一个 Skill projection 已在可信 execution scope 内成功提交
- **WHEN** 同一 execution scope 的先前 run 已 terminal，且后续 run 访问该 projection
- **THEN** 系统 MUST 允许后续 run 读取该 projection
- **AND** 系统 MUST NOT 要求先前 run 的历史消息包含该 projection 路径

#### Scenario: Subject isolation mode 跨 session 共享

- **GIVEN** workspace isolation mode 为 `subject`
- **AND** 两个 accepted runs 的可信 `agentId`、`tenantId` 和 `subjectId` 相同，但 `sessionId` 与 `runId` 不同
- **AND** 第一个 run 已在其 execution scope 内成功提交 Skill projection
- **WHEN** 第二个 run 读取或显式执行该 projection
- **THEN** 系统 MUST 允许该访问
- **AND** 不同 `sessionId` 和 `runId` MUST NOT 产生额外授权要求

#### Scenario: 进程重启后恢复资源权限

- **GIVEN** 一个 Skill projection 已在可信 execution scope 内成功提交
- **AND** 该 projection 在服务进程重启后仍然存在且身份与完整性有效
- **WHEN** 同一 execution scope 的 accepted run 访问该 projection
- **THEN** 系统 MUST 恢复其只读资源权限
- **AND** 恢复结果 MUST NOT 依赖重启前的内存授权集合

#### Scenario: 无效提交事实不恢复权限

- **GIVEN** 一个 projection 缺少有效 committed identity 或完整性证据
- **WHEN** 同一 execution scope 的 accepted run 尝试读取或执行该 projection
- **THEN** 系统 MUST 拒绝访问或使该 projection 不可达
- **AND** 系统 MUST NOT 把逻辑路径文本作为替代 authority

### Requirement: Skill projection scope authority 必须保持 execution scope 隔离

系统 MUST 仅向派生出同一可信 execution scope 的 accepted runs 授予 Skill projection scope authority。系统 MUST 同时校验 Agent Scope、Owner Scope 和当前 workspace isolation mode 所要求的可信 scope facts；不同 execution scope 的 projection MUST 不可读且不可执行。

模型输出、历史消息、客户端 metadata、Capability 参数、Skill manifest metadata 和远端响应 MUST NOT 创建、替换或扩大 Skill projection scope authority。`.nextagent/skills/.staging/`、`.nextagent/skills/.locks/`、projection marker 以及未验证的 projection subtree MUST NOT 成为文件工具或 sandbox 的可访问根。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 不同 subject 不能共享 projection

- **GIVEN** 两个 accepted runs 的可信 `subjectId` 不同
- **WHEN** 其中一个 run 尝试访问另一个 execution scope 内的 Skill projection
- **THEN** 系统 MUST 拒绝访问或使目标不可达
- **AND** 失败结果 MUST NOT 泄漏目标 projection 是否存在

#### Scenario: 不同 Agent 或 tenant 不能共享 projection

- **GIVEN** 两个 accepted runs 的可信 `agentId` 或 `tenantId` 不同
- **WHEN** 其中一个 run 尝试访问另一个 execution scope 内的 Skill projection
- **THEN** 系统 MUST 拒绝访问或使目标不可达
- **AND** 失败结果 MUST NOT 泄漏目标 projection 是否存在

#### Scenario: Session isolation mode 不跨 session 共享

- **GIVEN** workspace isolation mode 为 `session`
- **AND** 两个 accepted runs 的可信 `sessionId` 不同
- **WHEN** 其中一个 run 尝试访问另一个 session scope 内的 Skill projection
- **THEN** 系统 MUST 拒绝访问或使目标不可达

#### Scenario: 构造的历史路径不产生 authority

- **GIVEN** 模型上下文包含 `.nextagent/skills/<skillProjectionKey>/<skill-name>/` 形式的路径
- **AND** 当前可信 execution scope 内没有与该路径对应的有效 committed projection
- **WHEN** accepted run 尝试读取或执行该路径
- **THEN** 系统 MUST 拒绝访问或使目标不可达
- **AND** 系统 MUST NOT 根据路径文本创建 projection authority

## MODIFIED Requirements

### Requirement: Skill resource access SHALL expose authorized resources through execution roots

Skill resource access SHALL 通过 builtin file tools 和 sandboxed dynamic execution 共用的 execution file access model 暴露有权访问的 Skill resources。成功的 Skill activation SHALL 把 `scripts/`、`references/` 和 `assets/` 中符合条件的 resources 投影到 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`，SHALL 在同一 hidden generated Skill load message 中把 Skill resource root location 放在原始 `SKILL.md` body 之前，并 SHALL 为 committed projection 建立 Skill projection scope authority。

同一可信 execution scope 的全部 accepted runs SHALL 能够通过文件工具读取该 scope 内身份与完整性有效的 committed Skill projections，并能够通过受治理 sandbox 以显式 Skill 资源路径执行其中允许执行的脚本。该权限 SHALL 不依赖 `runId`、历史上下文中的资源路径或当前 accepted Agent assembly 是否仍暴露对应 Skill runtime Capability。Skill runtime Capability 的发现、激活和调用仍 SHALL 服从当前 Agent assembly 与 capability governance，且不由文件访问结果扩大。

execution file model SHALL 向有权访问的 consumers 提供以下 logical roots：

- `workspace/`：durable read/write files；
- `.nextagent/`：system-managed authorized resources；
- `temp/`：run-scoped scratch files；
- `shared-data/`：仅供本地使用的 public shared input files 和显式 shared Python script paths；该 root MUST 只在 LOCAL deployment mode 中存在。

`.nextagent/` SHALL remain read-only to model、tool 和 script writes。文件工具和 sandbox SHALL 只暴露当前 execution scope 内有效的 committed Skill projection subtrees，MUST NOT 暴露整个 `.nextagent/` 管理根。

Host/source/provider-private locations 在 model-visible 和 tool-visible surfaces 中 SHALL 只表示为有界 logical execution paths、safe display paths 或稳定 safe reason codes。

**需求类别**：功能性需求

#### Scenario: 激活后的资源在同一 scope 内持续可达

- **WHEN** 一个 accepted run 激活包含 `references/guide.md` 的 governed Skill
- **THEN** 系统 SHALL 将引用暴露为 `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/guide.md`
- **AND** hidden generated Skill load message SHALL 在原始 Skill body 前提供 `.nextagent/skills/<skillProjectionKey>/<skill-name>/`
- **AND** 同一 execution scope 的后续 accepted runs SHALL 能够读取该引用

#### Scenario: 后续 run 执行已有 Skill 脚本

- **GIVEN** 一个 committed Skill projection 包含允许执行的 `scripts/check.py`
- **WHEN** 同一 execution scope 的后续 accepted run 通过受治理 sandbox 执行 `.nextagent/skills/<skillProjectionKey>/<skill-name>/scripts/check.py`
- **THEN** sandbox SHALL 能够读取并执行该脚本
- **AND** run 切换 SHALL NOT 要求重新激活对应 Skill

#### Scenario: 当前 assembly 不再暴露 Skill 时资源权限仍属于 scope

- **GIVEN** 一个 Skill projection 已在当前可信 execution scope 内成功提交
- **AND** 后续 accepted Agent assembly 不再暴露对应 Skill runtime Capability
- **WHEN** 同一 execution scope 的 accepted run 使用已知逻辑路径读取该 projection
- **THEN** 系统 SHALL 允许读取身份与完整性仍然有效的 committed projection
- **AND** 系统 SHALL NOT 因文件访问结果允许发现、激活或调用已不可用的 Skill runtime Capability

#### Scenario: Skill 脚本通过 workspace 写入持久结果

- **WHEN** 一个有权访问的 Skill 脚本读取 `.nextagent/skills/<skillProjectionKey>/<skill-name>/references/input.md`
- **AND** 该脚本写入 `workspace/result.md`
- **THEN** 读取 SHALL 使用当前 execution scope 的有效 Skill projection subtree
- **AND** 写入 SHALL 使用 accepted run 的 durable workspace root

#### Scenario: Skill 执行使用 run-scoped scratch space

- **WHEN** generated code 或 Skill script 在 accepted run 中需要中间文件
- **THEN** 中间文件 SHALL 创建在 `temp/` 下
- **AND** 后续 durable use SHALL 要求显式授权复制或写入 `workspace/`

#### Scenario: Projection 始终保持只读

- **GIVEN** 一个 Skill projection 在当前 execution scope 内具有 scope authority
- **WHEN** 文件工具或 sandboxed script 尝试写入该 projection
- **THEN** 系统 SHALL 拒绝写入

#### Scenario: 本地共享电信样例通过逻辑路径可达

- **WHEN** LOCAL mode 存在 `shared-data/cases/alarm.json`
- **AND** 一个 accepted run 读取 `shared-data/cases/alarm.json`
- **THEN** 读取 SHALL 使用 local shared data root
- **AND** 操作 MUST NOT 扩大到 `workspaceRoot/execution`、`workspaceRoot/data` 或其他 host directories

### Requirement: Authorized Skill Projection Supplies A Bounded Python Module Root

对于 Python script-path mode，受治理 sandbox MUST 仅从显式脚本路径匹配的当前 execution scope committed Skill projection 派生 Skill root。对于 Python module mode，sandbox MUST 仅在当前 execution scope 恰好存在一个可用 Skill projection root 时将其用作 Python module root。系统 MUST NOT 通过 descriptor、generated Skill message、model-visible workspace path、Web response、audit detail 或 safe error 发布 physical root。

系统 MUST 保留当前 execution scope 内全部有效 committed Skill projection roots，且 MUST NOT 按提交顺序、词法顺序、module name 或 source filesystem layout 隐式选择其中一个。Python module mode 面对空 root 集合或多 root 集合时 MUST 以显式安全失败结束。

**需求类别**：功能性需求

#### Scenario: Script path 使用同一 scope 的匹配 projection

- **GIVEN** 当前 execution scope 包含一个身份与完整性有效的 committed Skill projection
- **WHEN** sandbox 以该 projection 下的显式逻辑路径执行 Python script
- **THEN** sandbox MUST 仅使用与该路径匹配的 projection 作为 Skill root
- **AND** 其他 execution scope 的 projection MUST 不可用

#### Scenario: 单一 projection 支持 Python module mode

- **GIVEN** 当前 execution scope 恰好包含一个可用 Skill projection root
- **WHEN** Python module mode 请求 module root
- **THEN** sandbox MUST 使用该 scope-authorized projection root
- **AND** 系统 MUST NOT 发布该 root 的 physical path

#### Scenario: 多个 projection roots 不得被隐式选择

- **GIVEN** 当前 execution scope 包含多于一个可用 Skill projection root
- **WHEN** Python module mode 请求 module root
- **THEN** sandbox MUST 以显式安全失败结束
- **AND** sandbox MUST NOT 隐式选择任一 projection root

### Requirement: Skill Scripts Use Workspace For Results And Temp For Intermediate Files

系统 SHALL 通过 sandbox 提供的 process environment 定义 Skill Python scripts 的 output-root contract。当 Skill Python script 产生文件且对应环境变量存在时，脚本 SHOULD 把最终 user-visible 或 session-visible result data 写入 `NEXTAGENT_WORKSPACE_DIR` 标识的 process path，并 SHOULD 把 intermediate data、scratch files 和 transient execution artifacts 写入 `NEXTAGENT_TEMP_DIR`。只有脚本不产生对应类别的文件或 sandbox 未提供对应环境变量时才允许偏离；偏离时脚本 MUST NOT 改为写入其他 host physical path。

sandbox adapter MAY 仅在以下两种结果之一派生出恰好一个 trusted Skill projection root 时，向 child process 暴露 `NEXTAGENT_SKILL_ROOT`：当前 execution scope 的显式 script path 匹配结果，或 Python module mode 的单一有效 committed projection 选择结果。该值 MUST 来自当前 execution scope 的 Skill projection scope authority，且 MUST NOT 授予 `.nextagent` 写权限。条件不成立或 adapter 不选择暴露该可选环境变量时，child process 中 `NEXTAGENT_SKILL_ROOT` MUST 缺失；显式 script-path execution 仍 MUST 通过 sandbox filesystem layout 访问已匹配的只读 projection。

返回给模型的 sandbox stdout 和 stderr SHALL 把当前 request filesystem roots 下的 physical paths 投影为 `workspace/`、`temp/`、`.nextagent/skills/...` 或 `shared-data/...` logical execution paths。在 LOCAL mode 中，当 sandbox result 包含 request `defaultCwd` subtree 内普通文件的精确 physical path，且存在 run-scoped `temp` root 时，adapter MAY 把该被引用文件以相同 relative path 复制到 `temp/`，并把 model-visible path 投影为 `temp/...`。adapter 不选择复制时 MUST 从 stdout/stderr 移除 host physical path，且 MUST NOT 发布该文件。adapter MUST NOT 扫描 `defaultCwd`、发布未引用文件、复制目录、复制 `defaultCwd` 外的文件，或在 capability result 中暴露 host physical path。

**需求类别**：功能性需求

#### Scenario: Skill 脚本分离中间文件与最终结果

- **WHEN** 一个 Skill script 处理其有权访问的 Skill projection 中的数据
- **AND** 该脚本通过 `NEXTAGENT_TEMP_DIR` 写入中间文件
- **AND** 该脚本通过 `NEXTAGENT_WORKSPACE_DIR` 写入最终结果
- **THEN** 中间文件 SHALL 保持为 run-scoped temp data
- **AND** 最终结果 SHALL 写入 durable workspace root

#### Scenario: Skill root 环境变量来自当前 scope 的唯一选择结果

- **GIVEN** sandbox 根据显式 script path 或 Python module mode 在当前 execution scope 中选择了恰好一个有效 committed Skill projection root
- **WHEN** sandbox adapter 向 child process 暴露 `NEXTAGENT_SKILL_ROOT`
- **THEN** 该值 MUST 指向被选择 projection 的只读 sandbox path
- **AND** 其他 execution scope 的 projection MUST 不可用
- **AND** child process MUST NOT 获得该 projection 的写权限

#### Scenario: 本地物理输出路径只以逻辑路径对模型可见

- **WHEN** 一个 LOCAL sandboxed Skill script 输出 `workspace`、`temp`、有权访问的 Skill projection root 或 execution `defaultCwd` 下的 physical path
- **THEN** capability result 的 stdout/stderr SHALL 只包含逻辑 execution paths
- **AND** 当 run-scoped `temp/` root 存在时，`defaultCwd` 下被明确引用的普通文件 SHALL 在该 `temp/` 逻辑 root 下可用，以供后续文件工具读取

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：技能通过 execution scope 隔离的只读资源权限访问已提交资源；同一 scope 的 accepted runs 可以跨 run 和进程重启持续读取资源并执行允许执行的脚本。
- **依据 Requirements**：`Skill resource access SHALL expose authorized resources through execution roots`、`Skill projection scope authority 必须可从有效提交事实恢复`、`Skill projection scope authority 必须保持 execution scope 隔离`、`Authorized Skill Projection Supplies A Bounded Python Module Root`、`Skill Scripts Use Workspace For Results And Temp For Intermediate Files`

### 前置条件

- **变更类型**：修改
- **目标内容**：目标资源属于当前可信 execution scope 内身份与完整性有效的 committed Skill projection；资源访问不要求当前 run 重新激活 Skill。
- **依据 Requirements**：`Skill resource access SHALL expose authorized resources through execution roots`、`Skill projection scope authority 必须可从有效提交事实恢复`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统校验可信 execution scope、projection 提交身份与完整性、逻辑路径和根权限；有效资源在同一 scope 内保持可读和可执行，跨 scope、无效 projection 和写入操作安全失败。
- **依据 Requirements**：`Skill resource access SHALL expose authorized resources through execution roots`、`Skill projection scope authority 必须可从有效提交事实恢复`、`Skill projection scope authority 必须保持 execution scope 隔离`、`Authorized Skill Projection Supplies A Bounded Python Module Root`、`Skill Scripts Use Workspace For Results And Temp For Intermediate Files`

### 结果

- **变更类型**：修改
- **目标内容**：同一 execution scope 的 accepted runs 获得持续的 Skill projection 只读资源访问；跨 scope、未提交、损坏、身份不一致或需要隐式选择多个 module roots 的访问返回安全失败。
- **依据 Requirements**：`Skill resource access SHALL expose authorized resources through execution roots`、`Skill projection scope authority 必须可从有效提交事实恢复`、`Skill projection scope authority 必须保持 execution scope 隔离`、`Authorized Skill Projection Supplies A Bounded Python Module Root`、`Skill Scripts Use Workspace For Results And Temp For Intermediate Files`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-5.6 Skill 系统`提供同一可信 execution scope 内跨 run、跨进程重启的 Skill 资源复用，并保持跨 scope 隔离和只读保证。
- **依据 Requirements**：`Skill resource access SHALL expose authorized resources through execution roots`、`Skill projection scope authority 必须可从有效提交事实恢复`、`Skill projection scope authority 必须保持 execution scope 隔离`
