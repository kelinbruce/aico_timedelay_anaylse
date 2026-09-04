## 背景和现状（Context）

当前 stable spec 和实现把 `lastSeenSequence` 当作必填 replay anchor：Web route 缺少 query 时会解析成 `0`，frontend stream transport 也总是把当前 cursor 拼进 URL。结果是页面刷新、换设备打开历史会话这类“没有当前页面内存 cursor”的场景，会被误表达为“从 session timeline 开头 replay”。

这和职责边界冲突：已提交历史应由 `GET /conversation` 的 visible `SessionMessage` 提供；实时增量、同页面断线恢复和 active run 未提交内容才由 stream 提供。当前 implementation-vs-spec gap 是：`ts-minimal-agent-kernel` 仍写着 channel 默认使用 `lastSeenSequence=0`，`RuntimeSessionStreamEventsQuery.lastSeenSequence` 仍是必填，runtime 因此没有 no-cursor live-tail 分支。

相关方包括 `agent-channel-web`、`agent-runtime`、`frontend/agent-web` 和测试/发布门禁。约束是：不新增 Web API 参数，不给 conversation response 加 cursor 字段，不恢复 sessionStorage stream cursor，不把 stream replay 真相放到 channel 或 frontend cache。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 把 `lastSeenSequence` 明确定义为数字型 session timeline cursor；字段出现时仍是 replay anchor，字段省略时不是 `0`。
- 让 session-scoped stream 在省略 `lastSeenSequence` 且没有 `requestId/runId` filter 时进入 live-tail，只订阅新事件，不 replay 旧 timeline。
- 保持显式 `lastSeenSequence=0` 的 replay 语义；带 `requestId/runId` 时仍是 run/request bounded replay。
- 让 frontend 普通打开/刷新/换设备访问历史会话时不发送 `lastSeenSequence=0`；activeRun bootstrap、submit/retry/edit recovery 和同页面断线恢复仍发送明确 anchor。
- 保持 request/run-scoped stream terminal 后可关闭、session-scoped stream terminal 后继续订阅的既有语义。

**非目标：**
- 不新增 `mode`、`replay`、`tail` 等 Web API 参数。
- 不把 `lastSeenSequence` 从数字改成对象。
- 不把 stream cursor 写回 sessionStorage、localStorage、URL 或 conversation DTO。
- 不引入长期双 stream 常驻模型；bounded run recovery 只是临时连接形态。
- 不改变历史消息最终来源，不用 stream replay 重建已提交 conversation history。

## 设计决策（Decisions）

### 1. Query 语义只区分“省略”和“显式数字”

选择：`RuntimeSessionStreamEventsQuery.lastSeenSequence` 和 Web delivery request 中的 `lastSeenSequence` 改为 optional。SSE/WS query 解析保留三态输入：省略、合法数字、非法显式值。旧的 `RuntimeEventStreamQuery` 保持显式 replay anchor 入口，不承载 no-cursor live-tail 语义，避免形成第二套 runtime stream 契约。

- 省略：字段不下沉到 runtime request。
- 合法数字：作为 session timeline replay anchor 下沉。
- 非法显式值：在 Web channel validation 阶段 fail safely。

放弃新增 `streamMode=live|replay` 的方案，因为它会扩大 public API 面，并让 mode 与 cursor 两个字段可能表达冲突。也放弃把省略转换为 `0` 的方案，因为这正是长历史刷新阻塞的根因。

### 2. Runtime 拥有 live-tail/replay 分支

选择：`agent-runtime` 是唯一解释 replay/live-tail 的 owner。`agent-channel-web` 只负责保留 query 是否省略、校验显式数字、投影 stream envelope；不得自己查 timeline 或维护 replay buffer。

