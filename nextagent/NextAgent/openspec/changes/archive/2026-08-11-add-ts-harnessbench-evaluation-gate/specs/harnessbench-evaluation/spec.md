## 所属 Function

`FN-10.13 HarnessBench 评测`

## Function 变更类型

新增

## spec 角色

主规格

## ADDED Requirements

### Requirement: 评测运行固定版本与任务边界

系统 MUST 以 `node tests/harnessbench/run.mjs` 作为唯一标准全量评测入口。该入口 MUST 在任务执行前解析 HarnessBench Git commit、NextAgent Git commit、模型标识和该 HarnessBench commit 的完整 task catalog，并将这些事实写入不可变的全量评测清单。HarnessBench Git commit MUST 是完整的 40 位提交哈希。全量评测清单 MUST 与上游 task catalog 恰好一致，每个 task id MUST 恰好出现一次，状态 MUST 是 `execute` 或 `unsupported`；`unsupported` 项 MUST 具有非空原因。评测开始后，系统 MUST NOT 增加、删除或改变清单项。

**需求类别：功能性需求**

#### Scenario: 固定清单后开始评测

- **WHEN** HarnessBench commit 可解析且完整 task catalog 已加载
- **THEN** 系统生成与上游 task catalog 恰好一致的不可变全量评测清单
- **AND** 清单关联 HarnessBench commit、NextAgent commit、模型标识和全部 task id
- **AND** 每个 task 的状态恰好是 `execute` 或具有非空原因的 `unsupported`

#### Scenario: 标准入口完成全量评测

- **WHEN** 运行 `node tests/harnessbench/run.mjs` 且运行前条件有效
- **THEN** 系统 MUST 覆盖全量评测清单并生成完整报告
- **AND** task-level 的不支持或失败 MUST NOT 使标准入口跳过其余 task
- **AND** 全部 task 形成终态结论且报告发布成功时标准入口退出码为 `0`

#### Scenario: 上游版本或任务范围非法

