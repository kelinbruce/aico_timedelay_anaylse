# tool-search-tool 变更

所属 Function：`FN-5.14 搜索工具`

Function 变更类型：修改

spec 角色：主规格

## ADDED Requirements

### Requirement: ToolSearch input supports keyword, natural, and bounded list queries

`ToolSearch` input schema MUST 接受 optional `query`、`limit`、`matchMode` 和 `filters`，并 MUST 拒绝其他顶层字段。`query` 缺失时默认值 MUST 为 `""`，trim 后长度 MUST NOT 超过 256 个字符。`limit` 缺失时默认值 MUST 为 20，显式值 MUST 是 1 至 100 的整数。`matchMode` 缺失时默认值 MUST 为 `keyword`，显式值 MUST 是 `keyword` 或 `natural`。`filters.kind` 缺失时 MUST 同时允许 `TOOL` 和 `SKILL`，显式值 MUST 是 `TOOL` 或 `SKILL`。其他 `filters` 字段 MUST 使用长度不超过 128 个字符的非空字段名，并 MUST 使用 string、finite number 或 boolean scalar；string 值 MUST 非空且 scalar 文本长度 MUST NOT 超过 128 个字符。`keyword` mode MUST 对安全可搜索 metadata 执行确定性词法搜索，并 MUST 让 exact `capability_id` match 排在非 exact match 之前。`natural` mode MUST 对同一个安全 metadata 池执行确定性任务意图词法搜索，并 MUST NOT 调用模型、embedding service、外部搜索服务、SkillHub、CLIP runtime 或 provider 私有来源进行排序。当 `query` 缺失、trim 后为空或恰好为 `*` 时，系统 MUST 按 `kind`、`name`、`capability_id` 的稳定顺序返回同一 deferred candidate pool 的有界列表。返回数量达到 `limit` 且仍有候选未返回时，结果 MUST 包含 `truncated=true`。除 `kind` 外的 filter MUST 对 descriptor metadata scalar 执行精确文本匹配。系统 MUST 优先匹配 `metadata.<field>`；仅当该值不是 scalar 时，系统 MAY 匹配 `metadata.sourceMetadata.<field>`。选择 source metadata fallback 时，返回 shape、候选治理和默认结果 MUST 与 direct metadata match 相同。

**需求类别：功能性需求**

#### Scenario: 省略查询时返回有界候选列表

- **WHEN** 模型调用 `ToolSearch` 且省略 `query`
- **THEN** 系统 MUST 使用默认 `limit=20` 返回 deferred candidate pool 的稳定有界列表
- **AND** Tool result MUST 写入 request-local `allowedTools`
- **AND** Skill result MUST 写入 request-local `discoveredSkills`
- **AND** 存在未返回候选时结果 MUST 包含 `truncated=true`

#### Scenario: 空查询和星号查询使用同一列表语义

- **WHEN** 模型使用 trim 后为空的 `query` 或 `query="*"` 调用 `ToolSearch`
- **THEN** 系统 MUST 使用与省略 `query` 相同的候选范围、排序、上限和 activation 语义

#### Scenario: Keyword 搜索优先精确 id

- **WHEN** 模型使用 `matchMode=keyword` 和一个同时存在 exact id match 与弱 keyword match 的查询调用 `ToolSearch`
- **THEN** exact `capability_id` match MUST 排在弱 keyword match 之前

#### Scenario: Natural 搜索保持确定性和本地性

- **WHEN** 模型使用 `matchMode=natural` 和自然语言任务意图调用 `ToolSearch`
- **THEN** 相同 descriptors 和 input MUST 产生相同排序结果
- **AND** 系统 MUST NOT 调用模型、embedding service、外部搜索服务、SkillHub、CLIP runtime 或 provider 私有来源

#### Scenario: Filters 限定 kind 和 metadata

- **WHEN** 模型使用 `filters.kind="SKILL"` 和 `filters.level="1"` 调用 `ToolSearch`
- **THEN** 系统 MUST 只返回 metadata scalar `level` 精确等于 `"1"` 的 deferred Skill
- **AND** direct `metadata.level` 为 scalar 时 MUST 优先于 `metadata.sourceMetadata.level`

