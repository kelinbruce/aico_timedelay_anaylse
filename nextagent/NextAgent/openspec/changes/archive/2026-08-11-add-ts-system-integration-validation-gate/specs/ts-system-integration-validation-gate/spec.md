## Function

- **所属 Function**：`FN-10.31 验证系统集成`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: TestClaw 系统集成清单具有完整且唯一的 activated 范围

TestClaw 系统集成门禁 MUST 接收受版本控制的 activated 用例清单。清单 MUST 恰好包含 `TC-SI-001` 至 `TC-SI-122`，不得缺号、重号或增加该范围外的 activated case；每个条目 MUST 具有唯一 `caseId`、`title`、`layer`、`originKind`、`sourceCaseRef`、`ownerGate`、至少一个 `featureRefs` 条目、至少一个 `functionRefs` 条目、至少一个 `requirementRefs` 条目、唯一 `executionRef` 和必需输入声明。

`layer` MUST 为 `INTEGRATION` 或 `E2E`。`originKind` MUST 为 `FIXED_GATE`、`BACKEND_E2E`、`BROWSER_E2E`、`NEW_INTEGRATION` 或 `NEW_E2E`。planned/excluded 范围 MUST 存入独立 deferred coverage 清单，MUST NOT 使用 `TC-SI-001` 至 `TC-SI-122` 的 case id，且 MUST NOT 进入 activated 计数。

**需求类别**：功能性需求

#### Scenario: 完整清单被接受
- **WHEN** 清单恰好包含连续的 `TC-SI-001` 至 `TC-SI-122`，且所有必需字段、引用和执行入口有效
- **THEN** 门禁 MUST 接受该 activated 清单
- **AND** MUST 在执行阶段调度全部 122 个用例

#### Scenario: 清单缺失、重复或越界
- **WHEN** 任一 case id 缺失、重复、超出 `TC-SI-001` 至 `TC-SI-122`，或两个条目共享同一 `executionRef`
- **THEN** 门禁 MUST 在启动候选进程前失败
- **AND** 报告 MUST 只标识违规 case id 和安全失败原因

### Requirement: TestClaw 验证不依赖源码测试结果

每个 activated 用例 MUST 从 TestClaw 自有执行入口运行。候选行为只能通过候选运行包公共入口、外部 packages public exports 以及场景要求的真实 HTTP、SSE、WebSocket、进程、浏览器或文件系统边界访问。TestClaw MUST NOT 导入仓库源码、private path 或 `@nextagent/*/testing`，MUST NOT 读取源码测试报告作为用例结果，MUST NOT 以 source assertion、mock route、fake stream、skipped 或 todo 结果计为通过。

确定性模型输入可以作为可重复 fixture，但 MUST NOT 替代当前用例声明验证的产品边界。独立执行缺少候选运行包或外部 package artifact 时，对应 activated 用例 MUST 为 `UNAVAILABLE`，MUST NOT 被跳过。

**需求类别**：功能性需求

#### Scenario: TestClaw 独立执行候选行为
- **WHEN** TestClaw 只获得候选运行包根、外部 packages 根和自身 fixture
- **THEN** 全部 activated 用例 MUST 能从 TestClaw 自有入口执行
- **AND** 每个结果 MUST 来自本次候选包或外部 package artifact 的实际行为

#### Scenario: 源码结果被用于判定
- **WHEN** 任一用例尝试读取源码测试报告、导入源码私有实现或以 skipped/todo 结果满足执行
- **THEN** 对应用例和总门禁 MUST 为 `FAILED`

#### Scenario: 必需 artifact 缺失
- **WHEN** 某个 activated 用例声明的候选运行包或外部 package artifact 不存在
- **THEN** 对应用例 MUST 为 `UNAVAILABLE`
- **AND** 总门禁 MUST 返回非通过

### Requirement: 现有场景逐条同步到 TestClaw

TestClaw MUST 以一对一、不可重复的映射同步全部现有覆盖：

