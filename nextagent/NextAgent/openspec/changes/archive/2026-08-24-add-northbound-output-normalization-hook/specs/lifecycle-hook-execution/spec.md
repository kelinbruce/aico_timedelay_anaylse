## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Capability 结果后边界提供同次调用的有效输入

每个 `AFTER_CAPABILITY_RESULT` boundary MUST 包含该次 runtime Capability 调用实际使用的 `arguments: JsonObject`。该字段 MUST 是 `BEFORE_CAPABILITY_INVOKE` 的合法 mutation 应用后、Capability executor 接收的有效输入；Hook 对收到的嵌套值执行原地修改，MUST NOT 改变已经完成的 Capability 调用、持久化事实或其他 Hook 看到的边界。

`arguments` MUST 只提供给当前 accepted Agent 已激活的 `AFTER_CAPABILITY_RESULT` Hook。Runtime MUST NOT 因该字段自动新增日志、metric、trace、audit、safe error、Web API、stream、timeline 或 terminal projection。Hook 主动产生的结果或开发诊断 MUST 继续分别遵守其已批准的输出契约；本 Requirement 不扩大任何 Hook 输出权限。

**需求类别**：系统质量属性

**质量属性**：安全、可测试性
**适用范围**：该 Function

#### Scenario: 结果后 Hook 取得 executor 实际使用的输入

- **GIVEN** `BEFORE_CAPABILITY_INVOKE` Hook 已将 Bash `arguments.command` 替换为包含 `action.py` 的字符串
- **WHEN** 该 Bash 调用完成并进入 `AFTER_CAPABILITY_RESULT`
- **THEN** 结果后 boundary 的 `arguments.command` MUST 是替换后的有效字符串
- **AND** 不得提供被替换前的输入作为匹配依据

#### Scenario: 结果后输入不扩散到其他输出面

- **WHEN** `AFTER_CAPABILITY_RESULT` boundary 包含 `arguments`
- **THEN** Runtime MUST NOT 自动把该字段写入日志、metric、trace、audit、safe error、Web API、stream、timeline 或 terminal projection
- **AND** 未显式返回 `resultSummary` 的 Hook invocation MUST NOT 因该字段产生结果输出

#### Scenario: Hook 原地修改结果后输入不改变已成立事实

- **WHEN** Hook 原地修改收到的 `arguments` 嵌套值且未通过任何合法结果字段返回 replacement
- **THEN** 已完成的 Capability 调用输入和结果 MUST 保持不变
- **AND** 后续 Hook 看到的结果后 boundary MUST 保持 stage 入口的有效输入

### Requirement: Northbound output normalization Hook 仅匹配目标 Bash action

系统 MUST 提供 `hookId="northbound-output-normalization-hook"` 的 `CUSTOM` transform lifecycle Hook。部署方 MUST 通过既有 Agent Hook activation 的 `config.matchText` 提供用于匹配的非空字符串；显式提供空字符串、仅包含空白或缺少必填字段的 config MUST 在 activation materialization 时失败。没有 activation config 的基础 Hook executable MUST 保持 inert 并返回 `SKIP`。该 Hook MUST 只支持 `AFTER_CAPABILITY_RESULT`，MUST 使用 `effects=["TRANSFORM"]` 和 `failureMode="CONTINUE"`，并且只有在当前 Agent 显式激活后才能执行。

该 Hook MUST 按以下完整条件表决定结果；字符串包含判断 MUST 区分大小写，并以该插件实例配置的连续子字符串 `matchText` 为唯一匹配文本：

| `capabilityId` | `arguments.command` | `arguments.args` | Hook 结果 |
|---|---|---|---|
| 精确等于 `Bash` | string 且包含 `matchText` | 任意合法值或缺失 | `PASS`，并提供 `resultSummary` 和 `mutation: { structuredPayload }` |
| 精确等于 `Bash` | 不包含 `matchText` 或不是 string | array 且至少一个 string 元素包含 `matchText` | `PASS`，并提供 `resultSummary` 和 `mutation: { structuredPayload }` |
| 其他全部组合 | 任意值 | 任意值 | `SKIP`，并省略 `resultSummary` |

当 `command` 和 `args` 同时命中时，Hook MUST 仍只返回一个 `HookResult`。该 Hook MUST NOT 匹配 `description`、`env`、Capability 结果或其他字段中的 `matchText`，MUST NOT 返回 control outcome、pending intent、safe reason 或 error；命中时 MUST 同时返回 `resultSummary` 和 `mutation: { structuredPayload }`。

**需求类别**：功能性需求