- **WHEN** HarnessBench commit 不可解析、检出的上游 `HEAD` 与请求 commit 不一致、任一上游 task 缺失或重复、清单存在额外 task，或任一 `unsupported` 项缺少原因
- **THEN** 系统 MUST 在第一个 task 执行前终止评测
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`
- **AND** 标准入口退出码 MUST 非 `0`

### Requirement: 全量任务通过真实 NextAgent 产品边界评测

系统 MUST 对全量评测清单中的每个 task 形成一个终态评测结论。状态为 `execute` 的 task MUST 使用当前工作树构建出的 NextAgent local runtime，并通过公开的会话、请求和 stream 行为提交任务及等待 terminal result；状态为 `unsupported` 的 task MUST 以 `0` 分形成终态结论，不得从框架效果得分分母移除。系统 MUST 以 HarnessBench 提供的任务工作区作为执行 task 的输入与结果边界。系统 MUST NOT 修改 `packages/**`、公共契约、产品默认 Agent 或 HarnessBench task、oracle 与评分实现来使任务通过。mock 模型、固定答案、直接调用领域 service、伪造 terminal result 或在 NextAgent 执行之外生成预期工作区结果 MUST NOT 构成框架效果评测证据。

**需求类别：功能性需求**

#### Scenario: 真实产品路径完成任务

- **WHEN** 一个状态为 `execute` 的 task 被评测
- **THEN** 系统通过当前 NextAgent local runtime 建立会话并提交该 task
- **AND** task 的最终工作区由该次 NextAgent 请求产生的行为形成
- **AND** HarnessBench 在该最终工作区和对应执行 trace 上评分

#### Scenario: 不支持任务以零分保留在整体结果

- **WHEN** 一个 task 在全量评测清单中的状态为 `unsupported`
- **THEN** 系统为该 task 记录非空不支持原因和 `taskScore=0`
- **AND** 该 task MUST 计入 `benchmarkTaskCount` 和 `frameworkEffectScore` 分母

#### Scenario: 替代路径不得计分

- **WHEN** task 使用 mock 模型、固定答案、直接领域 service 调用、伪造 terminal result 或 NextAgent 之外的结果生成代替目标链路
- **THEN** 系统 MUST 将本次全量运行标记为无效
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`

### Requirement: 计分运行验证真实模型调用

系统 MUST 在全量评测开始前验证真实模型 provider 与 credential 可用，并 MUST 让每个状态为 `execute` 的 task 的 NextAgent 模型请求经过 HarnessBench usage proxy。获得非零 `taskScore` 的 task MUST 从 proxy trace 取得至少一次成功上游模型请求和大于 0 的总 token 用量。模型凭据 MUST 来自受支持的安全引用，不得来自 task 输入或全量评测清单。全量运行的真实模型前置验证失败时，系统 MUST 在第一个 task 前终止且不得产生 `frameworkEffectScore`；单个 task 缺少真实模型证据时，该 task MUST 以 `model_evidence_missing` 和 `taskScore=0` 结束并计入全量分母。

**需求类别：功能性需求**

#### Scenario: 真实模型证据成立

- **WHEN** task 的 proxy trace 至少记录一次成功上游请求且总 token 用量大于 0
- **THEN** 系统将该 task 识别为具有真实模型证据
- **AND** 报告记录非敏感模型标识、请求数和 token 汇总

#### Scenario: 模型未调用或证据缺失

- **WHEN** task 没有成功上游模型请求、总 token 用量为 0 或 proxy trace 不可用
- **THEN** task 结果为 `model_evidence_missing`
- **AND** `taskScore=0`
- **AND** 系统继续生成包含该失败的完整评测报告

#### Scenario: 真实模型前置条件无效

- **WHEN** 真实模型 provider 不可达或 credential 校验失败
- **THEN** 系统 MUST 在第一个 task 执行前终止全量评测
- **AND** 本次运行 MUST NOT 产生 `frameworkEffectScore`

### Requirement: 计分运行验证 grader 前置条件

系统 MUST 从显式安全引用解析 HarnessBench grader 的 provider、credential 和 model id，并 MUST 在第一个计分 task 前验证 grader 鉴权和评分返回结构。候选模型与 grader 的配置和预检结果 MUST 分别形成非敏感结论；任一 grader 前置条件无效时，系统 MUST fail closed 且 MUST NOT 生成 `frameworkEffectScore`。

**需求类别：功能性需求**

#### Scenario: 候选模型与 grader 分别通过预检

- **GIVEN** 候选模型和 grader 使用显式 model id、provider 安全引用和 credential 安全引用
- **WHEN** 开始全量计分运行
- **THEN** 系统 MUST 分别验证候选模型响应和 grader 评分返回结构
- **AND** 两项预检成功后系统才开始第一个计分 task

#### Scenario: grader 鉴权或返回结构无效

- **WHEN** grader credential 被拒绝、provider 不可达或评分响应结构无效
- **THEN** 全量评测 MUST 在第一个计分 task 前失败
- **AND** 系统 MUST NOT 生成 `frameworkEffectScore`

### Requirement: 统一计算逐任务分数与框架效果得分

系统 MUST 使用固定 HarnessBench commit 自身生成的 `outcome_score`、`process_score`、`security_score` 和 `combined_score`，MUST NOT 在 NextAgent 侧重新解释或覆盖这些分量。状态为 `unsupported` 的 task，或因 Agent 错误、模型错误、超时、terminal failure、oracle 失败、过程评分失败、安全评分失败而没有合法 `combined_score` 的 task，系统 MUST 将其 `taskScore` 归一为 `0`。全部 task 形成终态结论后，系统 MUST 按下式计算并以四位小数输出框架效果得分：

```text
taskScore(task) = HarnessBench combined_score；不支持、失败、缺失或非法时为 0
frameworkEffectScore = round(sum(taskScore(task)) / benchmarkTaskCount, 4)
```

其中 `benchmarkTaskCount` MUST 等于固定 HarnessBench commit 的完整 task catalog 数量；默认 commit 的值为 106。系统 MUST NOT 因不支持或任何 task-level 失败而减少该分母。任一 task 尚未形成 `scored`、`unsupported`、`agent_failed`、`model_evidence_missing`、`timed_out` 或 `grading_failed` 终态结论时，系统 MUST NOT 产生 `frameworkEffectScore`。

**需求类别：功能性需求**

#### Scenario: 全量任务汇总框架效果得分

- **WHEN** 全量评测清单中的每个 task 均已形成终态结论
- **THEN** 系统为每个 task 保留可用的 HarnessBench 分量和归一后的 `taskScore`
- **AND** `frameworkEffectScore` 以 `benchmarkTaskCount` 为固定分母

#### Scenario: 不支持或执行失败不得抬高分数

- **WHEN** 一个 task 不受支持或因 Agent、模型、超时、terminal、oracle、过程评分或安全评分失败而没有合法 `combined_score`
- **THEN** 该 task 的 `taskScore` 为 `0`
- **AND** 该 task 仍计入 `frameworkEffectScore` 分母

#### Scenario: 全量任务未完成不得发布总分

- **WHEN** 任一 task 尚未形成终态结论
- **THEN** 系统只生成部分报告
- **AND** 部分报告 MUST NOT 包含 `frameworkEffectScore`

#### Scenario: 评分覆盖退化不得发布可比分数

- **WHEN** 完整运行中任一应执行 task 缺少可用的 HarnessBench rubric/process 评分
- **THEN** 报告 MUST 将 `evaluationValidity` 标记为 `degraded`
- **AND** 报告 MUST 给出评分覆盖计数和不参与正式对比的诊断分数
- **AND** 报告 MUST NOT 生成 `frameworkEffectScore`

### Requirement: 评测失败提供安全诊断

系统 MUST 为每个非成功 task 提供唯一的安全失败阶段和闭集原因码，并 MUST 区分候选准备、会话创建、请求提交、stream 等待、terminal、工作区导出、HarnessBench 进程和 grader 阶段。报告 MUST 记录模型请求和工作区产物是否已观测到，并 MUST 只使用 run-relative evidence ref。

**需求类别：系统质量属性**
**质量属性：审计/可追溯性**
**适用范围：该 Function**

#### Scenario: terminal 失败保留安全诊断

- **WHEN** NextAgent request 进入失败 terminal
- **THEN** task 仍 MUST 按零分进入固定分母
- **AND** 报告 MUST 记录 `failurePhase=terminal`、公开 stream 中已有的安全原因码或 `UNKNOWN`、模型请求证据和工作区产物观测结论

### Requirement: 评测基础设施失败有界恢复

系统 MAY 仅在失败阶段属于 HarnessBench 基础设施、模型请求数为零、没有工作区结果且没有上游结果时自动重试一次；其他失败 MUST NOT 自动重试。重试 MUST 记录非敏感 attempt ledger，且 MUST NOT 改变 task 的固定计分规则。

**需求类别：系统质量属性**
**质量属性：可靠性/恢复**
**适用范围：该 Function**

#### Scenario: 纯基础设施失败重试一次

- **WHEN** HarnessBench 基础设施在没有模型请求、工作区结果和上游结果时失败
- **THEN** 系统 MAY 自动重试该 task 一次
- **AND** attempt ledger MUST 记录两次尝试的阶段和安全原因码
- **AND** 第二次失败后系统 MUST 形成零分终态并继续后续 task

#### Scenario: 已有副作用证据的失败不重试

- **WHEN** 失败 task 已存在模型请求、工作区结果、上游结果或 NextAgent terminal 结论
- **THEN** 系统 MUST NOT 自动重试该 task

### Requirement: 定向回归运行不得计分

系统 MUST 提供用于 grader、terminal、sandbox 和评测基础设施诊断的固定定向回归 profile。定向 profile MUST 显式声明 `nonScoring`，MUST 仅引用全量 catalog 中的 task，并 MUST NOT 生成 `frameworkEffectScore`。

**需求类别：功能性需求**

#### Scenario: 执行定向回归 profile

- **WHEN** 开发者选择一个固定定向回归 profile
- **THEN** 系统 MUST 只执行该 profile 声明的 task
- **AND** JSON 与 Markdown 报告 MUST 标记 `nonScoring`
- **AND** 两份报告 MUST NOT 包含 `frameworkEffectScore`

### Requirement: 评测报告可追溯且可恢复

系统 MUST 为每次评测生成一个机器可读 JSON 报告和一个内容一致的 Markdown 摘要。完整报告 MUST 包含运行标识、开始与结束时间、HarnessBench commit、NextAgent commit、候选与 grader 的非敏感模型标识、全量评测清单、`benchmarkTaskCount`、各终态状态数量、评分覆盖、`evaluationValidity`、逐 task 状态、逐 task 评分分量、逐 task `taskScore`、逐 task 请求数与 token 汇总，以及相对路径或 opaque evidence ref。只有评分覆盖完整的有效计分运行 MUST 包含 `frameworkEffectScore`；评分覆盖退化时 MUST 改为诊断分数和不可比较原因。运行中断时，系统 MUST 原子写出截至中断点已知的 task 结果、未完成 task 状态和无法产生框架效果得分的原因。

**需求类别：系统质量属性**
**质量属性：审计/可追溯性**
**适用范围：该 Function**

#### Scenario: 成功运行生成双格式报告

- **WHEN** 全量评测清单中的全部 task 已形成终态结论、评分覆盖完整且报告字段完整
- **THEN** 系统生成内容一致的 JSON 报告和 Markdown 摘要
- **AND** 两份报告给出同一 `frameworkEffectScore`、状态汇总和逐 task 结论

#### Scenario: 中断后保留安全的部分证据

- **WHEN** 评测进程在全部 task 结束前收到中断或发生不可恢复的评测基础设施错误
- **THEN** 系统生成部分报告并将未完成 task 标记为 `not_completed`
- **AND** 部分报告说明中断阶段且不包含受禁止内容
- **AND** 部分报告 MUST NOT 包含 `frameworkEffectScore`

### Requirement: 评测报告不泄露敏感信息

系统 MUST NOT 在 JSON 报告或 Markdown 摘要中写入 credential、认证 token、完整 prompt、完整模型输出、task 文件内容或主机绝对路径。待发布内容命中任一禁止项时，系统 MUST 拒绝发布两种格式的最终报告，并 MUST 让评测返回失败。

**需求类别：系统质量属性**
**质量属性：安全**
**适用范围：该 Function**

#### Scenario: 敏感报告被拒绝

- **WHEN** 待写入报告的任一字段包含 credential、认证 token、完整 prompt、完整模型输出、task 文件内容或主机绝对路径
- **THEN** 系统 MUST 拒绝发布该报告
- **AND** 评测返回失败

## Function 变更汇总

### 描述

- 变更类型：新增
- 目标内容：系统从单一测试入口运行固定 HarnessBench 基线的全部 task，以分别通过预检的候选模型和 grader 评测 NextAgent 框架能力，并输出评分覆盖可证明、失败可诊断且可追溯的框架效果得分；定向回归只输出非计分结果。
- 依据 Requirements：`评测运行固定版本与任务边界`、`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证真实模型调用`、`计分运行验证 grader 前置条件`、`统一计算逐任务分数与框架效果得分`、`评测失败提供安全诊断`、`评测基础设施失败有界恢复`、`定向回归运行不得计分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`

### 前置条件

- 变更类型：新增
- 目标内容：HarnessBench commit、完整 task catalog、NextAgent 构建、候选模型与 grader 的 provider/model/credential 安全引用和评测运行环境已就绪。
- 依据 Requirements：`评测运行固定版本与任务边界`、`计分运行验证真实模型调用`、`计分运行验证 grader 前置条件`

### 输入

- 变更类型：新增
- 目标内容：固定 HarnessBench commit、候选模型与 grader 标识及安全引用、运行预算；计分范围固定为完整 catalog，定向运行范围固定为版本控制内的非计分 profile。
- 依据 Requirements：`评测运行固定版本与任务边界`、`计分运行验证真实模型调用`、`计分运行验证 grader 前置条件`、`定向回归运行不得计分`

### 输出

- 变更类型：新增
- 目标内容：全部 task 的状态、评分覆盖、安全失败诊断与评分，机器可读 JSON 报告和 Markdown 摘要；仅评分有效的全量运行输出框架效果得分，退化、无效、定向或未完成运行输出诊断证据和无正式得分原因。
- 依据 Requirements：`统一计算逐任务分数与框架效果得分`、`评测失败提供安全诊断`、`评测基础设施失败有界恢复`、`定向回归运行不得计分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`

### 处理过程

- 变更类型：新增
- 目标内容：系统固定评测清单，分别校验候选模型与 grader，通过真实 NextAgent 产品边界执行受支持 task，为不支持和失败 task 记零分，验证模型用量与评分覆盖，对纯基础设施失败执行至多一次受约束恢复，并汇总安全报告。
- 依据 Requirements：`评测运行固定版本与任务边界`、`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证真实模型调用`、`计分运行验证 grader 前置条件`、`统一计算逐任务分数与框架效果得分`、`评测失败提供安全诊断`、`评测基础设施失败有界恢复`、`定向回归运行不得计分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`

### 结果

- 变更类型：新增
- 目标内容：全部 task 形成终态且评分覆盖完整后发布框架效果得分和完整报告；非法基线、替代执行路径、模型或 grader 前置失败、评分退化、定向运行、任务未全部结束或报告泄密时不发布正式总分；不支持和 task-level 失败以零分计入诊断汇总，运行中断保留安全的部分报告。
- 依据 Requirements：`评测运行固定版本与任务边界`、`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证 grader 前置条件`、`统一计算逐任务分数与框架效果得分`、`评测失败提供安全诊断`、`评测基础设施失败有界恢复`、`定向回归运行不得计分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`

### 规格

- 规格项：计分模式
  - 变更类型：新增
  - 原规格值：不适用（新增）
  - 目标规格值：仅完整 HarnessBench task catalog、真实 NextAgent local runtime、候选模型与 grader 前置验证通过且 rubric/process 评分覆盖完整的运行可产生框架效果得分；定向 profile 永不计分
  - 依据 Requirements：`评测运行固定版本与任务边界`、`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证真实模型调用`、`计分运行验证 grader 前置条件`、`定向回归运行不得计分`
- 规格项：评测范围
  - 变更类型：新增
  - 原规格值：不适用（新增）
  - 目标规格值：固定 HarnessBench commit 的完整 task catalog；默认 commit 为 106 个 task
  - 依据 Requirements：`评测运行固定版本与任务边界`
- 规格项：框架效果得分
  - 变更类型：新增
  - 原规格值：不适用（新增）
  - 目标规格值：全部 task 的 `taskScore` 算术平均值，不支持和失败 task 为 0，范围 0–1，四位小数
  - 依据 Requirements：`统一计算逐任务分数与框架效果得分`
- 规格项：报告格式
  - 变更类型：新增
  - 原规格值：不适用（新增）
  - 目标规格值：机器可读 JSON 报告与内容一致的 Markdown 摘要
  - 依据 Requirements：`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`

### 接口

- 变更类型：新增
- 目标内容：按需 HarnessBench 评测命令；不新增产品公共 API。
- 依据 Requirements：`评测运行固定版本与任务边界`、`定向回归运行不得计分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`

### 覆盖特性

- 变更类型：新增
- 目标内容：`F-10.13 HarnessBench 能力评测`
- 依据 Requirements：`评测运行固定版本与任务边界`、`统一计算逐任务分数与框架效果得分`

### 主规格

- 变更类型：新增
- 目标内容：`harnessbench-evaluation`
- 依据 Requirements：`评测运行固定版本与任务边界`、`全量任务通过真实 NextAgent 产品边界评测`、`计分运行验证真实模型调用`、`计分运行验证 grader 前置条件`、`统一计算逐任务分数与框架效果得分`、`评测失败提供安全诊断`、`评测基础设施失败有界恢复`、`定向回归运行不得计分`、`评测报告可追溯且可恢复`、`评测报告不泄露敏感信息`