| TestClaw 范围 | 数量 | 来源 |
|---|---:|---|
| `TC-SI-001` 至 `TC-SI-041` | 41 | 固定 Alpha、product-journey、security、resilience、release-package、P1/P2 gate cases |
| `TC-SI-042` 至 `TC-SI-090` | 49 | 独立 backend E2E 场景 |
| `TC-SI-091` 至 `TC-SI-111`、`TC-SI-120` 至 `TC-SI-122` | 24 | browser E2E 场景 |

每个来源场景 MUST 映射到恰好一个 TestClaw `caseId` 和一个唯一 `executionRef`；每个上述 TestClaw `caseId` MUST 反向映射到恰好一个来源场景。每个 `caseId` MUST 在本 Function 的 TestClaw suite 中具有独立单 case 执行文件；这些文件可以复用 TestClaw helper，但 MUST NOT 复用其他 TestClaw 用例的 `executionRef`、结果或 evidence。源码测试继续由原 owner 维护，但其结果 MUST NOT 参与本门禁 verdict。

**需求类别**：功能性需求

#### Scenario: 114 个来源场景完整同步
- **WHEN** 同步校验对照 41 个固定 gate、49 个 backend E2E 和 24 个 browser E2E 的来源清单
- **THEN** MUST 得到 114 条一对一映射
- **AND** TestClaw 独立执行 MUST 为每条映射产生本次结果和 evidence ref

#### Scenario: 来源场景发生漂移
- **WHEN** source checkout 中来源测试增删、重命名、参数化展开边界变化，或映射出现零个或多个 TestClaw 目标
- **THEN** 同步校验 MUST 失败
- **AND** MUST NOT 静默继续声明 114 个场景覆盖完整

### Requirement: 三个新增系统集成用例覆盖外部真实边界

当前门禁 MUST 执行下列全部 `INTEGRATION` 用例：

| caseId | 系统可观察目标 |
|---|---|
| `TC-SI-112` | 外部 ESM TypeScript consumer 只通过已声明 public exports 解析并组合 remote deployment 与 remote gateway packages；缺失导出、private path 依赖或声明文件不一致会失败 |
| `TC-SI-113` | remote gateway packages 对真实 loopback sandbox、RAG、Workflow RAG 和问题推荐服务执行请求/响应 schema validation、trusted scope/correlation 传播、`inputText` 与 `inputVariables` 分离、cancellation 和 safe failure mapping |
| `TC-SI-114` | SkillHub 通过真实 HTTP 与文件系统完成候选查询、下载前 hash 校验、archive/folder 规范化、staged folder 校验和受控提交；非法 entry、hash 不匹配、取消、错误响应或失败替换不会发布半成品，也不会破坏先前已提交 Skill |

**需求类别**：功能性需求

#### Scenario: 三个系统集成用例全部执行
- **WHEN** 外部 packages 根包含清单要求的 package artifacts
- **THEN** `TC-SI-112`、`TC-SI-113` 和 `TC-SI-114` MUST 分别执行
- **AND** 系统集成层 MUST 只在三个结果均为 `PASSED` 时通过

#### Scenario: 外部真实边界失败
- **WHEN** 任一 public export、loopback 协议、schema、取消或安全文件落盘断言失败
- **THEN** 对应用例 MUST 返回非通过结果
- **AND** 其他用例结果 MUST 保持独立

### Requirement: 五个新增 E2E 流程覆盖跨边界产品路径

当前门禁 MUST 执行下列新增 `E2E` 用例：

