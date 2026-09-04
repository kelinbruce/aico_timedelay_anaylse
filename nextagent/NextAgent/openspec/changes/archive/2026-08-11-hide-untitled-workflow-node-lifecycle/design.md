## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | 无业务标题的 Workflow 内部非 runtime Capability lifecycle 始终隐藏；其正文仅在非失败终态可见，有标题节点保留实际状态，live/history 一致 | `ts-run-status-visibility` | `FN-2.4 查看请求状态` |

## `FN-2.4 查看请求状态`

### 目标与规范依据

本设计实现 proposal 已确认的事实与呈现分离：Workflow lifecycle 继续作为可信运行和历史事实存在，Agent Web 只决定该事实是否形成用户可见步骤。`description` 已通过 structured `TITLE`/`SUB_TITLE` 表达业务标题，本 change 不创建并行业务命名来源。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`无业务标题的 Workflow 内部节点不得显示技术身份`

### 当前实现

- `WorkflowRuntimeEventProjector` 为 `DELAY`、`CONDITION`、`RESTFUL` 和其他 Workflow 节点投影 body-free lifecycle。当前 successful `NODE_COMPLETED` 在 `show_content=false` 时被整个抑制，即使 `show_title=true` 已经产生业务标题，页面也无法取得实际完成状态。
- 节点具有 `description` 时，projector 另外发出 matching `TITLE` 或 `SUB_TITLE` structured product；节点完成并允许展示正文时另外发出 `DETAIL`、`SUB_DETAIL`、`ANSWER` 或 `SUB_CONCLUSION`。
- `agent-channel-common` 保留并校验可信 message-free Workflow lifecycle/product；live 与 history 向浏览器提供同形安全 envelope。
- Agent Web 的 `resolveCapabilityProcessTitle` 在 `capabilityKind` 缺失且 `capabilityId` 合法时回退为 `capabilityId`。对 generic Workflow 节点，该值等于 `nodeId`，因而形成 `active_delay` 一类标题。
- `buildProcessEntries` 只要同一 `toolCallId` 存在任意 structured delta 就跳过部分 lifecycle；这使 started 条目在只收到 lifecycle 时可见，而 completion/product 到达后又消失。`buildProcessTimelineEntries` 则始终把 lifecycle 加入完整时间线，两条投影路径不一致。
- 无标题 structured detail 已有纯内容 occurrence 投影：标题为空，不生成独立状态装饰或第二层 disclosure。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 无标题 normal lifecycle 不形成独立用户步骤 | 标题 resolver 把缺失 `capabilityKind` 的 `capabilityId` 原样显示 | 事实身份被误用为业务标题 |
| started 与 completion 之间不发生可见步骤跳变 | 聚合过程根据完整事件集合中是否存在任意 structured delta 决定是否隐藏 lifecycle | 可见性依赖未来 product 是否到达，而不是节点语义 |
| 无标题正文仅在非失败终态保持纯内容 occurrence | structured detail 路径已经支持纯内容，但不按 matching lifecycle 终态过滤 | 需要按 occurrence 隐藏 failed/timed-out matching detail |
| 无标题且无正文的节点不论终态均隐藏 | failure lifecycle 当前形成通用故障步骤 | 必须移除无标题 failure/timed-out 可见例外 |
| 有标题节点保留业务标题和实际状态 | structured title 与 lifecycle 终态分别投影；聚合过程可能丢失成功状态，失败时还会用通用故障标题覆盖已有业务标题，完整时间线会形成重复步骤 | 必须按同一 occurrence 把终态合并到已有 structured title，并保留 matching detail |
| 有标题但隐藏正文的节点显示实际成功状态 | `show_content=false` 同时抑制 structured content 和 successful terminal lifecycle | 标题停留在无终态状态；需要保留 body-free terminal fact |
| 完整时间线与聚合过程一致 | 两个 builder 对 lifecycle/structured 的过滤条件不同 | 需要共享同一分类规则 |
| runtime Capability、`WORKFLOW` lifecycle 和已有业务标题不回归 | Tool、Skill、Agent 及 Workflow/Subflow 的既有可见路径具有有效 `capabilityKind`；structured title 独立投影 | 新规则必须限定到可信 Workflow 且缺少合法 `capabilityKind` 的 lifecycle |

