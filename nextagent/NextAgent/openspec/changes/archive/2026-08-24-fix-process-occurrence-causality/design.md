## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.1 查看会话消息流` | 相同 `stepId` 在已接受用户输入边界前后形成独立执行说明发生实例 | `ts-web-sse-ws-transports` | `FN-1.1 查看会话消息流` |
| `FN-10.6 前端定制` | 同一 `toolCallId` 的执行命令 lifecycle、任务进展、普通结果和终态形成一张按真实时序定位的卡片 | `agent-web-process-panel`、`agent-web-structured-message-rendering` | `FN-10.6 前端定制` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `agent-web-structured-message-rendering` / `Process Panel Entry Generation` | `FN-10.6` / `agent-web-process-panel` | 来源 `REMOVED` + 目标 `MODIFIED` `TOOL_STRUCTURED_DELTA 过程面板处理` | 稳定关联、segments、ANSWER、EXPAND_PANEL 和同 sequence 顺序无损迁移；其他 Requirements 原位保留 | `FN-10.6 前端定制` 的结构化 section 聚合与 renderer 方案 | 来源 stable spec 保留；Function 和 spec-to-design-map 删除该 Requirement 的 legacy 导航，改指 canonical spec |
| `agent-web-structured-message-rendering` / `CAPABILITY_STARTED and COMPLETED Suppression for Structured Tool Calls` | `FN-10.6` / `agent-web-process-panel` | 来源 `REMOVED` + 目标 `MODIFIED` `TOOL_STRUCTURED_DELTA 过程面板处理` | suppression 行为被单卡片聚合替代；非结构化 Tool lifecycle 行为不变 | `FN-10.6 前端定制` 的 Capability 卡片 reducer | 来源 stable spec 保留；删除 suppression 导航 |

迁移期间不得由未协调的并行 active change 同时修改上述两个来源 Requirements 或三个目标 Requirements。当前已完成 change `refine-capability-result-card-presentation` 明确把 #742 仲裁留给独立 change，本 change 接管该边界；实施前需以最新 `origin/main` 再确认没有新的 active overlap。

## `FN-1.1 查看会话消息流`

### 目标与规范依据

同一逻辑 `stepId` 在用户输入恢复后可以再次执行，但用户必须看到输入边界前后的两条独立说明；live、压缩和 history 不能用后文替换前文。

#### 本 Function 的目标 Requirements

canonical spec：`ts-web-sse-ws-transports`

- `ADDED`：`用户输入边界分隔复用 stepId 的模型发生实例`

### 当前实现

`conversationStore.appendLiveEnvelopes(...)` 把 accumulated assistant content lane 定义为 session、root message、attempt、event type 和可选 `stepId`。相同 lane 的新 envelope 直接替换旧 envelope，因此输入恢复后复用 `stepId` 会覆盖暂停前内容。

`streamCompaction` 同样按 root、attempt、event type 和 `stepId` 压缩累计正文。`buildProcessDisplayEntries(...)` 的 `processContentEntries` 使用 root、attempt 和 `stepId` 建 key；替换时保留旧 entry 的 sequence 和 createdAt，所以后文不仅覆盖前文，还会继承前文位置。

`buildTurnBlocks.deduplicateTurnEnvelopes(...)` 已经为 thinking 建立 `USER_INPUT_RECEIVED` 分段，代码注释明确记录 pending input 可能重新执行同一 round 并产生相同 `stepId`。该分段只作用于 thinking，未覆盖 `LLM_CONTENT_DELTA` 的 live lane、压缩和过程说明投影。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 输入边界前后的相同 `stepId` 是不同发生实例 | accumulated lane 和 process entry key 不含输入分段 | 后文覆盖前文 |
| 每个发生实例保留自身时序锚点 | replacement 保留旧 sequence 和 createdAt | 新说明出现在旧说明位置 |
| live、容量压缩和 history 一致 | thinking 有分段，content 的多个 consumer 各自只看 `stepId` | 相同事实经过不同路径可能再次合并 |
| 不改变 producer 和公共 event shape | 现有 `USER_INPUT_RECEIVED` 已提供可信边界 | 缺少共享的浏览器侧分段解释，而不是缺少新字段 |

### 修改方案

唯一实现路径是在现有 frontend stream utility 层增加一个纯函数，按已排序 envelopes 为每个 root message、attempt 和 run 计算从 0 开始的 `inputSegment`。每遇到一个 `USER_INPUT_RECEIVED`，该 scope 后续事件的 segment 加 1；该事件本身仍属于结束前一段的边界事实，不参与 assistant content lane。函数只消费 canonical event type 和顺序，不解析正文。