#### Scenario: 非法输入被安全拒绝

- **WHEN** input 包含未知顶层字段、非法 mode、非法 kind、非 scalar metadata filter、超长 query/filter 或范围外 limit 中的任一情况
- **THEN** `ToolSearch` MUST 返回安全 input validation failure
- **AND** 系统 MUST NOT 查询或激活候选

## MODIFIED Requirements

### Requirement: ToolSearch searches only governed visible tool metadata

系统 MUST 将 `ToolSearch` 暴露为当前 Agent/run 内的延迟能力查询 Tool。每次查询 MUST 只处理 resolver 已按当前 trusted Agent Scope、Owner Scope 和 capability binding 接受，且同时满足 `availabilityStatus=AVAILABLE`、`modelInvocable=false`、`kind=TOOL|SKILL`、`disclosurePolicy.mode!=HIDDEN` 的 descriptors。`ToolSearch` MUST NOT 扫描外部来源、安装能力、扩大授权、改变 capability conflict resolution，或回退返回 `modelInvocable=true` descriptors。Tool result MUST 只投影既有安全 Tool metadata，并 MUST 把命中的 ids 写入 request-local `allowedTools`。Skill result MUST 只投影 `capability_id`、display `name`、`kind=SKILL` 和既有安全 discovery metadata，并 MUST 把命中的 ids 写入 request-local `discoveredSkills`。`ToolSearch` MUST NOT 直接执行命中候选。现有 tool loop 提交 request-local patch 后，后续模型 step MAY 看见 activated Tool schema，或通过 `Skill(name=<capability_id>)` 加载 discovered Skill；选择调用时 MUST 使用命中结果中的 exact `capability_id`，未选择调用时 MUST 保持候选未执行。没有候选匹配时，系统 MUST 返回使用既有安全 result shape 的空结果，并 MUST NOT 产生 activation side effect。

**需求类别：功能性需求**

#### Scenario: 搜索只返回 deferred 安全 metadata

- **WHEN** 当前 Agent/run 同时存在符合查询的 `modelInvocable=false` 与 `modelInvocable=true` descriptors
- **THEN** `ToolSearch` MUST 只返回符合治理条件的 `modelInvocable=false` descriptors
- **AND** result MUST NOT 包含 Skill body、provider 私有事实、credential、endpoint、路径或 raw payload

#### Scenario: Hidden 和 unavailable 候选不被披露

- **WHEN** matching descriptor 的 `disclosurePolicy.mode=HIDDEN` 或 `availabilityStatus` 不是 `AVAILABLE`
- **THEN** `ToolSearch` MUST NOT 返回、计入 `truncated` 或激活该 descriptor

#### Scenario: 搜索与执行分属两个模型 step

- **WHEN** `ToolSearch` 返回一个或多个 Tool 或 Skill candidates
- **THEN** 当前 ToolSearch invocation MUST 只返回安全 metadata 和 request-local patch
- **AND** 只有 tool loop 提交 patch 后的后续模型 step MAY 调用 activated Tool 或 discovered Skill

#### Scenario: 无匹配返回安全空结果

- **WHEN** 没有 candidate 同时满足治理条件和查询条件
- **THEN** `ToolSearch` MUST 返回空的有界结果
- **AND** `allowedTools` 和 `discoveredSkills` MUST 不新增 candidate id

### Requirement: ToolSearch disclosure preserves existing model Tool Calling

当前 trusted Agent/run 已授权且可用的 `ToolSearch` MUST 默认进入模型 Tool 列表。ToolSearch 默认披露 MUST NOT 删除、重排或改写同一 Agent/run 原本可见的 governed `modelInvocable=true` Tool entries。搜索成功且 tool loop 已提交 request-local patch 后，下一模型 input MUST 在原有 entries 之外包含命中的 activated Tool schemas；未激活的 `modelInvocable=false` Tool MUST 保持不可调用。

**需求类别：功能性需求**

#### Scenario: 默认 ToolSearch 保留现有 Tool Calling