| caseId | 系统可观察目标 |
|---|---|
| `TC-SI-115` | remote deployment 通过真实 HTTP/SSE 完成 session 创建、请求接受、远端模型输出、唯一 terminal 和 history 一致性 |
| `TC-SI-116` | 电信诊断请求通过真实远端 RAG 与 sandbox 执行链路完成受治理工具调用，并在 terminal、history、audit 和安全诊断中形成一致结果 |
| `TC-SI-117` | 远端 SkillHub 候选经下载、校验、安装和 catalog 可见性后，以已验证 source metadata 和 localized display-name fallback 对调用方可见，并被后续真实请求按 Skill disclosure、资源投影和 Tool 治理规则发现并执行 |
| `TC-SI-118` | 远端依赖返回非法响应、失败、超时或被取消时，请求形成唯一安全终态，取消传播、stream 与 history/replay 一致，且不泄漏远端原始错误、trusted scope 或敏感 canary |
| `TC-SI-119` | local、immersive、collaborative 三种宿主连接同一真实后端时，共享 session、submit、stream、pending input、active-run replay 和 refresh 恢复语义，宿主差异不产生第二套业务事实 |

`TC-SI-001` 至 `TC-SI-111`、`TC-SI-115` 至 `TC-SI-122` MUST 全部计入 `E2E` 层，共 119 个 activated E2E 用例。

由于正式 `@nextagent/agent-web` artifact 只发布 immersive 页面和 collaborative PIU，`TC-SI-094` 与 `TC-SI-119` 的 local 宿主 MUST 从 external packages root 中版本匹配的 `@nextagent/agent-web-test-hosts` public hosting export 加载闭合 browser bundle。该验证 artifact MUST NOT 进入正式候选前端 artifact；缺失时对应 case MUST 为 `UNAVAILABLE`，MUST NOT 回退源码或 Vite dev server。

**需求类别**：功能性需求

#### Scenario: 新增五个 E2E 流程全部通过
- **WHEN** `TC-SI-115` 至 `TC-SI-119` 均通过真实产品边界执行
- **THEN** 每个用例 MUST 产生独立结果和 evidence ref

#### Scenario: 任一真实 E2E 边界无法建立
- **WHEN** 必需产品进程、transport、持久化、外部服务或浏览器不能可靠启动或确认
- **THEN** 对应用例 MUST 为 `UNAVAILABLE` 或 `FAILED`
- **AND** MUST NOT 把该结果解释为通过

### Requirement: Deferred coverage 保持可见但不冒充通过

真实 AICO Service consumer、尚未闭合的发布级联合流程以及缺少完整 executable artifact 的候选范围 MUST 记录为 `PLANNED`。稳定 `ts-performance-test-gate` 的时延与 TTFT 目标 MUST 继续由独立 performance gate 验证，并在本 Function 的 deferred coverage 中记录为独立 owner 的 `EXCLUDED` 范围；本门禁 MUST NOT 把该 gate 的结果复制为 `TC-SI-*` 结果，也 MUST NOT 把性能阈值解释为本 Function 的 122 用例验收。尚无稳定系统级黑盒契约的容量上限、集群部署和 remote Agent/AgentLink MUST 分别记录为 `EXCLUDED`。每个 deferred entry MUST 具有安全原因、owner 和重新准入条件；它们 MUST NOT 获得 `TC-SI-001` 至 `TC-SI-122` 的 case id，MUST NOT 出现在 executed results，且 MUST NOT 改变当前门禁 verdict。

**需求类别**：功能性需求

#### Scenario: AICO consumer artifact 缺失
- **WHEN** 当前输入不包含 AICO Service 可执行 artifact
- **THEN** AICO consumer 范围 MUST 保持 `PLANNED`
- **AND** provider-side public surface 证据 MUST NOT 被标记为真实 consumer E2E

#### Scenario: 独立性能门禁不重复计入系统集成结果
- **WHEN** 候选版本具有 `ts-performance-test-gate` 的独立执行结果
- **THEN** 本门禁 MUST 将其保持为独立 owner 的 `EXCLUDED` coverage
- **AND** MUST NOT 复制该结果或为其分配 `TC-SI-*` case id

#### Scenario: 无规格目标不参与门禁
- **WHEN** 候选范围依赖尚未定义稳定系统级黑盒行为的容量、集群或 AgentLink 目标
- **THEN** 对应范围 MUST 保持 `EXCLUDED`
- **AND** MUST NOT 进入 122 个 activated 用例计数