以下 consumer 复用同一结果：

1. `conversationStore.appendLiveEnvelopes(...)` 在建立 accumulated lane map 和处理 incoming envelopes 时把 `inputSegment` 加入 lane key。现有已接受 sequence 单调性保持不变，不重排 envelopes。
2. `streamCompaction` 在 compact lane 中加入 `inputSegment`，禁止跨输入边界压缩相同 `stepId`。
3. `buildProcessDisplayEntries(...)` 在 process-content key 中加入 `inputSegment`；每个 entry 的首次 sequence 和 createdAt 来自该 segment 的首个事件。
4. `answerContent` 中按 `stepId` 聚合 pending/completed process content 的路径使用相同 occurrence key，避免 final handoff 再次跨边界合并。
5. `buildTurnBlocks` 现有 thinking 分段改为调用同一 utility，不改变已验证行为，删除第二套边界算法。

该 utility 是 frontend 私有投影状态，不写入 envelope、Message、timeline 或 Gateway。输入历史不含 `USER_INPUT_RECEIVED` 时 segment 始终为 0，系统保持现有身份结果且不做文本猜测。

#### 备选方案（Alternatives Considered）

- 强制 Agent Core 在恢复后生成新 `stepId`：会改变现有“pending input 可重新执行同一 round”的语义，并需要跨 runtime/checkpoint/producer 修改；当前已有可信输入边界，收益不足。
- 使用 `messageId` 区分 completed 说明：只能处理已完成事件，无法阻止新的 live pending snapshot 在完成前覆盖旧内容。
- 根据正文或相邻 Tool 推断：不能形成确定身份，拒绝采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由功能性 Requirement 的 live/history 一致结果约束 | 全部 content lane consumer 复用同一输入分段 utility | live、压缩、重连和 history 对同一 fixture 输出一致 |
| 审计/可追溯性 | 无新增黑盒质量目标；由真实 sequence/created time 结果约束 | occurrence 不跨边界替换，不改写持久化事件 | 两条说明保留各自 event 顺序和时间 |

## `FN-10.6 前端定制`

### 目标与规范依据

一次 Bash 调用只对应一张“执行命令”卡片。任务进展是该命令运行期间产生的结构化过程，普通安全结果是命令终态结果；二者按因果顺序显示在同一卡片内。

#### 本 Function 的目标 Requirements

canonical spec：`agent-web-process-panel`

- `MODIFIED`：`TOOL_STRUCTURED_DELTA 过程面板处理`
- `MODIFIED`：`Active process entries follow execution lifecycle`
- `MODIFIED`：`Structured workflow process presentation remains visible`

### 当前实现

`buildProcessDisplayEntries(...)` 分别维护 `toolEntries` 和 `structuredToolEntries`。预扫描得到 `structuredToolCallIds` 后，会抑制相同 `toolCallId` 的 `CAPABILITY_STARTED`；具有 canonical completion 时又跳过相同 ID 的全部 `TOOL_STRUCTURED_DELTA`。因此 structured 与 lifecycle 互相竞争，不能同时构成一张卡片。

结构化 `SUB_TITLE` 当前创建 `toolName=null` 的独立 `ProcessEntry`，它使用自身 sequence 排序。若 started 被抑制而 completion 后来重新创建 tool entry，completion 以终态 sequence 作为 first sequence，于是先产生的“任务进展”排在“执行命令”之前。

`ProcessPanel` 只对带显式 `parentToolCallId` 的 Workflow-as-Tool children 做嵌套。Bash 结构化输出与 lifecycle 已共享 `toolCallId`，不需要也没有 `parentToolCallId`。现有 disclosure 把 structured title/subtitle 视为 settled 后保持展开的特殊 presentation，与用户确认的成功命令折叠规则冲突。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 一个 `toolCallId` 对应一张 Capability 卡片 | tool 与 structured 使用两个 entry 集合并互相抑制 | 同一事实被拆成顶层兄弟或只保留一侧 |
| 卡片锚定 started | started 可能被抑制，completion 可作为 first sequence | 终态更新导致时序漂移 |
| 进展在前、普通结果在后 | 单一 `detail` 字段在 completion 时被 canonical result 替换 | 不能同时保留结构化 sections 与结果 section |
| 协议帧只显示一次 | commandOutput stdout preview 可包含已经投影的 SSE 帧 | 结构化语义和原始协议可能重复 |
| 成功折叠、失败保持展开 | structured presentation settled 后保持展开；普通 capability 统一折叠 | disclosure 不反映真实终态重要性 |

