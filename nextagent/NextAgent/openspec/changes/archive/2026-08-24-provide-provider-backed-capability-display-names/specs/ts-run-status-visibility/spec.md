## Function

- **所属 Function**：`FN-2.4 查看请求状态`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Capability 过程标题必须使用最小公开身份生成

系统 MUST 为普通 Agent Web 中每个用户可见 Capability 步骤显示非空标题和独立状态。标题 MUST 只使用 lifecycle 公开的 `capabilityKind + capabilityId`、optional `targetCapabilityId`、当前已验证的 Capability presentation resources 和平台固定动作模板生成；系统 MUST NOT 从调用参数、结果正文、模型输出、description、metadata、Provider 配置或浏览器非受信状态猜测名称。

**需求类别**：功能性需求

Agent Web MUST 对一个 `CapabilityPresentationResource` 按以下确定顺序选择名称：

1. `locales.language` 精确包含当前 UI locale 时，使用该 entry 的合法 `displayName`；
2. 第一步未命中且 `locales.language['en-US']` 存在时，使用其合法 `displayName`；
3. 前两步未命中时，使用合法 stable `displayName`；
4. resource 缺失时，使用合法 public `capabilityId`。

Resolver MUST NOT 执行语言前缀匹配、`zh`/`en` 猜测、任意其他语言 fallback 或 description fallback。Resource name、fallback id 和动作模板参数 MUST 作为纯文本 React child 渲染，MUST NOT 解析为 HTML、Markdown、URL 或可执行内容。

普通 Tool MUST 直接使用 `TOOL + capabilityId` 对应 resource 的选定名称。直接 Agent、Skill、Workflow MUST 分别使用平台固定动作模板包装 `AGENT`、`SKILL`、`WORKFLOW` resource 的选定名称。`Agent`、`Skill`、`Workflow` wrapper MUST 根据执行入口推导目标 kind：`Agent → AGENT`、`Skill → SKILL`、`Workflow → WORKFLOW`。合法 `targetCapabilityId` 存在时，标题 MUST 使用目标 resource 名称或目标 id；目标 identity 缺失或非法时，标题 MUST 使用平台固定中性动作。系统 MUST NOT 增加 `targetCapabilityKind`。

状态 MUST 继续由既有 lifecycle phase 与安全失败事实确定，并以单个 ` · ` 与标题连接。执行中、已完成、失败、超时和已取消状态 MUST 使用当前 UI locale 的平台静态 i18n 文案；未知内部枚举 MUST NOT 原样显示。固定动作模板、状态、错误和详情标签属于 Agent Web i18n 资源，MUST NOT 从 Capability presentation resource query 取得。

`AskUserQuestion` 的问题、选项、回答和等待输入 MUST 继续由专用交互呈现。`ApiCall` 的规范路径 MUST NOT 新增普通结果卡。Capability name adaptation MUST NOT 增加、删除、重排或重新分层过程条目，MUST NOT 改变 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 或最终答案。

#### Scenario: Builtin Read 使用 Provider 中文名称

- **GIVEN** `Read` 步骤公开 `capabilityKind=TOOL` 和 `capabilityId=Read`
- **AND** 当前 resource 包含 `zh-CN.displayName=读取文件`、`en-US.displayName=Read file`
- **WHEN** 用户在 `zh-CN` 界面查看正在执行步骤
- **THEN** 标题 MUST 显示“读取文件 · 执行中”
- **AND** 标题 MUST NOT 同时拼接 `Read` 或重复状态

#### Scenario: 扩展 Tool 未配置当前语言时回退英文

- **GIVEN** 扩展 Tool `lookup-alarm` 的 resource 只包含 `en-US.displayName=Look up alarms`
- **WHEN** 用户在 `zh-CN` 界面查看该步骤
- **THEN** 标题 MUST 使用“Look up alarms”和中文状态
- **AND** resolver MUST NOT 伪造中文名称

#### Scenario: Resource 没有 locales 时使用 stable displayName