### Requirement: TestClaw 门禁命令和报告结论唯一确定

执行 `npm --prefix tests/TESTClaw run test:system-integration` 时，TestClaw MUST 校验清单并执行全部 122 个 activated 用例，在 `tests/TESTClaw/test-output/system-integration/<runId>/report.json` 生成 machine-readable report。报告顶层 MUST 恰好包含 `schemaVersion=1`、`checkId=system-integration`、非空安全 `runId`、总 `status`、恰好包含 `INTEGRATION` 和 `E2E` 的 `layers`，以及包含全部 122 个用例结果的 `cases`。`layers` MUST 为 `{INTEGRATION: result, E2E: result}`，两个值均使用与总 `status` 相同的结果枚举，不得包含其他嵌套字段。

每个结果 MUST 恰好包含 `caseId`、`layer`、`originKind`、`sourceCaseRef`、`ownerGate`、`result`、`failurePhase` 和 `evidenceRefs`。`result` MUST 为 `PASSED`、`FAILED`、`TIMEOUT`、`UNAVAILABLE` 或 `MISSING`；`failurePhase` 在 `PASSED` 时 MUST 为 `null`，在其他结果时 MUST 为非空安全标识；`evidenceRefs` MUST 为至少一项的安全引用数组。报告顶层、`layers` 和用例结果 MUST NOT 包含未声明字段。

仅当 3 个 `INTEGRATION` 和 119 个 `E2E` 用例全部为 `PASSED` 时，总 `status` 才能为 `PASSED`。多个非通过结果的层级和总状态 MUST 按 `FAILED > TIMEOUT > UNAVAILABLE > MISSING > PASSED` 选择，并使命令返回非零退出码。

**需求类别**：系统质量属性

**质量属性**：可测试性

**适用范围**：该 Function

#### Scenario: 122 个 activated 用例全部通过
- **WHEN** 标准命令完成且 122 个用例均返回 `PASSED`
- **THEN** report 总 `status` MUST 为 `PASSED`
- **AND** 命令 MUST 返回零退出码

#### Scenario: 任一 activated 用例缺失或非通过
- **WHEN** 任一 activated 用例没有结果或返回非通过状态
- **THEN** report 总 `status` MUST 为确定的非通过状态
- **AND** 命令 MUST 返回非零退出码

### Requirement: 系统集成证据不泄漏敏感内容

TestClaw 导出的门禁报告、TestClaw 自身面向调用方的 stdout/stderr 和 evidence artifact MUST NOT 包含 raw credential、prompt、完整模型输出、附件正文、Skill 包正文、未脱敏主机绝对路径、provider secret、raw remote exception、adapter-private DTO 或敏感 canary。

当安全扫描发现任一禁止内容时，对应用例和总门禁 MUST 为 `FAILED`；最终报告只能保留 `caseId`、`failurePhase`、安全原因、hash 或 opaque evidence ref。

候选进程按 canonical `runtime-logging` 产生的本地 operational diagnostic MUST 位于本次运行独立的 restricted diagnostic root，MUST NOT 被复制到 TestClaw stdout/stderr、evidence artifact、`evidenceRefs` 或最终报告。TestClaw MAY 在该 root 内原位验证候选日志契约，但 MUST 只导出通过/失败、安全 reason code、hash 或 opaque ref，并 MUST 在本次运行 cleanup 时删除 restricted diagnostic root。候选本地诊断中由稳定日志契约明确允许的 Tool payload、Model payload、path 或受控 execution exception 内容，仅因存在于 restricted diagnostic root MUST NOT 使本门禁失败；这些内容一旦进入 TestClaw 导出边界则 MUST 使对应用例和总门禁失败。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: Evidence 命中禁止内容
- **WHEN** 报告、stdout、stderr 或 evidence artifact 命中任一禁止内容
- **THEN** 对应用例和总门禁 MUST 为 `FAILED`
- **AND** 原始禁止内容 MUST NOT 被复制到最终报告