Runtime 分支规则固定为：
- `lastSeenSequence` 存在：走现有 replay-then-live 路径，校验 anchor 属于当前 owner+agent+session timeline；`requestId/runId` 只作为过滤条件，不改变 sequence 的 session-scoped 语义。
- `lastSeenSequence` 省略且无 `requestId/runId`：走 no-cursor session live-tail，建立当前 session tail boundary，不读取并投影历史 events。
- `lastSeenSequence` 省略但带 `requestId/runId`：不是合法 bounded recovery；frontend 的 activeRun/accepted-run recovery 必须显式传 `0`，后端可按 validation 失败处理。

Live-tail 的 tail boundary 必须在 runtime 订阅建立时确定。实现不能先做全量 replay，也不能把 channel 层缓存当成 tail；订阅建立后的新 canonical timeline event 直接进入 subscriber queue，订阅建立前的历史事件不得为 no-cursor live-tail 被扫描、catch-up 或投影。

### 3. 冷启动固定为 conversation -> no-cursor live-tail -> opening reconcile

选择：页面刷新、新 tab、新设备或普通切换打开已有会话时，frontend MUST 先读取 conversation bootstrap，用 visible `SessionMessage` 建立历史视图；随后根据 bootstrap 结果打开 stream：
- conversation 返回 non-terminal `activeRun`：打开 `lastSeenSequence=0 + requestId/runId` 的 bounded run stream，恢复当前 run 未提交内容。
- conversation 未返回 `activeRun`：打开 no-cursor session-level live-tail，不发送 `lastSeenSequence`。

no-cursor live-tail 建立后，frontend MUST 做一次 opening conversation reconcile，用同会话 conversation refresh / newer refresh 覆盖初始 conversation snapshot 与 live-tail boundary 之间产生的 committed history 或 newly discovered `activeRun`，并与已经接收的 live envelopes 去重合并。该 reconcile 是打开/切换会话 bootstrap 的一部分，不是普通 terminal 后覆盖 live details 的路径。

放弃“先开 live-tail 并 buffer，再拉 conversation”的方案，因为它需要 frontend 在没有历史基底时缓存并排序 stream envelopes，再与 conversation 合并，会把 stream 变相变成冷启动历史来源；也会把 stream 连接失败耦合到首屏历史展示。选择 conversation-first 是为了保持历史来源单一，同时用一次 opening reconcile 补启动空窗。

### 4. Frontend 连接状态用现有输入派生，不新增接口字段

选择：frontend stream hook 只在已有明确 anchor 时传 `lastSeenSequence`：
- 普通打开/刷新/换设备且没有页面内存 cursor：先按 decision 3 完成 conversation bootstrap，再在 ordinary session-level stream 中省略 cursor。
- 同一页面已经接受 timeline-backed envelope 后断线重连：传当前页面内存 cursor `N`。
- conversation bootstrap 返回 non-terminal `activeRun`，且该 `requestId/runId` 尚未在当前页面 terminal observed：传 `lastSeenSequence=0 + requestId/runId`。
- submit/retry/edit 返回 accepted coordinates，但 session-level stream 当前未连接、断开、重连中、timeout/gap recovery 中，或该 submit 发生时 live-tail boundary 尚未可靠建立：传 `lastSeenSequence=0 + requestId/runId` 做 bounded recovery。
- session-level no-cursor live-tail 已 connected 但尚未收到 timeline-backed envelope 时，不得仅因为没有 in-memory cursor 就启动额外 bounded run stream；该 live-tail 已覆盖连接建立后的新 submit 事件。

这里不把 cursor 存到 sessionStorage。页面刷新后，普通历史由 conversation 负责；active run 由 activeRun bootstrap 负责。bounded run stream 结束后，frontend 清除 request/run filter，回到 session-level stream 规则：若当前页面已经有可信 session cursor，可用该 cursor 做同页面 resume；若没有可信 cursor，则省略 cursor 走 live-tail。

### 5. Terminal 后 UI 不用普通 conversation refresh 覆盖 live details

选择：terminal stream envelope 是当前 request 的收敛信号。普通 terminal 到达后，UI 从 live stream 本地状态收敛并保留已接受的 process details；conversation refresh 只用于 gap recovery、stream timeout recovery、手动刷新、打开或切换会话。