### 修改方案

保留现有 `ProcessEntry` 和 `ToolProcessEntry`，只增加 frontend 私有的 `structuredSections` 字段。每个 section 包含稳定 key、`title`、TEXT detail、ordered `structuredSegments`、首末 sequence 和可选 expand-panel 数据；字段只存在于浏览器 view model，不进入公共 DTO 或持久化。

`buildProcessDisplayEntries(...)` 先预扫描具有合法 lifecycle 的 `toolCallId`。排序遍历时采用以下唯一映射：

| 事件 | 有匹配 runtime Capability lifecycle | 无匹配 runtime Capability lifecycle |
|---|---|---|
| `CAPABILITY_STARTED` | 创建/更新 `toolEntries[toolCallId]` 并固定 first sequence/time | 按既有非法/缺失输入处理 |
| `TITLE` / `SUB_TITLE` | 在同一 tool entry 的 `structuredSections` 追加 section | 继续创建独立 structured entry |
| detail / conclusion | 更新同一 ID 下匹配 section | 沿用独立 structured entry 关联规则 |
| ordinary safe result | 写入 tool entry 的 result detail，不覆盖 sections | 沿用既有普通结果规则 |
| `CAPABILITY_COMPLETED` | 更新状态、失败信息和 last sequence，保留 first anchor 与 sections | 按既有 completion fallback 处理 |

删除 `structuredToolCallIds` 对 lifecycle 的 suppression 和 `canonicallyCompletedToolCallIds` 对 structured delta 的全量跳过。Workflow inner product 继续使用已有 occurrence 和 `parentToolCallId` 规则；本 change 不把所有结构化条目泛化为树。

`ProcessPanel` 在一张 tool card 内按固定顺序渲染：`structuredSections`、独立普通结果、失败原因。只有存在对应内容时才渲染 section 标题，不生成空“命令结果”。现有 `AnswerSegments` 和专用 PIU/DSL/ACTION/OPERATOR/FILE renderer 直接复用。

当同一 `toolCallId` 已有 structured sections 时，canonical completion 的 `commandOutput.stdoutPreview` 视为可能包含协议 residue：

- 若存在已独立投影并缓冲的普通 safe result delta，结果区使用该独立结果；completion stdout preview 不再显示。
- 若不存在独立普通结果，省略 completion stdout preview，但保留 exit code、stderr/安全错误、truncation 和 terminal status。
- 不在浏览器解析 SSE/NDJSON，不使用文本去重，不修改 canonical Capability Result Message；模型上下文、诊断原始输出和 persistence 保持不变。

disclosure 复用现有 entry override 和 timer：running 自动展开；成功 terminal 保持展开 800 ms 后折叠；失败、超时或阻止 terminal 不启动 collapse timer；任何手动 expand/collapse 继续冻结该 entry 的自动行为。只有独立 structured workflow presentation 保留 settled 默认展开例外，runtime Capability 卡片内部 sections 不触发该例外。

#### 备选方案（Alternatives Considered）

- 给结构化条目增加 `parentToolCallId` 并使用通用树：重复表达已经由 `toolCallId` 确定的同一发生实例，且会把输出误建模成子 Capability。
- 隐藏“执行命令”并把任务进展提升为卡片标题：与产品已确认的“执行命令”业务语义冲突。
- 浏览器解析 raw stdout 后删除匹配帧：扩大浏览器安全和协议 owner，拒绝采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由功能性 Requirements 的 live/history 和 disclosure 结果约束 | 单一 tool entry reducer、started anchor、sections/result 分离 | live 与 cold history 的卡片数量、顺序、内容和默认开合一致 |
| 可维护性 | 无新增黑盒质量目标；由 canonical spec 迁移约束 | 删除 structured/lifecycle 双向 suppression，复用现有 entry 和 renderer | 不新增通用树、公共 DTO 或宿主特判 |
| 可测试性 | 无新增黑盒质量目标 | 真实 issue event fixture 驱动 projection 和组件测试 | 成功、失败、混合结果、同 sequence、无 lifecycle 负例 |

## 跨 Function 协作与端到端流程

`FN-1.1` 先用输入分段保证两个模型说明 occurrence 均进入同一有序 envelope 序列；`FN-10.6` 再把其中每个说明与其后真实 Capability 卡片按 sequence 呈现，并把相同 `toolCallId` 的任务进展聚合到该卡片。两个 Function 不共享私有状态：唯一共享输入仍是既有 canonical stream events、sequence、`stepId`、`toolCallId` 和 `USER_INPUT_RECEIVED`。