#### Scenario: 候选本地诊断保持受限且不进入 evidence
- **WHEN** 候选进程在 restricted diagnostic root 中产生稳定日志契约允许的本地 Tool 或 execution exception 诊断
- **THEN** TestClaw MUST NOT 将原始诊断复制到 stdout、stderr、evidence artifact、`evidenceRefs` 或最终报告
- **AND** TestClaw MUST 只导出安全判定或 opaque ref
- **AND** cleanup MUST 删除 restricted diagnostic root

### Requirement: 系统集成结果支持端到端追踪

每个 activated 用例 MUST 至少产生一个 output root 相对路径或 opaque evidence ref。门禁 MUST 能从 `sourceCaseRef` 追踪到唯一 `caseId`、Feature、Function、Requirement、`executionRef`、本次结果和 evidence refs，并能从任一 `caseId` 反向定位相同链路。新增用例没有源码测试来源时，`sourceCaseRef` MUST 指向本 change 的 Requirement 和 Scenario，而不得为空。

**需求类别**：系统质量属性

**质量属性**：审计/可追溯性

**适用范围**：该 Function

#### Scenario: 同步用例双向追踪
- **WHEN** 任一 `TC-SI-001` 至 `TC-SI-111` 或 `TC-SI-120` 至 `TC-SI-122` 完成
- **THEN** 报告 MUST 能定位其唯一来源场景和 TestClaw 执行入口
- **AND** 来源场景映射 MUST 能反向定位本次结果和 evidence refs

#### Scenario: 追踪或证据缺失
- **WHEN** activated 用例缺少任一必需追踪字段、唯一执行结果或 evidence ref
- **THEN** 对应用例和总门禁 MUST 为 `FAILED`

### Requirement: 重复执行不依赖残留外部状态

TestClaw MUST 为每次执行创建隔离的监听端口、临时持久化根、Skill 安装根、浏览器状态、restricted diagnostic root 和 evidence output root。门禁在成功或失败后 MUST 停止其启动的进程和监听服务并删除 restricted diagnostic root；下一次执行 MUST NOT 读取上一次执行的结果或诊断作为当前通过证据，也 MUST NOT 修改输入候选包或外部 package artifacts。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复

**适用范围**：该 Function

#### Scenario: 连续两次执行互不污染
- **WHEN** 使用相同输入连续执行两次标准命令
- **THEN** 两次执行 MUST 使用不同隔离运行根
- **AND** 第二次结果 MUST 只由第二次执行产生的事实决定

#### Scenario: 用例失败后清理
- **WHEN** 任一 activated 用例在外部服务、产品进程或浏览器阶段失败
- **THEN** 门禁 MUST 停止本次启动的进程和监听服务
- **AND** MUST 保留不含禁止内容的失败 evidence

## Function 变更汇总

### 描述

- **变更类型**：新增
- **目标内容**：TestClaw 独立执行完整的 122 个系统集成与 E2E 用例，并形成统一、安全、可追踪的候选包验证结论。
- **依据 Requirements**：`TestClaw 系统集成清单具有完整且唯一的 activated 范围`、`TestClaw 验证不依赖源码测试结果`、`现有场景逐条同步到 TestClaw`、`三个新增系统集成用例覆盖外部真实边界`、`五个新增 E2E 流程覆盖跨边界产品路径`、`Deferred coverage 保持可见但不冒充通过`

### 前置条件

- **变更类型**：新增
- **目标内容**：提供候选运行包根、外部 packages 根、TestClaw 自有 fixtures 以及场景要求的本机浏览器能力；输入缺失形成显式非通过结果。
- **依据 Requirements**：`TestClaw 验证不依赖源码测试结果`、`三个新增系统集成用例覆盖外部真实边界`

### 输入

- **变更类型**：新增
- **目标内容**：受版本控制的 122 用例清单、候选运行包、外部 package artifacts 和隔离执行配置。
- **依据 Requirements**：`TestClaw 系统集成清单具有完整且唯一的 activated 范围`、`TestClaw 验证不依赖源码测试结果`