#### Scenario: Bash command 命中配置字符串

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 精确等于 `Bash`，且有效 `arguments.command` 为 `python workspace/actions/northbound-entry.py --site 001`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "PASS"`
- **AND** MUST 提供恰好一个 `resultSummary` 和 `mutation: { structuredPayload }`

#### Scenario: Bash args 命中同一配置字符串

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 精确等于 `Bash`，有效 `arguments.command` 为 `python`，且 `arguments.args` 至少包含字符串 `workspace/actions/northbound-entry.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "PASS"`
- **AND** MUST 提供恰好一个 `resultSummary` 和 `mutation: { structuredPayload }`

#### Scenario: 大小写不同不命中

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 精确等于 `Bash`，但 `command` 和全部 `args` 字符串都不包含区分大小写的连续文本 `northbound-entry.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 非 Bash Capability 不命中

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成调用的 `capabilityId` 不等于 `Bash`，即使其 `arguments.command` 或任一 `arguments.args` 字符串包含 `northbound-entry.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 旧固定字符串不会覆盖插件配置

- **GIVEN** Agent Hook activation 配置 `matchText="northbound-entry.py"`
- **WHEN** 已完成 Bash 调用的有效 `arguments.command` 只包含 `action.py`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 空白检查字符串配置失败

- **WHEN** Agent Hook activation config 显式提供空字符串、仅包含空白或缺少必填 `matchText`
- **THEN** activation materialization MUST 失败
- **AND** MUST NOT 产生会匹配所有 Bash 输入的 Hook

### Requirement: Northbound Hook 原样返回已批准的 Bash 结构化结果

当 `northbound-output-normalization-hook` 命中目标 Bash action 时，Hook MUST 把当前 `AFTER_CAPABILITY_RESULT` boundary 的完整 `structuredPayload` 作为 `HookResult.resultSummary` 和 `HookResult.mutation.structuredPayload` 返回，并保持 JSON 语义等价。该 Hook 是“Hook 结果输出必须由 Hook 明确负责 timeline 安全性”和“Hook 结果输出必须满足请求终态公开边界”中禁止复制通用 Capability 输出规则的唯一显式受控例外；例外只适用于当前 Owner Scope 与 Agent Scope 的匹配 Bash action 结果。

Hook MUST NOT 解析、筛选、重命名、转换、排序、裁剪、脱敏、补全或合并 `structuredPayload`。当 boundary 缺少 `structuredPayload` 时，Hook MUST 返回 `SKIP` 并省略 `resultSummary`。当完整 Hook invocation fact 或 terminal Hook 结果快照不满足既有 JSON 或容量边界时，系统 MUST 按既有 Hook 非法结果语义拒绝整个 `resultSummary`，MUST NOT 返回部分、截断或改写的 Bash 结果；transform Hook 的该失败 MUST NOT 改变 Bash 调用结果或请求 truth。

**需求类别**：系统质量属性

**质量属性**：安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 匹配结果按 JSON 语义原样进入 HookResult

- **GIVEN** 匹配 Bash action 的 `structuredPayload` 为 `{ "stdout": "ok", "stderr": "", "exitCode": 0, "stdoutTruncated": false, "stderrTruncated": false }`
- **WHEN** `northbound-output-normalization-hook` 执行完成
- **THEN** `HookResult.resultSummary` 和 `HookResult.mutation.structuredPayload` MUST 与该 `structuredPayload` 保持 JSON 语义等价
- **AND** 同一请求终态 Hook 结果快照 MUST 按既有契约提供同一结果对象

#### Scenario: 缺少结构化结果时跳过

- **WHEN** 调用身份和输入满足匹配条件，但 `AFTER_CAPABILITY_RESULT` boundary 缺少 `structuredPayload`
- **THEN** `northbound-output-normalization-hook` MUST 返回 `outcome: "SKIP"`
- **AND** MUST 省略 `resultSummary`

#### Scenario: 结果超过既有容量边界时不部分输出

- **WHEN** Hook 返回的完整 Bash `structuredPayload` 使既有 Hook invocation fact 或 terminal Hook 结果快照超过容量边界
- **THEN** 系统 MUST 拒绝整个 `resultSummary`
- **AND** MUST NOT 截断、筛选或改写 Bash 结果
- **AND** Bash 调用结果和请求 truth MUST 保持不变

### Requirement: Northbound Hook 作为未激活插件资产随本地运行包交付

每个 backend-capable 本地运行包 MUST 在 `config/plugins/northbound-output-normalization-hook/` 包含可由既有 plugin loader 加载的 `plugin.json` 和 `index.js`。`plugin.json` MUST 声明 `pluginId="northbound-output-normalization-hook"`，`main="./index.js"` 和 `artifactType="esm-bundle"`。

打包流程 MUST NOT 因交付该资产而自动向包内 system config 添加 plugin entry，MUST NOT 自动向任何 packaged Agent 添加 Hook activation。未通过 Agent Hook activation 提供 `matchText` 的插件 Hook MUST 保持 inert，并在被执行时返回 `SKIP`；显式提供空字符串或仅包含空白的 `matchText` MUST 继续失败。

**需求类别**：功能性需求

#### Scenario: Backend-capable 包包含 Northbound Hook 插件资产

- **WHEN** 打包流程生成 `backend-only` 或 `with-frontend` 本地运行包
- **THEN** candidate MUST 包含 `config/plugins/northbound-output-normalization-hook/plugin.json`
- **AND** candidate MUST 包含 `config/plugins/northbound-output-normalization-hook/index.js`
- **AND** 该插件资产 MUST 可由既有 plugin loader 加载

#### Scenario: 随包交付不自动声明或激活 Hook

- **WHEN** 打包流程把 Northbound Hook 插件资产写入 candidate
- **THEN** 包内 system config MUST NOT 因该资产新增 `northbound-output-normalization-hook` plugin entry
- **AND** packaged Agent MUST NOT 因该资产新增 `northbound-output-normalization-hook` activation

#### Scenario: Frontend-only 包不包含后端 Hook 资产

- **WHEN** 打包流程生成 `frontend-only` artifact
- **THEN** artifact MUST NOT 包含 `config/plugins/northbound-output-normalization-hook/`

### Requirement: Hook invocation requestContextId MUST stay within timeline field length limits

Runtime 在构建 Hook execution scope 时生成的 `requestContextId` MUST 不超过 timeline event inline payload 字段长度限制。当 `stageOccurrenceKey` 拼接后的 `requestContextId` 可能超过限制时，runtime MUST 使用确定性短哈希压缩该值，使生成的 `requestContextId` 保持唯一性同时远低于限制长度。

**需求类别**：系统质量属性

**质量属性**：可靠性、可测试性

#### Scenario: 长 stageOccurrenceKey 被压缩为短 requestContextId

- **WHEN** Hook invocation 的 `stageOccurrenceKey` 格式为 AFTER_CAPABILITY_RESULT:round:0:tool:<toolCallId>:after，拼接后超过 64 字符
- **THEN** runtime MUST 使用短哈希压缩生成 `requestContextId`
- **AND** 生成的 `requestContextId` MUST 远低于 timeline 字段长度限制
- **AND** `HOOK_INVOKED` 事件 MUST 成功写入 timeline store

#### Scenario: 短哈希保持唯一性

- **WHEN** 两个不同的 `stageOccurrenceKey` 各自生成短哈希
- **THEN** 生成的 `requestContextId` MUST 在实际使用场景中保持区分性
- **AND** 哈希碰撞不会导致 timeline 事件写入失败

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：结果后 Hook 可取得同次 runtime Capability 调用实际使用的有效输入，并只能在当前 accepted Agent 的已激活 Hook 边界内消费。
- **依据 Requirements**：`Capability 结果后边界提供同次调用的有效输入`

### 输出

- **变更类型**：修改
- **目标内容**：`northbound-output-normalization-hook` 对匹配 Bash action 返回与结构化执行结果 JSON 语义等价的 `resultSummary` 和 `mutation: { structuredPayload }`；不匹配、缺少结果或非法结果不输出部分内容。
- **依据 Requirements**：`Northbound output normalization Hook 仅匹配目标 Bash action`、`Northbound Hook 原样返回已批准的 Bash 结构化结果`

### 结果

- **变更类型**：修改
- **目标内容**：backend-capable 本地运行包随附未自动声明、未自动激活的 Northbound Hook 插件资产；frontend-only artifact 不包含该后端插件。
- **依据 Requirements**：`Northbound Hook 作为未激活插件资产随本地运行包交付`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 Capability 执行完成后按 runtime Capability 身份与有效输入的精确组合条件决定 Hook 命中或跳过；命中时直接返回完整结构化结果，不改变 Capability 执行或请求 truth。
- **依据 Requirements**：`Capability 结果后边界提供同次调用的有效输入`、`Northbound output normalization Hook 仅匹配目标 Bash action`、`Northbound Hook 原样返回已批准的 Bash 结构化结果`

### 规格

- **规格项**：Northbound Bash action Hook
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`northbound-output-normalization-hook` 的检查字符串由 Agent Hook activation config 显式提供且非空；Hook 仅支持 `AFTER_CAPABILITY_RESULT`，只在 `capabilityId="Bash"` 且有效 `command` 或任一 `args` 字符串包含区分大小写的配置文本时原样返回 `structuredPayload` 作为 `resultSummary` 和 `mutation: { structuredPayload }`
- **依据 Requirements**：`Northbound output normalization Hook 仅匹配目标 Bash action`、`Northbound Hook 原样返回已批准的 Bash 结构化结果`