### 修改方案

`agent-core` 的 `WorkflowRuntimeEventProjector` 与 Agent Web 共同完成本 change。Channel schema、stream event 公共 shape 和 persistence 不修改。

projector 将标题可见性与正文可见性解耦：successful `NODE_COMPLETED` 在 `show_title=true` 时始终产生既有 shape 的 body-free `CAPABILITY_COMPLETED`；`show_content=false` 仍只抑制 `TOOL_STRUCTURED_DELTA`、`CAPABILITY_RESULT_DELTA` 和 lifecycle body。该规则一致应用于 generic、Capability-like 与 LLM Workflow 节点。`show_title=false` 且 `show_content=false` 的 successful 节点仍不产生用户可见 terminal lifecycle。

在 `processDetails.ts` 内保留一个局部共享分类函数，对 `CAPABILITY_STARTED`/`CAPABILITY_COMPLETED` 返回以下三类之一：

| 分类 | 判定 | 用户可见处理 |
|---|---|---|
| 不适用 | 不是可信 Workflow process event，或 payload 具有合法 `capabilityKind` | 沿用既有 Capability 标题与状态逻辑 |
| 隐藏 | 是可信 Workflow process event、没有合法 `capabilityKind`，且不是可合并实际状态的 terminal completion | 两个 builder 均不创建 lifecycle 条目；structured title/detail 路径继续独立工作 |
| 标题终态 | 是上述非 runtime Capability lifecycle，且 completion 的可信 `status` 为 `SUCCEEDED`、`FAILED` 或 `TIMED_OUT` | matching occurrence 有 structured business title 时，把实际终态合并到该标题且不创建第二个条目；没有 title 时不创建 lifecycle 条目，其中 failed/timed-out occurrence 还要排除 matching structured detail |

可信 Workflow process event 复用 `streamTextSemantics.ts` 的既有判断，不新增来源字段。`capabilityKind` 仅接受现有 `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` 闭集；未知或缺失值不取得 runtime Capability 的标题回退资格。`SUCCEEDED`、`FAILED` 和 `TIMED_OUT` completion 都可把实际状态合并到 matching business title；只有 `FAILED` 和 `TIMED_OUT` 抑制无标题 occurrence 的 matching detail，其他 lifecycle 保持隐藏。

两个 builder 在归并前按 `readWorkflowOccurrenceCorrelationId` 建立本次输入中非空 structured `TITLE`/`SUB_TITLE` 的 occurrence 索引和 failed/timed-out occurrence 集合。标题索引只复用现有业务标题事实，不解析 `description`，也不创建第二套命名来源。有 matching title 时，聚合过程和完整时间线把终态更新到同一 structured title，并保留既有 matching detail；没有 matching title 时，两条路径不创建 lifecycle 条目，并在处理 matching `DETAIL`、`SUB_DETAIL`、`SUB_CONCLUSION` 时依据失败集合跳过该正文。successful occurrence 的无标题正文继续沿用既有纯内容路径且不折叠。

`resolveCapabilityProcessTitle` 不修改。普通 legacy Capability envelope 以及合法 runtime Capability 仍可使用现有回退；把 Workflow 内部节点语义塞入通用 Capability 标题 resolver 会扩大影响范围并混淆职责。

structured title 索引的生命周期仅限单次纯函数投影，key 复用已有 occurrence correlation，value 只接受非空 `TITLE`/`SUB_TITLE` 正文。该索引不跨请求缓存、不修改 canonical event，也不引入新的公共 contract 或状态机。

#### 备选方案（Alternatives Considered）