### 输出

- **变更类型**：新增
- **目标内容**：包含总结果、分层结果、122 个逐用例结果、双向追踪和安全 evidence refs 的 machine-readable report。
- **依据 Requirements**：`TestClaw 门禁命令和报告结论唯一确定`、`系统集成证据不泄漏敏感内容`、`系统集成结果支持端到端追踪`

### 处理过程

- **变更类型**：新增
- **目标内容**：TestClaw 校验清单与输入，独立调度 3 个系统集成和 119 个 E2E 用例，扫描 evidence 安全性并按固定优先级生成唯一 verdict。
- **依据 Requirements**：`TestClaw 系统集成清单具有完整且唯一的 activated 范围`、`现有场景逐条同步到 TestClaw`、`三个新增系统集成用例覆盖外部真实边界`、`五个新增 E2E 流程覆盖跨边界产品路径`、`TestClaw 门禁命令和报告结论唯一确定`

### 结果

- **变更类型**：新增
- **目标内容**：122 个 activated 用例全部通过且 evidence 安全时通过；任一用例缺失、不可用、超时、失败、追踪非法或 evidence 泄漏时非通过。
- **依据 Requirements**：`TestClaw 门禁命令和报告结论唯一确定`、`系统集成证据不泄漏敏感内容`、`系统集成结果支持端到端追踪`

### 量化指标

- **指标名称**：activated 系统集成用例数
- **变更类型**：新增
- **原值或原口径**：0；TestClaw 当前没有本 Function 清单
- **目标值或目标口径**：3
- **单位与测量边界**：个；统计 `TC-SI-112` 至 `TC-SI-114`
- **依据 Requirements**：`三个新增系统集成用例覆盖外部真实边界`

- **指标名称**：activated E2E 流程用例数
- **变更类型**：新增
- **原值或原口径**：0；现有 114 个来源场景未组成 TestClaw 本 Function 的独立清单
- **目标值或目标口径**：119
- **单位与测量边界**：个；统计 `TC-SI-001` 至 `TC-SI-111` 和 `TC-SI-115` 至 `TC-SI-122`
- **依据 Requirements**：`现有场景逐条同步到 TestClaw`、`五个新增 E2E 流程覆盖跨边界产品路径`

- **指标名称**：activated 用例总数
- **变更类型**：新增
- **原值或原口径**：0；TestClaw 当前没有本 Function 清单
- **目标值或目标口径**：122
- **单位与测量边界**：个；统计连续 `TC-SI-001` 至 `TC-SI-122`
- **依据 Requirements**：`TestClaw 系统集成清单具有完整且唯一的 activated 范围`

### 接口

- **变更类型**：新增
- **目标内容**：标准验证命令为 `npm --prefix tests/TESTClaw run test:system-integration`；报告 `checkId` 为 `system-integration`。
- **依据 Requirements**：`TestClaw 门禁命令和报告结论唯一确定`

### 覆盖特性

- **变更类型**：修改
- **目标内容**：`F-10.8 验证门禁` 增加由 `FN-10.31 验证系统集成` 提供的 TestClaw 独立系统集成验证。
- **依据 Requirements**：`TestClaw 系统集成清单具有完整且唯一的 activated 范围`、`TestClaw 门禁命令和报告结论唯一确定`

### 主规格

- **变更类型**：新增
- **目标内容**：`ts-system-integration-validation-gate`
- **依据 Requirements**：`TestClaw 系统集成清单具有完整且唯一的 activated 范围`、`TestClaw 验证不依赖源码测试结果`、`现有场景逐条同步到 TestClaw`、`三个新增系统集成用例覆盖外部真实边界`、`五个新增 E2E 流程覆盖跨边界产品路径`、`Deferred coverage 保持可见但不冒充通过`、`TestClaw 门禁命令和报告结论唯一确定`、`系统集成证据不泄漏敏感内容`、`系统集成结果支持端到端追踪`、`重复执行不依赖残留外部状态`