- **GIVEN** 一个 Capability resource 不包含 `locales`
- **WHEN** resource 具有合法 stable `displayName`
- **THEN** 标题 MUST 使用 stable `displayName`
- **AND** Agent Web MUST NOT 把缺少 `locales` 解释为 resource missing

#### Scenario: Resource 缺失时回退 capabilityId

- **GIVEN** 当前 projection 不包含一个合法 Capability identity
- **WHEN** Agent Web 为该过程生成标题
- **THEN** 标题 MUST 使用合法 `capabilityId`
- **AND** 系统 MUST NOT 从其他 Capability、结果或 description 猜测名称

#### Scenario: Skill wrapper 使用目标 Skill resource

- **GIVEN** lifecycle 公开 `capabilityId=Skill` 和 `targetCapabilityId=network-diagnosis`
- **AND** `SKILL + network-diagnosis` 的 `zh-CN` 名称为“网络诊断”
- **WHEN** 用户查看已完成步骤
- **THEN** 标题 MUST 显示“加载技能：网络诊断 · 已完成”
- **AND** 标题 MUST NOT 使用 wrapper Tool resource 替代目标 Skill resource

#### Scenario: wrapper 目标缺失时显示中性动作

- **GIVEN** lifecycle 公开 `capabilityId=Workflow`
- **AND** `targetCapabilityId` 缺失或不合法
- **WHEN** 用户查看该步骤
- **THEN** 标题 MUST 显示当前语言的 Workflow 中性动作和既有状态
- **AND** 系统 MUST NOT 从结果、description 或其他步骤补充目标名称

#### Scenario: 名称按纯文本渲染

- **GIVEN** 合法名称文本包含 `<img onerror=...>`、Markdown 标记或 URL-like 字符串
- **WHEN** Agent Web 渲染 Capability 标题
- **THEN** 标题 text content MUST 逐字包含该名称
- **AND** 名称 MUST NOT 创建元素、链接、图片、脚本或 Markdown 节点

#### Scenario: 结果披露保持不变

- **GIVEN** 一个 Capability 使用既有专用交互或结果披露策略
- **WHEN** 系统应用 Provider 名称
- **THEN** 专用交互、过程结构、摘要和详情字段 MUST 保持既有行为
- **AND** 名称适配 MUST NOT 提高任何结果披露级别

### Requirement: Agent Web 必须集中维护 Capability 业务名称映射

Agent Web MUST 按 Session 使用一个共享 presentation resource store 和一个共享纯函数 resolver 管理 Capability identity 到当前显示名称的映射。local、immersive、collaborative 三种宿主、live process 和 history process MUST 使用同一 store、resolver、fallback 顺序和固定动作模板；任一宿主 MUST NOT 建立并行名称配置或宿主专属 resolver。

**需求类别**：功能性需求

Agent Web MUST 在 Session 创建成功或 Session 激活后，对 `GET /api/v1/sessions/:sessionId/capability-presentation-resources` 发起异步完整查询，并 MUST 与 conversation/history 加载并行。展示资源查询 MUST NOT 阻塞用户提交、event ingestion、history、stream 或最终答案。切换 UI locale MUST 只依据当前 Session projection 同步重新计算 live 和 history 标题，MUST NOT 发起 locale-specific query，MUST NOT 修改 history event，MUST NOT 要求重新执行 Capability。

Agent Web MUST 在以下条件之一成立时为对应 Session 调度完整刷新：

1. 一个新接受的 live `CAPABILITY_COMPLETED` 表示 `capabilityId=acquire_skill` 且 `status=SUCCEEDED`；
2. live、history 或延迟加载的 process history 首次出现既不在当前 resource projection、也未被当前完整成功 projection 确认为 missing 的合法 Capability identity 或 wrapper target identity。

同一 accepted acquisition completion 的 replay MUST NOT 重复触发刷新。每个 Session 同时 MUST 至多存在一个 in-flight query；刷新期间再次出现触发时，Agent Web MUST 记录 pending invalidation，并 MUST 在当前请求完成后至多追加一次 trailing refresh。系统 MUST NOT 按过程条目、Tool call 或 render 独立查询。