放弃“每次 terminal 后重新拉 conversation 覆盖 UI”的方案，因为 conversation 是已提交历史视图，process details 可能比 conversation DTO 更完整；用它做普通 terminal 收敛会造成 live 状态丢失或闪烁。

### 6. 规格修正不改变 request/run filter 的全局 sequence 语义

选择：`lastSeenSequence` 始终表示 session timeline 全局 sequence，不表示 run 内 sequence。`requestId/runId` 是 filter。断线重连时，如果页面在某个 run 内收到 sequence `N` 后断开，重连传的仍是 `lastSeenSequence=N`，runtime 只 replay `sequence > N` 且匹配 filter 的事件。

这个选择保留了既有 timeline 模型，避免引入 per-run cursor 或 cursor object。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不新增客户端可控 owner/agent 字段；显式非法 cursor 仍 fail safely；safe error 不泄漏 owner scope、agent scope、路径、prompt、model output 或 timeline payload。 | Web stream query negative tests、safe error projection tests、code review |
| 性能/容量 | 长历史普通打开不再被动 replay 历史 stream events；显式 replay 和 bounded run replay 保持可用。 | runtime no-cursor live-tail tests、frontend long-history refresh regression test |
| 可靠性/恢复 | 同页面断线仍用 numeric cursor resume；activeRun 和 accepted-run 仍可用 `0 + requestId/runId` 恢复未提交内容；cold-start 用 opening reconcile 补 conversation snapshot 与 live-tail boundary 之间的空窗；live-tail 不承诺恢复打开前历史。 | stream resume tests、activeRun bootstrap tests、accepted-run recovery tests、opening reconcile tests |
| 可维护性 | runtime 拥有 replay/live-tail 语义，channel 只保留 optional query，frontend 只决定是否有 anchor；不新增平行 DTO 或 mode 字段。 | architecture/code review、dependency checks |
| 可测试性 | 每个分支都有明确黑盒输入：省略 cursor、显式 `0`、显式 `N`、`0 + runId`、非法 cursor。 | Vitest contract tests、frontend transport/hook tests、OpenSpec strict validation |
| 审计/可追溯性 | 不新增日志/metric/audit 字段；stream sequence 和 terminal event 仍来自 canonical timeline。 | stream projection tests、redaction review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 省略 `lastSeenSequence` 不等于 `0` | 1, 2, 3 | Web channel query tests、frontend transport tests |
| no-cursor session stream live-tail 不 replay 历史 | 2 | runtime stream tests |
| 显式 `lastSeenSequence=0` 仍全 session replay | 2, 3 | runtime replay tests、SSE/WS contract tests |
| `0 + requestId/runId` 仍 bounded replay，filter 不重置 sequence | 2, 3, 4 | runtime filtered replay tests、activeRun bootstrap tests |
| 同页面断线用当前页面内存 cursor `N` resume | 4 | frontend hook reconnect tests |
| 普通刷新/换设备无 cursor 时不拼 `lastSeenSequence` | 4 | frontend stream URL tests、browser/session test |
| cold-start conversation 与 no-cursor live-tail 之间的空窗不丢不重 | 3, 4, 5 | frontend session bootstrap/reconcile tests |
| terminal 普通收敛不使用 conversation snapshot 覆盖 live details | 5 | frontend session stream tests |
| SSE/WS 对 optional cursor 的处理等价 | 3 | `tests/agent-kernel/web-stream-transports.test.ts` |
| OpenSpec delta 与稳定基线可合并 | 6 | `openspec validate fix-ts-session-stream-live-tail --strict`、`openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-core-contracts/spec.md`、`openspec/specs/ts-stream-resume-replay/spec.md`、`openspec/specs/ts-web-sse-ws-transports/spec.md`、`openspec/specs/ts-stream-history-consistency/spec.md`、`openspec/specs/ts-minimal-agent-kernel/spec.md`。
- API/SPI/event/schema 主承载：`openspec/designs/architecture/core-contracts.md`。
- Runtime replay/live-tail 和 timeline ownership 主承载：`openspec/designs/architecture/runtime-boundaries.md`。
- SSE/WS optional cursor 等价主承载：`openspec/designs/architecture/web-stream-transports.md`。
- Public envelope projection 主承载：`openspec/designs/architecture/stream-projection.md`。
- 模块职责：`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-channel-web.md`。
- ADR：不新增。该决策是 stream cursor 语义收窄，不需要独立长期 ADR。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] no-cursor live-tail 可能被误用成恢复机制。 -> 规格明确 live-tail 不恢复打开前历史；恢复必须使用 conversation、same-page cursor 或 bounded run replay。
- [风险] filtered run stream 的 sequence 容易被理解成 run 内序号。 -> 规格和测试固定 `lastSeenSequence` 始终是 session timeline 全局 sequence。
- [风险] live-tail tail boundary 处理不当会丢订阅建立期间的新事件。 -> runtime task 要求在订阅建立点定义 tail boundary，并用 focused test 覆盖；frontend cold-start 另用 opening reconcile 补 conversation snapshot 与 live-tail boundary 之间的 committed/activeRun 空窗。
- [风险] accepted-run bounded recovery 被误用为所有 no-cursor submit 的默认路径。 -> 规格明确 connected live-tail 只是在尚未收到 cursor 时仍可覆盖连接后的新 submit，不得额外启动 run-scoped stream。
- [取舍] 不加 conversation cursor 字段会让 frontend 自己判断是否已有页面内存 cursor。 -> 这避免扩大 conversation contract，且符合“conversation 只负责历史”的边界。
- [取舍] 保留显式 `0` 全量 replay 可能仍可触发大 replay。 -> 这是 intentional recovery/debug 语义；普通浏览器流程不得默认触发。

