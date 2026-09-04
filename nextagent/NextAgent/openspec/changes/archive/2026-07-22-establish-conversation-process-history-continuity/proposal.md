## 背景与问题（Why）

父 change `refine-session-thinking-presentation-contract` 已把 thinking 明确为 run timeline event，并提供 run-scoped event history API、final `LLM_THINKING_DELTA` 持久化、shared `StreamEnvelope` projector 与 fork snapshot。当前 `agent-web` 仍只把 conversation message page 转成 history envelopes，没有根据 message 的 `runId` 查询 event history。因此 live 阶段可见的 thinking 和执行步骤在刷新、重新打开、分页加载或 fork child 历史中仍不会进入过程面板，前端尚未兑现 live 完成态与 cold history 的最终一致性。

当前 `ProcessPanel` 已具备面板级 auto-expand/auto-collapse、条目手动展开和新条目 auto-expand，但已完成条目会一直展开到整个 run 结束。长链路网络诊断中，多个 thinking 与能力步骤同时占据大量纵向空间，用户难以识别当前执行位置；thinking 完成、工具完成、用户手动覆盖及 reduced-motion 的行为也没有统一状态机。

本 change 在不改动后端事实、event 类型、message 模型、fork 语义和模型上下文的前提下，完成前端 history hydration 与过程面板交互，使用户在 live 结束后刷新或打开历史对话仍能查看相同的最终过程，并在执行期间聚焦当前步骤。

## 变更范围（What Changes）

- `agent-web` 增加 run event history client，固定调用父 change 已定义的 `GET /api/v1/sessions/:sessionId/runs/:runId/events`，对 `AVAILABLE` 页面按 `nextAfterSequence` 有界拉取全部页，对 `LEGACY_FORK_PROCESS_HISTORY_UNAVAILABLE` 显示明确的过程历史不可用状态。
- Conversation store 以当前已加载 message window 为边界，对每个 root turn 优先选择最后一个可见 assistant message 的 `runId`；没有 assistant 时回退到最后一个可见非 summary message 的 `runId`。Distinct runs 去重、取消并发 event 请求，返回的 `StreamEnvelope` 标记为 history layer 后与 message-derived envelopes 合并。加载更早、更新或 anchored conversation window 时只同步对应可见 runs，不预取整场 session。
- Event history 失败不得清除或阻塞已提交的 user/assistant messages；对应 turn 显示可重试的过程不可用状态，不把失败伪装成“没有过程”。重试、切换 session、重复加载和过期响应必须保持 run 隔离，不混合 attempt。
- Live stream 与 history REST envelope 进入同一套 `buildTurnBlocks`、`buildProcessEntries` 和 `ProcessPanel` 投影；前端不建立第二套 thinking、capability 或排序模型，也不从 terminal event 重建 final answer。
- Capability lifecycle/order 来自 event history，完整 durable result content 继续来自同 run/tool correlation 的 `CAPABILITY_RESULT` message；缺少result message时显示安全不可用状态，不把terminal status冒充工具结果。
- `ProcessPanel` 增加条目级 auto lifecycle：新 running 条目自动展开；`metadata.completed=true`的thinking envelope或capability terminal使对应条目在800ms后自动折叠；新active条目不强制关闭用户手动展开的其他条目。
- 用户手动展开或折叠某条目后，该条目的 auto 行为在当前 run 内冻结；新 run 使用新的 root message scope，恢复默认 auto 行为。面板整体在 run 终态后沿用现有 150ms auto-collapse，用户再次展开时原始过程条目仍可查看。
- 条目展开/折叠使用现有 200ms transition；`prefers-reduced-motion: reduce` 时立即切换，不执行延迟视觉过渡，但状态结果保持一致。
- local、immersive、collaborative 三种宿主复用同一 conversation store、history adapter、turn projection 和 `ProcessPanel`；不得出现 host-specific history 或折叠实现。
- 不新增或修改 backend Web API、`agent-contracts`、runtime、gateway、timeline persistence、fork snapshot、ActiveContext、provider request或prefix cache。
- 不在本 change 实现 thinking/answer 脱敏、限长、截断、externalize、分享过程、旧数据回填、管理员策略或“隐藏 think”配置。

## Capability 影响（Capabilities）

### 修改的 Capability

- `ts-stream-history-consistency`：补充 browser client 如何按 visible run hydrate event history、与 message history 合并、隔离失败并保持 live/cold 完成态一致。
- `agent-web-process-panel`：补充条目级 auto-expand/auto-collapse、用户手动覆盖、history 默认态、终态可回看和 reduced-motion 行为。
- `agent-web-multi-host-modes`：明确三种宿主必须通过共享 chat core 获得相同的过程历史 hydration 和折叠行为，并增加对应旅程验证。

## 影响范围（Impact）

- 前端代码：`frontend/agent-web/src/services/sessionService.ts`、`src/state/contracts.ts`、`src/state/conversationStore.ts`、conversation/history adapters、`ProcessPanel.tsx`、必要的 turn projection 与国际化文案。
- Public API：只消费父 change 已存在的 run event history API，不改变 URI、query、response 或后端 owner。
- 状态与容量：event history 只保存在 browser session 的 history layer；按当前 message window 中 distinct run 数拉取，使用请求去重、AbortSignal 和有界分页，不引入全 session 无界预取或浏览器持久化。
- 安全：event page 在 browser HTTP trust boundary 校验 availability、cursor 和每个 public `StreamEnvelope`；不读取 raw timeline record、gateway DTO、provider payload、prompt 或 source lineage，也不把raw HTTP error保存到可渲染状态。
- 可靠性：message history 与 event history 独立成功；event 失败使用显式 per-run 状态和重试，session 切换或新 load version 丢弃过期结果。
- 测试：补充 service URL/pagination、store hydration/merge/race/failure、process entry state machine、TurnBlock/ProcessPanel component tests，以及 local、immersive、collaborative 共用旅程的 Playwright gate。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-stream-history-consistency/spec.md`：合并 browser-side run history hydration、失败隔离和 live/cold convergence 需求。
- `openspec/specs/agent-web-process-panel/spec.md`：合并条目级 auto lifecycle、manual override、history 默认态和 reduced-motion 需求。
- `openspec/specs/agent-web-multi-host-modes/spec.md`：补充三宿主共享过程历史与交互一致性场景。

长期背景：
- `openspec/overview.md`：补充 message history 与 process event history 在浏览器端组合后形成完整会话体验的稳定目标。

设计视图：
- `openspec/designs/architecture/conversation-ui-state.md`：补充 message window 驱动的 run event hydration、history/live layer 合并、失败状态和并发取消流程。
- `openspec/designs/modules/agent-web.md`：补充 session service、conversation store、turn projection 与 ProcessPanel 的职责分工。
- `openspec/designs/adr/<id>.md`：无；本 change 延续父 change 已确定的 message/event 分离与 shared projector 决策，不新增长期架构取舍。
- `openspec/designs/spec-to-design-map.md`：增加上述三个 capability 到 conversation UI architecture、agent-web module 和验证入口的导航。

验证入口：
- `frontend/agent-web` service/store/projection/component Vitest。
- `frontend/agent-web` TypeScript build 与 `build:vite:modes`。
- local、immersive、collaborative process history Playwright journey。
- `openspec validate --all --strict` 与 agent-web architecture ownership checks。
