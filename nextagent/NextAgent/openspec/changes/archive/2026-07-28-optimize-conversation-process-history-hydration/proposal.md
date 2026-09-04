## 背景与问题（Why）

已完成会话由 visible message history 与 run event history 组合恢复：message 提供用户输入、最终回答和 capability result，event 提供 completed thinking 与过程顺序。当前 agent-web 在每次 message window 加载后，把窗口内全部 display run 立即标记为 `LOADING` 并逐 run 查询 event。长会话快速翻页、滚动或锚点跳转时，经过但未稳定可见的 run 会形成无界待执行工作；每个 run 返回又触发会话级过程投影重建。结果是 event 请求集中、界面卡顿、加载状态闪烁，并可能出现 run 状态仍为 `AVAILABLE` 但对应 think 已被全局 envelope 容量裁掉的半失效状态。

会话预览轨、主对话视口和过程面板代表不同强度的用户意图。仅按 message window 判断“可见”无法区分预览悬停、快速拖动经过、稳定阅读和主动展开，因此必须把 process history hydration 收敛为由最新用户意图和真实视口驱动的有界调度。

## 术语

- **hydration target**：需要查询或复用 process history 的 `sessionId + runId`，并携带来源、优先级和当前导航/视口 generation。
- **真实视口**：主对话滚动容器中实际与可视区域或其受控缓冲区相交的 TurnBlock 集合，不等同于已加载 message window。
- **load outcome**：一次未被 session teardown 取消并正常结算的 run event history 加载终态，且只能是 `AVAILABLE`、`FAILED` 或 `LEGACY_UNAVAILABLE`；session teardown cancellation 不产生 UI outcome。
- **pinned run**：由当前 `VIEWPORT`、`PRELOAD`、current preview、active request/live run 选中的 run；panel expansion 只在对应 load outcome 到达前提供显式 target/pin。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 长会话通过预览点击、滚动条拖动、鼠标滚轮或页面刷新进入历史区域时，agent-web 只查询当前用户意图和真实视口需要的 process history。
- 同一会话的 event 请求、待执行目标和缓存保持有界；同一 run 不重复并发查询，过期目标不得形成持续积压。
- 每个 session 的 automatic target 与 explicit target 分别最多十六个；target replacement 和 generation supersession 只移除 queued/not-started work。所有来源已经 started 的 run-event request 在 session 存续时由 active-request pin 保留到正常 load outcome，只有 session teardown 可以取消。
- message、最终回答和页面定位不等待 event；process history 失败不影响 committed conversation。
- 已成功加载的 run process history 在缓存有效期内稳定可见，不出现 `AVAILABLE` 状态与 think/event 数据分离。
- 页面刷新或冷历史加载期间，折叠的“执行详情”标题和布局保持稳定；短暂后台加载不产生可见文案闪烁。
- local、immersive 和 collaborative host 复用同一 hydration、投影和失败语义。

**非目标：**

- 不修改 think 持久化、`LLM_THINKING_DELTA`、run event REST API、event 分页或 runtime/session/gateway persistence owner。
- 不新增批量 event 查询接口，不把 event history 加入模型上下文或 prefix cache。
- 不改变 conversation preview API、marker 内容、预览概要安全边界或页面刷新后的 message 定位规则。
- 不持久化刷新前的浏览器滚动坐标或 process history 浏览器缓存。
- 不修改 live stream 的过程投影、自动折叠时序或 completed thinking 语义。

## 变更范围（What Changes）

- 修改 agent-web 的 cold-history hydration 触发边界：从已加载 message window 中全部 display run，改为用户明确目标、真实视口和受控缓冲区产生的 hydration target。
- 新增会话级有界调度行为，统一处理预览点击、过程面板展开、滚动条拖动、鼠标滚轮和刷新首屏产生的目标；目标按用户意图排序，过期 generation 只移除未启动目标，已启动请求正常结算但不得恢复旧 target、preview pin 或 navigation。
- 修改 process history 浏览器缓存和 turn 投影边界，使 run 状态与 event envelopes 原子保留或淘汰，并由对应 TurnBlock 局部组合 message 与 event facts。
- 修改 cold-history 加载呈现：折叠标题保持稳定，短暂后台加载不替换标题；用户主动展开时在面板内部呈现加载状态，失败和重试仍明确可见。
- 明确唯一结果提交与 lifecycle：同 run coalesce 为一个 active request identity；session 存续且 completion 仍匹配该 run 登记的 active identity 时，validated outcome 可提交 run-scoped cache，即使原 target generation 已被替换；只有 teardown 或 identity 不匹配的 late response 丢弃。正常 outcome 释放 active slot/pin，且不得恢复旧交互意图。
- 增加长会话、快速导航、缓存淘汰、失败降级和多 host 一致性的自动化验证。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-stream-history-consistency`：修改 Browser history hydration 的目标选择、调度、缓存和局部投影行为。
- `session-conversation-preview`：明确 preview hover 与 click 对 process history hydration 的不同触发语义。
- `agent-web-process-panel`：修改 cold-history loading 的稳定标题、主动展开和失败呈现行为。
- `agent-web-multi-host-modes`：明确三种 host 共享同一 process history hydration 行为。

## 影响范围（Impact）

- 主要写入范围为 `frontend/agent-web` 的 conversation store、history adapter、ChatPage/MessageList/TurnBlock/ProcessPanel 交互和相关测试。
- 现有 run event 查询 client 和 `StreamEnvelope` 校验继续复用，但调用时机、取消和缓存消费者发生变化。
- 前端容量与浏览器交互测试需要覆盖大量历史 turn、滚动/跳转竞态、慢请求和乱序返回。
- Web API、后端 package、数据库 schema、配置文件和部署接口不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-history-consistency/spec.md`：更新 browser history hydration、容量和失败隔离要求。
- `openspec/specs/session-conversation-preview/spec.md`：更新 preview 交互与 process history hydration 的协作要求。
- `openspec/specs/agent-web-process-panel/spec.md`：更新 cold-history loading 呈现要求。
- `openspec/specs/agent-web-multi-host-modes/spec.md`：更新多 host 一致性要求。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/conversation-ui-state.md`：提炼 hydration target、调度、缓存与投影边界。
- `openspec/designs/modules/agent-web.md`：更新 agent-web conversation history 职责和验证入口。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：更新受影响 stable specs 的设计导航。

长期基线更新由归档流程执行，不是实施阶段默认任务。
