## 设计范围

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-9.8 持久化和恢复工作流` | Workflow inner process 使用 Event，`TURN_ANSWER` 使用 terminal Assistant Message | `workflow-event-history` | [FN-9.8](#fn-98-持久化和恢复工作流) |
| `FN-1.2 断线后从上次位置继续` | completed live 与 cold history 组合 Message 与 qualified Workflow Event 后收敛 | `ts-stream-history-consistency` | [FN-1.2](#fn-12-断线后从上次位置继续) |
| `FN-2.4 查看请求状态` | 三档策略只治理 ordinary/outer Capability Result | `ts-run-status-visibility` | [FN-2.4](#fn-24-查看请求状态) |

本 change 不修改 `FN-11.1 恢复运行状态`、terminal Hook、pending input、startup recovery、Gateway、数据库或 public Web contract。

## 存量 Requirement 迁移方案

| 来源 Requirement | canonical 目标 | 原子迁移 | 行为影响 |
|---|---|---|---|
| `tool-structured-delta / Single Storage With History Reconstruction` | `FN-1.2 / ts-stream-history-consistency / 结构化过程正文使用单一 Message 恢复` | 来源 `REMOVED`，目标 `ADDED` | CLIP/ordinary Message-first、structured/ordinary history 分支和 string payload deferred Scenario 无损保留；`appendCapabilityResultMessage` 白盒路径只在本 design 说明，不进入 Function spec；不产生代码变更任务 |
| `tool-structured-delta / Workflow Selective Persistence` | `FN-9.8 / workflow-event-history / Workflow 内部过程与模型会话事实分离`、`Workflow 完成态产品过程可从 Event 恢复` | 来源 `REMOVED`，目标两个 `ADDED` Requirements | 保留 completed product durable、fragment live-only 和 history recovery，并补齐 Direct/Workflow-as-Tool owner 边界 |

`tool-structured-delta` 的其他 Requirements 原位保留，该 legacy spec 不退役。

### 并行 active change 的归档顺序

`add-structured-delta-bash-apicall-identification` 与 `add-stream-dsl-message-type` 已完成但尚未归档，且都修改 `tool-structured-delta`。唯一 stable 合并顺序是：

1. `add-structured-delta-bash-apicall-identification`
2. `add-stream-dsl-message-type`
3. `persist-ts-refresh-stable-completed-turns`

机器依赖按最小直接依赖编码：`add-stream-dsl-message-type` 依赖第 1 项，本 change 依赖第 2 项；第 1 项由传递依赖覆盖。该顺序只阻塞 stable spec 归档，不阻塞本 change 的代码实施或定向验证。

## FN-9.8 持久化和恢复工作流

### 目标与规范依据

本 Function 的目标 Requirements：

- `Workflow 内部过程与模型会话事实分离`
- `Workflow 完成态产品过程可从 Event 恢复`

### 当前实现

- Direct Workflow 由可信 routing decision 直接执行 recipe，正常路径不进入 model loop；terminal commit 已用 Assistant Message 保存最终回答。
- Direct observer 仍会为 inner `TOOL`、`SKILL`、`SUBFLOW` 追加 Tool use/result Message，并为 inner result 产生 ordinary Capability Result 投影。
- Workflow runtime projector 已能把 title、detail、answer 和 structured output 映射为 `TOOL_STRUCTURED_DELTA`；`NODE_OUTPUT_DELTA` fragment 可 live 投影，`NODE_COMPLETED` full product 可持久化。
- Workflow-as-Tool 已由 model loop 创建 outer Tool protocol Message pair。
- Active Context 只消费 Message 引用，不消费 timeline Event；这条稳定上下文边界不是本 change 新增的契约。

### GAP 分析

1. Direct inner Message 让产品内部过程进入模型上下文，并与 Event product 形成两个 durable owner。
2. inner Message 删除后，lifecycle 需要保持可恢复但不能携带 input、output、arguments、result 或 description 正文。
3. Direct root、Direct nested 与 Workflow-as-Tool inner execution 必须使用确定的产品层级，不能根据事件到达顺序猜测。
4. ordinary output 不能只靠自报 Workflow 字段取得 message-free history 资格。
5. inner process 收敛不能删除 Workflow-as-Tool 的 outer model protocol pair。

### 修改方案

1. Direct Workflow observer 停止为 inner node 追加 `ASSISTANT_TOOL_USE`、`CAPABILITY_RESULT` Message，也停止为同一 inner result 产生 ordinary `CAPABILITY_RESULT_DELTA`。
2. Direct 与 Workflow-as-Tool 的 inner execution 都交给现有 Workflow runtime projector。执行入口在创建 projector 时携带可信 recipe/execution provenance；资格判断不读取产品 output 中的 namespace 或 persistence hint，也不新增公共字段。
3. 每个 recipe execution 使用自己的 projector。对于 title/detail/answer 三类层级，Direct root 分别使用 `TITLE`、`DETAIL`、`ANSWER`，Direct nested 与 Workflow-as-Tool inner execution 分别使用 `SUB_TITLE`、`SUB_DETAIL`、`SUB_CONCLUSION`；root/nested 来自已注册 recipe 与 execution 关系。`EXPAND_PANEL` 以及全部未触及 canonical level 沿用 main 既有映射。
4. lifecycle Event 只保留既有 identity、status、order、duration、retry/topology coordinate 和 safe failure fact；投影前移除 description、input、output、arguments、result、safeResult 与 structuredPayload。
5. `NODE_OUTPUT_DELTA` product fragment 保持 `LIVE_ONLY`；`NODE_STARTED` title 与 `NODE_COMPLETED` accumulated product 通过同一 qualified Workflow path 持久化。Runtime 只对白名单 event type、合法 Workflow/node identity、既有 Tool vocabulary 和允许状态组合授予 message-free 资格。
6. Workflow-as-Tool 继续由 model loop 创建唯一 outer Tool use/result Message pair；inner Event 不复制 outer result payload。
7. 不增加 Context、retry、edit、fork 的第二套 Requirement。实施只运行既有 `Process history never affects model context or prefix cache`、retry/edit 与 fork 规则的回归测试，证明本 change 没有从 Event 反建 Message/Active Context。

`appendCapabilityResultMessage` 继续承载 ordinary/outer canonical Capability Result；本 change 只删除错误用于 Direct inner process 的调用，不改变该 helper 的 contract。

#### 质量属性影响

- 安全：message-free 资格来自可信执行入口和闭合集合，产品 output 不能自报取得例外；该行为由本 Function 的 functional negative Scenario 验收，不新增通用 classifier。
- 可维护性：Direct 与 Workflow-as-Tool inner process 只有一个 projector 与一个 owner 规则。
- 可测试性：分别验证 Direct、Workflow-as-Tool、root/nested、成功/失败和伪造 identity；不新增系统质量属性 Requirement。

## FN-1.2 断线后从上次位置继续

### 目标与规范依据

本 Function 的目标 Requirements：

- `Live in-progress state converges to completed cold history`（完整 `MODIFIED`）
- `过程历史从消息正文与事件时序联合恢复`（完整 `MODIFIED`）
- `结构化过程正文使用单一 Message 恢复`（legacy 原子迁入，`ADDED`）

### 当前实现

- ordinary process history 已在服务端按 Message association 恢复正文；浏览器不读取隐藏 Message。
- live、settled 与 history 已由同一会话投影组合，普通 terminal 不强制刷新 conversation。
- cold history 对 Message-backed process 要求有效关联；没有 Message 的 Workflow lifecycle 会被当作 association failure，部分 Workflow `ANSWER` product 会被 history answer 过滤。
- CLIP/ordinary structured result 已有 canonical result Message；`Single Storage With History Reconstruction` 的迁移只改变规范归属，不改变实现目标。

### GAP 分析

1. qualified Workflow lifecycle/product 没有 Message 时不能通过 ordinary association 恢复。
2. live fragment、completed product 和 request terminal 尚未使用同一收敛规则，页面刷新前后可能保留不同内容。
3. terminal Assistant Message 与 product `ANSWER`/`SUB_CONCLUSION` 可能被误认为同一个 owner，导致丢失 structured product 或重复 TEXT。
4. Workflow 例外必须保持闭合，不能改变 ordinary 缺失/歧义 Message 的安全降级。

### 修改方案

1. Channel 先执行既有 ordinary Message association；只有来自 FN-9.8 qualified Workflow path 的 message-free lifecycle/product 才直接使用 Event 的安全投影。ordinary、malformed 或伪造 Event 继续使用既有关联失败或 `contentUnavailable` 行为。
2. history 对 qualified lifecycle 只显示安全 identity/status，对 completed product 显示 persisted product body；terminal answer 仍从 visible Assistant Message 恢复。过程读取失败不得隐藏已提交回答。
3. Frontend 使用现有 `sessionId + runId + toolCallId + nodeExecutionId + toolEventType + toolMessageType` 坐标匹配 fragment 与 completion，不新增 public identity。matching completion 替换 fragment；任一 request terminal 清除该 run 的残留 fragment；cold history 不恢复 fragment。
4. answer projection 以 terminal Assistant Message/fact 为 canonical answer。安全投影后的 product TEXT 与 terminal text 使用严格字符串相等比较：相等时只呈现 product TEXT 一次，不相等时两者都呈现；PIU、DSL、STREAM_DSL、ACTION、OPERATOR、FILE 不参与 TEXT 去重并与 terminal text 同时保留。
5. settled live 与 cold history 复用同一 product reconcile 和 answer composition；history item 不覆盖 matching settled item，也不引入 terminal conversation refresh。
6. CLIP/ordinary `CAPABILITY_RESULT` Message 继续是唯一 durable body，history 继续从 Message 恢复 structured 或 ordinary result。该 legacy 迁移只增加规格回归，不增加实现分支。
7. Workflow output parser 已明确 `show_title=false` 且 `show_content=true` 时，保留该 completed product 的独立 occurrence 与正文，但展示层只渲染产品正文，不生成空标题、独立状态图标、完成对勾或展开按钮。该规则只落实既有 title/content metadata，不新增 `PRODUCT_PROCESS` policy，也不改变 Event identity、排序或持久化。
8. title-suppressed product 继续占用与普通节点相同的内容列，使用既有图标列宽度与 row gap 形成不可见布局占位，不复制固定缩进值。model loop 在调用 Workflow 前沿用 ordinary Tool lifecycle 发布 outer `CAPABILITY_STARTED`，使 active outer entry 先于 inner Event 可用；Workflow-as-Tool inner Event 使用已有 `parentToolCallId` 与 outer Workflow `toolCallId` 做唯一父子关联，前端内部 projection 保留该坐标，并在 outer active 或 completed entry 可用时把 matching inner entries 放入其 disclosure。Direct Workflow、unmatched entry、outer 前后的 thinking 与 terminal answer 不归组，也不按事件相邻关系猜测父子关系。

#### 质量属性影响

- 可靠性/恢复：ordinary association failure、已提交 answer 优先级和旧消息降级保持现有稳定 Requirements；本 change 只增加 qualified Workflow 正常路径。
- 性能/容量：不增加 Web 请求、Gateway query、timeline paginator 或 browser hidden-message fetch；沿用现有每 run history page。
- 可测试性：同一 fixture 分别走 completed live 与清空本地 state 后的 cold history并比较语义结果。
- 可理解性：title-suppressed product 在 live 与 history 中都表现为与同层 detail 对齐的正文，而不是一个名称为空或突出到图标前导区的系统节点；Workflow-as-Tool 的 outer invocation 与 inner product 形成一个可理解的折叠层级。

## FN-2.4 查看请求状态

### 目标与规范依据

本 Function 的目标 Requirement：

- `Workflow 产品过程不受 Capability Result 呈现策略裁剪`

### 当前实现

- `STATUS_ONLY`、`SUMMARY`、`DETAIL` 在 Capability Result projector 中选择 ordinary result 的安全状态、摘要或详情。
- `TOOL_STRUCTURED_DELTA` 使用独立 structured projection；Workflow product 不是三档策略的配置对象。
- Workflow-as-Tool 的 outer result 是 model loop Capability Result，必须继续拥有 canonical result Message 和 ordinary result projection。

### GAP 分析

本 change 删除 inner result 路径时，若把 Workflow product 与 outer result 一起抑制，Workflow-as-Tool 会丢失受三档治理的 outer Tool result。反方向若把 product 送入 Capability Result projector，又会错误裁剪产品定义的 PIU/DSL/TEXT。二者需要保持不同类别，而不是新增统一配置。

### 修改方案

1. 三档 policy 的配置、默认值、安全上限和 ordinary result projector 不变。
2. qualified Workflow inner lifecycle/product 不进入 Capability Result policy 分支。
3. Workflow-as-Tool outer Tool-use Message 写入成功后、调用 Workflow 前，先产生 ordinary outer start；outer canonical result Message 写入成功后，继续产生 ordinary outer result delta/completion，并按三档 policy 投影。
4. 使用同一组参数化测试证明三档下 inner product 与 `TURN_ANSWER` 完全相同，同时 ordinary/outer result 保持既有差异。若 characterization 已通过，不修改生产逻辑。

#### 质量属性影响

- 安全：product 不绕过既有 structured validation；outer result 不绕过平台安全上限。
- 可维护性：不增加 `PRODUCT_PROCESS` policy，也不复用不匹配的 Capability Result 分类。

## 跨 Function 协作与端到端流程

1. 可信 routing 选择 Direct Workflow，或 model loop 写入 outer Tool-use Message、发布 outer start 并发起 Workflow Tool invocation。
2. Workflow execution 随后产生 inner lifecycle 与 product；FN-9.8 选择 body-free lifecycle Event、live-only fragment 或 durable completed product Event，不创建 inner protocol Message。
3. Direct terminal answer 或 Workflow-as-Tool outer protocol result 按既有路径写入 Message。
4. live path 投影 fragment、completed product、outer Capability Result 与 terminal answer；FN-2.4 只对 ordinary/outer result应用三档策略。
5. cold path 由 FN-1.2 关联 ordinary Message-backed process、直接读取 qualified Workflow Event，并从 Assistant Message 读取 terminal answer。
6. Frontend 以 completion/terminal 收敛 fragment，以 terminal answer 优先级和严格 TEXT 相等规则组合最终展示。

## 失败与兼容边界

- ordinary process 缺失、歧义、损坏或越权 Message 时继续 status-only/`contentUnavailable`，不得借 Workflow 例外读取 Event body。
- 无法证明可信 Workflow provenance、identity、event type 或 vocabulary 的 Event 不取得 message-free 资格。
- malformed persisted product 沿用现有 Web schema validation 与安全失败；本 change 不定义新错误码或 payload limit。
- process history 失败不影响已提交 terminal answer。
- 旧 Event 不满足新 qualification 时安全降级，不根据正文猜测它是否为 Workflow product。

## 验证策略

### Function 行为

- FN-9.8：Direct inner nodes 无 protocol Message/ordinary result delta；Workflow-as-Tool 只有 outer pair；root/nested 层级、body-free lifecycle、fragment/product persistence 和伪造 identity negative case均满足规格。
- FN-1.2：对 TEXT、PIU、DSL、STREAM_DSL、ACTION、OPERATOR、FILE 构造 completed live 与 cold history 对照；覆盖 completion 替换、terminal cleanup、同 TEXT 去重、不同/structured product 共存、title-suppressed 内容列对齐、Workflow-as-Tool outer/inner 折叠层级和过程失败不删除 answer。
- FN-2.4：参数化三档策略；inner product/answer deep-equal，ordinary/outer result 保持既有差异与安全上限。

### 架构回归

- 比较相同 Message/Active Context 在有无 Workflow Event 时的 provider input、token budget 和 cacheable prefix。
- 验证 retry/edit/fork 不从 Event 创建 Message 或 child Active Context item；fork 既有 scope rebinding、容量 preflight 和原子失败无回归。
- 验证没有新增 Gateway/public DTO/schema、数据库 migration、产品适配或 hidden-message Web 请求。

### 工程门禁

- 运行受影响 backend/frontend targeted tests、根 workspace contract/architecture gates、frontend build 和 strict OpenSpec validation。
- 完成模型语义审查；P0/P1 为零后才允许交付。

## 长期基线刷新计划

| 类别 | 归档前同步内容 |
|---|---|
| stable specs | 新增 `workflow-event-history`；更新 `ts-stream-history-consistency`、`ts-run-status-visibility`；从 `tool-structured-delta` 移除两个已迁移 Requirements并保留其他内容 |
| Functions | 刷新 `FN-9.8` 的描述、输入、输出、处理过程、结果、规格和主规格；刷新 `FN-1.2` 的描述、输出、处理过程、结果、规格、主规格与遗留规格；刷新 `FN-2.4` 的输出、处理过程、结果和规格 |
| Features | 刷新 `F-9.3`、`F-1.2`、`F-2.4` 的用户价值、用例或质量保证摘要，不复制 Requirement |
| overview | 记录 Message/Event ownership refinement、用户问题与非目标，不记录迁移步骤 |
| architecture | 更新 `ts-backend-architecture.md`、`core-contracts.md`、`conversation-process-history.md`，说明 closed Workflow exception、联合恢复和上下文边界 |
| modules | 更新 `agent-core.md`、`agent-runtime.md`、`agent-channel-web.md`、`agent-web.md`、`agent-workflow.md` 的职责与验证入口 |
| ADR | 更新 `process-message-body-owned-by-message.md`，补充“已有 Message 时正文只在 Message；qualified Workflow product 无 Message 时由 Event 持有”的 closed exception |
| spec-to-design-map | 为 `workflow-event-history` 建立导航，并刷新三个 canonical specs 到 architecture/modules/ADR/test 的映射 |

长期刷新只在实施完成、验证通过并归档时执行；不作为当前实现 task，也不提前修改 stable 文档。

## 风险与延期

- product Event 与 terminal Message 可以保存值相同的 TEXT；二者是不同语义事实，durable 层不做动态去重，只有展示层按严格相等去重。
- 通用 structured 安全/容量、terminal continuation recovery、share 过程恢复和产品过程密度配置继续 deferred；它们不是本 change 引入的问题，也不是交付条件。