- 后端停止发送无标题 lifecycle：会删除历史、审计和失败事实，并违反现有 Workflow event-history 契约，不采用。
- 前端根据后续节点开始推断上一节点成功：并行、跳过和恢复分支下无法可靠推断 canonical 状态，不采用。
- 按 `nodeType` 建立业务名称映射或新增 `displayName`：产生第二套命名来源和公共契约，且无法解决 lifecycle 与正文双重折叠，不采用。
- 失败时显示通用“流程步骤”：无法告诉用户具体业务步骤，且用户已确认无标题 occurrence 的失败内容不属于用户可见过程，不采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由功能性 Requirement 的内部标识禁止规则派生 | 非 runtime Capability Workflow lifecycle 不进入通用技术 id 标题 resolver | nodeId、toolCallId、nodeType 不出现在可见标题或无标题故障正文 |
| 可靠性/恢复 | 无新增黑盒质量目标；由同一 Requirement 的 live/history 一致性派生 | 两个 builder 复用同一无状态分类函数，输入事件来源不影响结果 | active、settled、history 输入得到相同最终投影 |
| 可维护性 | 无新增黑盒质量目标 | 不新增 contract/config；单一分类函数控制两个投影入口 | `TOOL`、`SKILL`、`AGENT`、`WORKFLOW` lifecycle 和 structured title/detail 回归测试 |

## 验证策略（Verification Strategy）

- unit 行为测试覆盖 started-only 不显示、successful completion 无正文仍不显示、加正文保持单个不折叠纯内容 occurrence、无标题 failed/timed-out 无论是否有 detail 都不显示、有标题 successful/failure 保留业务标题、matching detail 与实际状态，以及 runtime Capability 不回归。
- projector 测试覆盖 generic、Capability-like 与 LLM 节点在 `show_title=true`、`show_content=false` 时保留 body-free successful terminal lifecycle，并继续不产生 structured content。
- 同一 fixture 同时验证聚合过程与完整时间线，确保两个入口共享契约结果；对 history 输入增加 transport hint，验证来源变化不改变投影。
- negative case 断言无标题节点的 `nodeId`、`capabilityId`、`toolCallId` 和 `nodeType` 不进入可见标题，同时 failed/timed-out matching detail 被抑制。
- characterization 测试保留后端 generic Workflow lifecycle 的 body-free identity/status 事实，证明本 change 未删除 runtime/channel 历史事实。
- OpenSpec strict validation 和 NextAgent OpenSpec 语义检视覆盖 Function/spec 归属、现有 active delta 一致性和 owner 边界。
- agent-core 与前端 targeted tests、前端 TypeScript/Vite build 覆盖实现和产物可编译性；使用真实 Workflow-as-Tool recipe 做浏览器观察验证。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：归档时合并新增 Requirement，并保留 `FN-2.4 查看请求状态` 唯一归属。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：刷新描述、输出、处理过程和结果。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：补充 Workflow 无标题节点的稳定用户价值。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-process-history.md`：补充 lifecycle 事实身份与浏览器可见业务步骤分离的长期投影规则。
- `openspec/designs/modules/agent-web.md`：补充 Workflow 内部非 runtime Capability lifecycle 的可见性职责。
- ADR：无；该 change 沿用既有 frontend projection owner，不形成新的长期架构选择。
- `openspec/designs/spec-to-design-map.md`：验证入口变化时更新 `ts-run-status-visibility` 行；设计导航目标不新增。

## 风险与取舍（Risks / Trade-offs）

- 未配置 `description` 的 failed/timed-out generic 节点及其 matching detail 将完全不出现在用户过程里。该结果是已确认产品语义；运行和诊断事实仍在后端历史中，不影响运维追踪。
- 规则以可信 `capabilityKind` 闭集区分 runtime Capability。如果未来新增 runtime Capability kind，必须先更新公共契约和现有 Capability 标题 resolver，再使其取得可见资格；未知 kind 默认不显示技术身份。

## 待确认问题（Open Questions）

无。
