所属 Function：`FN-10.4 自定义工具和提示词`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: 系统提示词与 Tool descriptor 提供一致的工具调用指导

系统 MUST 为主模型提供由 `SYSTEM_PROMPT` 统一承载的跨 Tool 选择和 outcome 处理指导，并 MUST 使每个 model-visible Tool descriptor 只补充该 Tool 自身的功能域、权限、输入输出、硬前置条件、结果边界和特有恢复语义。统一指导与 Tool descriptor MUST 与当前 Tool schema、执行权限和实际 outcome mapping 一致，MUST NOT 承诺实现未提供的排序、正则语法、脚本入口、能力发现范围、自动通知或重试行为。

**需求类别：功能性需求**

#### Scenario: 已知文件路径不触发预搜索

- **WHEN** 用户明确提供一个受支持的 execution-view 文件路径，或前序 Tool result 已返回该精确路径
- **THEN** 统一指导 MUST 引导模型直接选择与目标操作匹配的 `Read`、`Write` 或完整 `Read` 后的 `Edit`/覆盖 `Write`
- **AND** MUST NOT 仅为确认路径存在而先调用 `Glob`

#### Scenario: 具体目标与调用意图共同决定首个动作

- **WHEN** 系统需要选择是否调用 Tool 以及首个 Tool
- **THEN** 统一指导 MUST 优先选择能够解决当前目标或最早真实阻塞点的最窄动作
- **AND** MUST NOT 仅因某个 Tool 只读、廉价或可用就执行与当前目标无关的预调用
- **AND** MUST 将一个具体 execution-view path 与仅描述文件名、最新文件、某类文件或不完整位置线索区分
- **AND** MUST 将明确调用请求与对 Tool 的提及、比较、说明或否定调用区分

#### Scenario: 按可信数据源选择检索边界

- **WHEN** 输入使用“文档”“配置”“日志”或类似通用对象名称但未给出可信来源
- **THEN** 统一指导 MUST NOT 仅依据对象名称假定其位于 workspace、governed knowledge index、prior-session memory 或操作系统环境
- **AND** MUST 按已知来源选择已暴露且适用的文件、`Rag`、memory 或 Bash/CLI 能力
- **AND** 已披露 Tool、Skill 或 Agent 的纯可用性问题 MUST 直接依据当前 capability catalog 回答，不得为证明其可见性而调用该能力或 `ToolSearch`

#### Scenario: 未知目标按名称和内容分流

- **WHEN** 模型需要定位尚无精确路径的文件
- **THEN** 统一指导 MUST 将文件名或路径 pattern discovery 映射到 `Glob`
- **AND** MUST 将跨文件内容 pattern search 映射到 `Grep`
- **AND** `Glob` descriptor MUST NOT 承诺 modification-time 排序
- **AND** `Grep` descriptor MUST 只承诺当前实现支持的 ECMAScript regular expression 和实际 schema fields

#### Scenario: 已有脚本和命令行操作使用 Bash

- **WHEN** 任务要求启动一个已有脚本、module、build、test、package、version-control 或其他命令行操作
- **THEN** 指导 MUST 将其映射到受 composed sandbox policy 治理的 `Bash`
- **AND** MUST NOT 把 Bash 权限窄化为固定只读或固定 diagnostic 命令集合

#### Scenario: 直接 Python source snippet 使用 Python

- **WHEN** 任务要求执行直接提供在 `code` field 中的 Python source snippet
- **THEN** 指导 MUST 将其映射到 `Python`
- **AND** MUST NOT 声称 `Python` 可以接收已有 `.py` 文件路径并启动该文件
- **AND** `args` 中类似文件名的字符串 MUST NOT 被解释为已发现或已授权的文件路径

#### Scenario: 已治理索引中的知识使用 Rag

- **WHEN** 答案位于当前 Agent 已配置的 governed knowledge indexes
- **THEN** 指导 MUST 将检索映射到 `Rag`
- **AND** MUST NOT 仅因输入提到任意文档名称就假定该文档已被索引

#### Scenario: 可见 Skill 使用 exact capability id

- **WHEN** 一个匹配的 governed Skill 已在当前 Skill list 中可见
- **THEN** 指导 MUST 使用 exact capability id 调用 `Skill`

#### Scenario: 已披露能力使用受治理可见性事实