完整查询成功时，store MUST 原子替换该 Session 的 current projection。已观察 identity 出现在结果中时 MUST 视为 resolved；resource 不包含 `locales` 时也 MUST 视为 resolved。已观察 identity 在完整成功结果中仍缺失时 MUST 在当前 Session projection 中确认为 missing；该 identity 的重复 Tool call 或重复 render MUST NOT 再次触发查询，直到 Session 激活、成功 Skill acquisition 或其他本 Requirement 定义的明确刷新触发重新读取。

查询失败、超时、取消或 response schema invalid 时，store MUST 保留该 Session 的 last-good projection，MUST NOT 增加 confirmed missing。没有 last-good 的 identity MUST 按 id 降级。失败后的自动重试 MUST 按 Session 合并并冷却，MUST NOT 由每次 Tool call 触发。刷新成功或失败均 MUST NOT 阻止其他界面继续显示。

Resource response MUST 只更新发起请求时捕获的 Session。Session 切换、清理或新请求 epoch 产生后，迟到 response MUST NOT 覆盖其他 Session 或复活已清理状态。Resource 更新 MUST 触发使用相同 event 引用的 live/history title 重新计算，并 MUST NOT 改变 process entry key、展开状态或事件对象。

History MUST 只依赖 event 中已有的稳定 Capability identity。当前 locale、resource response 或 Provider name 变化后，当前页重渲染或重新激活 Session MUST 使用 current last-good projection 重新选择名称；系统 MUST NOT 把执行时名称写入 event、conversation、sessionStorage、Gateway 或数据库。没有明确刷新信号的同一 identity 元数据变化 MUST 在当前 Session 内继续使用 last-good；该 Session 再次激活时 MUST 重新读取 current projection。

现有 Skill Catalog 页面 MUST 保持 `/api/v1/skills` 的分页、搜索和可见性语义。系统 MUST NOT 因本 change 给 `SkillCatalogQueryRequest` 增加 locale，MUST NOT 用 Capability presentation resource query 替代 Skill list query。

#### Scenario: 新 Session 与 conversation 并行预取

- **WHEN** Agent Web 创建成功并开始使用一个 Session
- **THEN** 浏览器 MUST 立即调度该 Session 的完整 presentation resource query
- **AND** 用户提交、conversation、history 和 stream MUST NOT 等待该 query 完成

#### Scenario: Capability event 早于展示资源返回

- **GIVEN** 一个 Capability event 已进入当前 Session，但 presentation resource query 尚未返回
- **WHEN** Agent Web 首次渲染该过程条目
- **THEN** 标题 MUST 先按 `capabilityId` 安全降级
- **AND WHEN** resource response 后续成功返回
- **THEN** 不需要新 event 就 MUST 原位更新为当前 locale 的名称
- **AND** process entry key、展开状态和 event 对象 MUST 保持不变

#### Scenario: 中英文切换即时重渲染 live 和 history

- **GIVEN** 同一 Capability resource 包含 `zh-CN` 和 `en-US` 名称
- **AND** live 与 history 都包含相同公开 identity
- **WHEN** 用户从中文切换到英文
- **THEN** live 与 history 标题 MUST 在不请求后端的情况下使用 `en-US` 名称重新渲染
- **AND** 切回中文 MUST 使用 `zh-CN` 名称

#### Scenario: Skill 获取成功触发一次刷新

- **GIVEN** 当前 Session 接受一个 `acquire_skill` 成功 completion
- **WHEN** 该 completion 第一次进入 live accepted event 集合
- **THEN** Agent Web MUST 调度一次完整 presentation resource refresh
- **AND** 同一 completion 的 transport replay MUST NOT 再次触发刷新

#### Scenario: 新 runtime-generated Skill 没有 locales

- **GIVEN** 当前 projection 不包含一个新 runtime-generated Skill identity
- **AND** 该 Skill descriptor 只有 stable `displayName`，没有 `locales`
- **WHEN** 该 identity 首次出现在 process event 并且刷新成功返回该 descriptor
- **THEN** Agent Web MUST 把该 resource 视为 resolved 并使用 stable `displayName`
- **AND** 后续相同 Tool call 或 render MUST NOT 再次触发查询