## 迁移计划（Migration Plan）

无数据迁移。发布步骤是先改 contract/runtime/channel，再改 frontend 拼参和恢复状态，最后更新测试。若发布后发现 live-tail 行为异常，可回滚代码实现；已提交数据和 timeline schema 不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-stream-resume-replay/spec.md`：合并 in-memory cursor、same-page resume、activeRun bootstrap 和 accepted-run bounded recovery。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 optional cursor、no-cursor live-tail、显式 replay 和 SSE/WS 等价。
- `openspec/specs/ts-stream-history-consistency/spec.md`：合并 conversation history 与 stream live details 的职责边界。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：删除“默认 `lastSeenSequence=0`”基线，改为 optional cursor。
- `openspec/specs/ts-core-contracts/spec.md`：合并 session-facing `RuntimeSessionStreamEventsQuery.lastSeenSequence` optional 语义，以及 no-cursor live-tail 和显式 replay anchor 的核心契约。
- `openspec/designs/architecture/core-contracts.md`：把 session-facing `RuntimeSessionStreamEventsQuery.lastSeenSequence` 的 optional 语义、显式数字 replay anchor 和 `requestId/runId` filter 语义提炼进去。
- `openspec/designs/architecture/runtime-boundaries.md`：提炼 runtime-owned live-tail/replay 分支和 tail boundary 规则。
- `openspec/designs/architecture/web-stream-transports.md`：提炼 SSE/WS optional cursor 等价和非法 cursor safe failure。
- `openspec/designs/architecture/stream-projection.md`：提炼 channel 不拥有 replay truth、不用 transport close 生成 terminal 的既有规则与本 change 的衔接。
- `openspec/designs/modules/agent-runtime.md`：提炼 runtime streamEvents 的 optional cursor 行为。
- `openspec/designs/modules/agent-channel-web.md`：提炼 channel 对 query omission 的保留职责。
- `openspec/designs/spec-to-design-map.md`：更新上述 specs 的设计导航和验证入口。

## 待确认问题（Open Questions）

无。