- **WHEN** 当前 Agent/run 同时拥有可用的 `ToolSearch` 和一个或多个 governed `modelInvocable=true` Tools
- **THEN** 模型 input MUST 包含 `ToolSearch`
- **AND** 所有原本可见的 `modelInvocable=true` Tool entries MUST 以相同 descriptor 语义保留

#### Scenario: 搜索结果只增加命中的 Tool schema

- **WHEN** `ToolSearch` 返回一个或多个 deferred Tool candidates
- **AND** tool loop 已提交包含这些 ids 的 request-local `allowedTools`
- **THEN** 下一模型 input MUST 增加这些命中 Tool 的 concrete schemas
- **AND** 未命中的 deferred Tool MUST 保持不可调用

### Requirement: Skill descriptor disclosure can be ToolSearch-deferred by trusted app configuration

系统 MUST 在 system prompt 中把当前 Agent/run 内 governed、`AVAILABLE`、非 `HIDDEN` 且 `modelInvocable=true` 的 Skill descriptors 披露为 enabled Skills。enabled Skill MUST 可通过 `Skill(name=<capability_id>)` 直接加载，且 `ToolSearch` MUST NOT 重复返回该 Skill。当前 Agent/run 内 governed、`AVAILABLE`、非 `HIDDEN` 且 `modelInvocable=false` 的 Skill MUST 不进入 enabled Skill 列表，并 MUST 只能在 `ToolSearch` 命中并写入 request-local `discoveredSkills` 后由 `Skill` Tool 加载。此边界 MUST 由 trusted app/runtime composition 和 governed descriptor 决定，客户端请求体、模型输出、Skill manifest 自定义 metadata 或 capability 参数 MUST NOT 覆盖该边界。

**需求类别：功能性需求**

#### Scenario: Enabled Skill 保持直接可用

- **WHEN** 当前 Agent/run 有 governed `modelInvocable=true` Skill
- **THEN** system prompt MUST 披露该 Skill 的 enabled descriptor
- **AND** 模型选择该 Skill 时 MUST 可不经 `ToolSearch` 直接调用 `Skill(name=<capability_id>)`
- **AND** `ToolSearch` MUST NOT 返回该 Skill

#### Scenario: Deferred Skill 需要当前请求发现

- **WHEN** matching Skill 为 `modelInvocable=false`
- **AND** 当前 request-local `discoveredSkills` 不包含该 Skill id
- **THEN** `Skill` Tool MUST 安全拒绝加载该 Skill body
- **AND** failure MUST NOT 泄漏 provider 或 source 私有事实

#### Scenario: ToolSearch 激活 Deferred Skill

- **WHEN** `ToolSearch` 命中一个 governed `modelInvocable=false` Skill
- **THEN** result MUST 把该 Skill id 写入 request-local `discoveredSkills`
- **AND** tool loop 提交 patch 后的后续模型 step 选择该 Skill 时 MUST 可调用 `Skill(name=<capability_id>)`

### Requirement: ToolSearch Projects Deferred CLIP Tool Results

trusted configuration 为 CLIP provider 选择 `tool-search` disclosure mode 时，系统 MUST 把该 provider 发现的 CLIP-backed capabilities 注册为 governed `modelInvocable=false` Tool descriptors，并 MUST 让它们参与与其他 deferred Tools 相同的 ToolSearch 查询和 request-local activation。命中 CLIP-backed Tool 时，结果 MUST 只投影该 Tool 的 governed `capability_id`、display `name`、`kind=TOOL` 和既有安全 discovery metadata，并 MUST 生成只包含命中 Tool 安全 metadata 的 `<available-clipc>` message。结果 MUST NOT 暴露 CLIP description、provider 私有 CLIP id、primitive、command template、endpoint、path、raw payload，或 `clipc`、`clip_api_call`、`api_name + args` generic dispatch Tool。

**需求类别：功能性需求**

#### Scenario: 命中 CLIP Tool 后激活 concrete Tool

- **WHEN** trusted configuration 启用 CLIP `tool-search` disclosure mode
- **AND** `ToolSearch` 命中一个或多个 governed `modelInvocable=false` CLIP-backed Tools
- **THEN** result MUST 把这些 Tool ids 写入 request-local `allowedTools`
- **AND** `<available-clipc>` MUST 只列出命中 Tool 的安全 metadata
- **AND** tool loop 提交 patch 后的下一模型 input MUST 暴露命中 Tool 自身的 `inputSchema`