端到端 fixture 使用 issue event 顺序验证：说明 A、Bash T1 started、T1 任务进展、T1 completed、用户输入边界、说明 B、后续 Capability。预期 A 和 B 分别保留；T1 只形成一张卡片；刷新不改变结果。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 可靠性/恢复 | `FN-1.1 / 用户输入边界分隔复用 stepId 的模型发生实例`；`FN-10.6` 三个 modified Requirements | 全路径消费相同 canonical event 顺序，live/history 不建立平行身份 | 同一 issue fixture 分别走 live accumulation、容量压缩和 cold history，比较最终可见投影 |
| 审计/可追溯性 | `FN-1.1 / 用户输入边界分隔复用 stepId 的模型发生实例`；`FN-10.6 / TOOL_STRUCTURED_DELTA 过程面板处理` | 模型 occurrence 保留自身首事件锚点，Capability 卡片保留 started 锚点 | 断言可见顺序与真实 sequence 因果一致，不以 completion 或后续说明重排 |

## 验证策略（Verification Strategy）

- characterization：用已确认的用户输入恢复事件序列复现相同 `stepId` 跨边界覆盖，以及 Bash structured/lifecycle 双条目和错序。
- unit：验证输入分段 utility、live lane、stream compaction、process-content key、structured section reducer、result precedence 和 disclosure terminal matrix。
- integration：相同 envelopes 分别经过 live store、重连 merge 和 run-event history，断言可见投影一致。
- component：验证运行中展开、成功 800 ms 后折叠、失败/超时/阻止保持展开、手动 override、section/结果顺序和无空结果标题。
- e2e：三种 Web host 复用同一 Chat workspace 时展示相同卡片数量、顺序和 disclosure；刷新后保持一致。
- negative case：无输入边界不伪造 segment；不同 toolCallId 不串 section；无 lifecycle 的独立 structured workflow 行为不变；raw stdout 不由浏览器解析；ANSWER 不进入过程卡片；模型上下文不包含 UI sections。
- architecture/semantic review：确认没有新增公共 contract、Gateway/persistence owner、通用执行树或宿主特判，并检查 legacy Requirement 原子迁移。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并用户输入分段 occurrence Requirement。
- `openspec/specs/agent-web-process-panel/spec.md`：合并三个 modified Requirements 和 legacy 迁入行为。
- `openspec/specs/agent-web-structured-message-rendering/spec.md`：移除两个已迁移 Requirements，保留其他 Requirements。
- `openspec/designs/functions/D1-会话与流式交互/D1.1-流式交互与恢复/FN-1.1-查看会话消息流.md`：更新 Tool 轮次说明规格和结果。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：更新主规格导航、runtime Capability 结构化卡片和 disclosure 规格。
- `openspec/designs/features/D1-会话与流式交互/D1.1-流式交互与恢复/F-1.1-实时查看处理过程.md`：补充真实发生实例和因果归属的用户保证。
- `openspec/overview.md`：提炼过程投影的发生实例不变量。
- `openspec/designs/architecture/conversation-process-history.md`：增加输入分段 occurrence 与 started-anchor 单卡片恢复规则。
- `openspec/designs/architecture/stream-projection.md`：增加 browser accumulated lane 的输入边界解释。
- `openspec/designs/modules/agent-web.md`：更新 process reducer、structured sections 和 disclosure owner；`agent-core`、`agent-runtime`、`agent-channel-web`、`agent-channel-common` 无。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：删除两个 legacy Requirement 导航，更新三个 stable spec 的设计与验证入口。

## 风险与取舍（Risks / Trade-offs）

- run-event history 分页若缺少先于当前页的 `USER_INPUT_RECEIVED`，当前页无法重建绝对 segment。缓解方式是沿用完整 run process-history 的既有加载边界；测试必须覆盖分页组装后再投影，不能对单页正文做猜测。
- 当 completion stdout 同时包含协议帧和未独立投影文本时，本 change 选择省略该 stdout preview，而不是在浏览器拆协议。canonical result 和诊断数据仍保留；如果产品未来必须公开混合残留，需要由 producer/server safe projector 定义新的独立安全结果契约，不在本 change 预留字段。
- `ProcessEntry` 增加 sections 会提高单卡片 view-model 大小，但事件和已有限额不变；不引入第二份 envelope cache。
- 已经持久化且具有 `USER_INPUT_RECEIVED` 的历史可以通过新投影恢复；缺少边界的旧历史不迁移，避免错误拆分。

## 待确认问题（Open Questions）

无。