#### Scenario: 刷新期间的新 identity 触发一次尾随刷新

- **GIVEN** 当前 Session 已有一个 presentation resource query in flight
- **WHEN** 期间出现一个新的合法未知 identity
- **THEN** Agent Web MUST NOT 启动并行 query
- **AND** 当前 query 完成后 MUST 至多追加一次 trailing refresh

#### Scenario: 完整成功后确认 missing

- **GIVEN** 一个已观察 identity 在完整成功结果中仍不存在
- **WHEN** 相同 identity 再次出现在该 Session 的过程事件中
- **THEN** Agent Web MUST 继续按 id 降级
- **AND** 该重复出现 MUST NOT 单独触发新的 query

#### Scenario: 刷新失败保留 last-good

- **GIVEN** 浏览器已有该 Session 的成功 projection
- **WHEN** 后续刷新失败、超时、取消或返回非法 response
- **THEN** 浏览器 MUST 继续使用 last-good resource
- **AND** 系统 MUST NOT 把失败中缺失的 identity 确认为 missing

#### Scenario: 迟到 response 不污染其他 Session

- **GIVEN** Session A 的 resource query 尚未完成且用户已切换到 Session B
- **WHEN** Session A 的 response 随后到达
- **THEN** response MUST NOT 修改 Session B 的 projection
- **AND** Session A 已被清理时该 response MUST NOT 重新创建其状态

#### Scenario: Skill Catalog 查询保持独立

- **WHEN** 用户打开 Skill Catalog 页面并切换界面语言
- **THEN** Skill 列表 MUST 继续通过 `/api/v1/skills` 的既有 request 和分页结果加载
- **AND** `SkillCatalogQueryRequest` MUST NOT 增加 locale

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：Capability process title 使用当前 Session 的受治理 presentation resources 与当前 UI locale 生成，并在资源不可用时确定降级；过程结构和结果安全边界不变。
- **依据 Requirements**：`Capability 过程标题必须使用最小公开身份生成`、`Agent Web 必须集中维护 Capability 业务名称映射`

### 输入

- **变更类型**：修改
- **目标内容**：既有 lifecycle identity、当前 UI locale、Session-scoped last-good presentation resources 和平台固定动作/状态 i18n resources。
- **依据 Requirements**：`Capability 过程标题必须使用最小公开身份生成`、`Agent Web 必须集中维护 Capability 业务名称映射`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统按 current locale、`en-US`、stable `displayName`、id 的顺序选择纯文本名称；Session 创建或激活时并行预取，Skill 获取成功或首次未知 identity 时执行合并刷新。
- **依据 Requirements**：`Capability 过程标题必须使用最小公开身份生成`、`Agent Web 必须集中维护 Capability 业务名称映射`

### 结果

- **变更类型**：修改
- **目标内容**：三宿主的 live/history 标题共享当前 Session 的 Provider-backed 名称；失败保留 last-good 或按 id 降级，event、Skill Catalog 和结果披露保持不变。
- **依据 Requirements**：`Capability 过程标题必须使用最小公开身份生成`、`Agent Web 必须集中维护 Capability 业务名称映射`

### 规格

- **规格项**：名称 fallback 顺序
- **变更类型**：修改
- **原规格值**：平台固定映射、AICOConfig 当前语言映射、前端构建期集成映射、合法技术标识或中性标题依次降级
- **目标规格值**：当前 UI locale 精确名称 → `en-US` 名称 → stable `displayName` → `capabilityId`；wrapper 使用固定动作模板包装目标名称
- **依据 Requirements**：`Capability 过程标题必须使用最小公开身份生成`

- **规格项**：名称资源刷新触发
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：Session 创建或激活、已接受的 `acquire_skill` 成功 completion、首次合法未知 identity；同一 Session 同时至多 1 个 in-flight query，刷新期间至多追加 1 次 trailing refresh
- **依据 Requirements**：`Agent Web 必须集中维护 Capability 业务名称映射`