- **WHEN** 当前请求的系统上下文已经列出一个 Skill 或 Agent
- **THEN** 统一指导 MUST 将该列表作为当前 request scope 中 capability visibility 的权威事实
- **AND** MUST NOT 使用 `Glob`、`Grep`、`Read`、`Bash` 或 `ToolSearch` 重新发现该能力
- **AND** MUST 区分 capability visibility、实际调用结果、外部依赖健康和源码完整性
- **AND** 在当前授权范围无法检查源码时 MUST 说明该范围限制，MUST NOT 将 execution view 或 `ToolSearch` 的空结果解释为该能力未实现

#### Scenario: Deferred Tool 或 Skill 先经 ToolSearch 发现

- **WHEN** 所需 Tool 或 Skill 是当前未暴露但可搜索的 deferred capability
- **THEN** 指导 MUST 先调用 `ToolSearch`
- **AND** MUST NOT 声称 `ToolSearch` 搜索 Agent、Workflow、文件、知识内容或长期记忆

#### Scenario: 可用 Agent 只接收自包含子任务

- **WHEN** 任务需要委派给一个 `Available agents` 中的 governed Agent
- **THEN** 指导 MUST 只为具体、有界、自包含的子任务使用 `Agent`
- **AND** MUST 说明 child Agent 不继承 parent conversation context

#### Scenario: outcome 恢复依据结构化事实

- **WHEN** Tool invocation 返回 `SUCCEEDED`、`DEGRADED`、`FAILED`、`TIMED_OUT` 或 `CANCELED`
- **THEN** 统一指导 MUST 要求模型依据 structured payload、safe error、diagnostics、`retryable` 和 truncation facts 决定下一步
- **AND** MUST NOT 把 `DEGRADED` 当作完整成功
- **AND** MUST NOT 原样重复没有可修正输入或显式 retry evidence 的失败调用
- **AND** authorization 或 unavailable outcome MUST NOT 被指导绕过治理边界

#### Scenario: 单一覆盖工具优先于重叠调用

- **WHEN** 回答请求所需的可信事实已经存在，或一个可用 Tool 调用能够完整覆盖同一目标
- **THEN** 统一指导 MUST 分别选择不调用 Tool 或只调用该单一 Tool
- **AND** 多个 Tool 调用只有在每个调用均为必要且彼此回答独立问题时 MUST 并行执行
- **AND** MUST NOT 生成推测性、相互重叠或可安全合并的并行调用

#### Scenario: Glob 合并同一文件类别的扩展名

- **WHEN** 同一文件类别包含多个扩展名且一个受支持的 Glob pattern 能够完整覆盖这些扩展名
- **THEN** `Glob` descriptor MUST 披露 brace alternatives 和 character classes
- **AND** 指导 MUST 要求模型使用一次覆盖性 `Glob` 调用
- **AND** MUST NOT 改变 Glob 的授权范围、500 条结果上限、路径校验或现有 pattern 执行语义

#### Scenario: Tool 特有恢复语义与实现一致

- **WHEN** Tool descriptor 提及 error、degradation、timeout、cancellation、paging、stale snapshot 或 retry guidance
- **THEN** 该描述 MUST 与当前 Tool implementation 和 output schema 的实际 outcome mapping 一致
- **AND** descriptor MUST 只保留会改变模型下一步选择的特有恢复语义
- **AND** 通用 outcome 处理 MUST 由 `SYSTEM_PROMPT` 统一承载而不在所有 descriptor 中重复

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：`FN-10.4` 提供的模型可见工具和提示词指导形成单一、准确、可验证的协同契约；统一规则由 `SYSTEM_PROMPT` 承载，Tool descriptor 只承载 Tool-local 事实。
- 依据 Requirements：`系统提示词与 Tool descriptor 提供一致的工具调用指导`
### 处理过程

- 变更类型：修改
- 目标内容：系统先按操作、目标定位状态和 governed capability visibility 引导工具选择，再按结构化 outcome facts 引导恢复；相同输入、状态和上下文产生一致的选择边界。
- 依据 Requirements：`系统提示词与 Tool descriptor 提供一致的工具调用指导`

### 结果

- 变更类型：修改
- 目标内容：模型获得与实际 Tool contract 一致的最短合法调用路径，并避免无依据的预搜索、能力猜测、权限假设和重复失败调用。
- 依据 Requirements：`系统提示词与 Tool descriptor 提供一致的工具调用指导`