#### Scenario: CLIP 私有事实不进入搜索结果

- **WHEN** `ToolSearch` 返回 CLIP-backed Tool result
- **THEN** result 和 generated message MUST NOT 包含 provider 私有 CLIP id、primitive、command template、endpoint、path 或 raw payload

#### Scenario: 未命中的 CLIP Tool 保持不可用

- **WHEN** CLIP-backed Tool 未匹配查询或不满足 deferred candidate 治理条件
- **THEN** `ToolSearch` MUST NOT 为该 Tool 生成 `<available-clipc>` entry
- **AND** `allowedTools` MUST 不包含该 Tool id

## Function 变更汇总

### 描述

- 变更类型：修改
- 目标内容：`FN-5.14 搜索工具` 默认发现当前 Agent/run 内受治理的 deferred Tool、Skill 和 configured CLIP-backed Tool，同时不重复搜索已经默认可见的能力。
- 依据 Requirements：`ToolSearch searches only governed visible tool metadata`、`ToolSearch disclosure preserves existing model Tool Calling`、`Skill descriptor disclosure can be ToolSearch-deferred by trusted app configuration`、`ToolSearch Projects Deferred CLIP Tool Results`

### 前置条件

- 变更类型：修改
- 目标内容：请求正在执行，trusted Agent/run 已完成 capability governance，且 `ToolSearch` 对当前 Agent/run 可用。
- 依据 Requirements：`ToolSearch searches only governed visible tool metadata`、`ToolSearch disclosure preserves existing model Tool Calling`

### 输入

- 变更类型：修改
- 目标内容：输入包含 optional `query`、`limit`、`matchMode` 和 `filters`；省略、空和 `*` query 具有唯一的有界列表语义。
- 依据 Requirements：`ToolSearch input supports keyword, natural, and bounded list queries`

### 输出

- 变更类型：修改
- 目标内容：输出为稳定有界的安全 Tool/Skill metadata results、`truncated` 和 request-local activation patch；no-match 输出安全空结果。
- 依据 Requirements：`ToolSearch input supports keyword, natural, and bounded list queries`、`ToolSearch searches only governed visible tool metadata`、`ToolSearch Projects Deferred CLIP Tool Results`

### 处理过程

- 变更类型：修改
- 目标内容：系统只在当前请求受治理的 `modelInvocable=false` candidate pool 中执行确定性搜索和 filter，命中后在请求内激活候选，并由后续模型 step 调用。
- 依据 Requirements：`ToolSearch searches only governed visible tool metadata`、`Skill descriptor disclosure can be ToolSearch-deferred by trusted app configuration`、`ToolSearch Projects Deferred CLIP Tool Results`

### 结果

- 变更类型：修改
- 目标内容：正常结果使命中候选可在后续模型 step 调用；无匹配返回空结果；非法输入安全失败；默认可见能力保持不变。
- 依据 Requirements：`ToolSearch input supports keyword, natural, and bounded list queries`、`ToolSearch searches only governed visible tool metadata`、`ToolSearch disclosure preserves existing model Tool Calling`

### 量化指标

- 指标名称：单次返回数量
- 变更类型：修改
- 原值或原口径：当前 Function 文档未记录数值；实现已有默认 20、最大 100 的结果上限。
- 目标值或目标口径：默认 20，调用方可在 1 至 100 间指定整数 `limit`。
- 单位与测量边界：个/单次 ToolSearch invocation；在治理和 filter 后、result projection 前计数。
- 依据 Requirements：`ToolSearch input supports keyword, natural, and bounded list queries`

- 指标名称：查询文本长度
- 变更类型：修改
- 原值或原口径：当前 Function 文档未记录数值；实现已有 256 字符上限。
- 目标值或目标口径：trim 前 schema input 和 trim 后 normalized query 均不得超过 256 个字符。
- 单位与测量边界：Unicode 字符/单次 `query` 字段校验。
- 依据 Requirements：`ToolSearch input supports keyword, natural, and bounded list queries`
