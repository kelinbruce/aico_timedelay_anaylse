## 背景和现状（Context）

`frontend/agent-web` 的行为事实分散在组件、controller、store、service、runtime、Web route 和测试中。部分能力只留在已归档 change，没有进入当前 Stable specs；部分 Stable specs 又保留 `/clear`、raw tool command/result、API Key 配置、模型选择 UI 和错误的 browser-storage 细节等过期承诺。严格校验只能证明文档结构合法，不能证明 Stable 基线与实现一致。

本 change 的约束是：

- 初始 apply 只补 active change 的 proposal、design、tasks 和 delta specs；后续用户分轮授权后，title/Web API、前端长期说明、module/contract 设计和 spec-to-design map 已全部同步。
- 本轮反向规格与文档收口不修改生产 TypeScript、CSS、配置、依赖或运行时数据；只允许补充 characterization tests，或修正与当前 Stable/Active 行为冲突的 test harness 和陈旧断言。当前代码中已有的 edit durable visibility replacement 只作为规格事实来源。
- 不修改其他未归档 change。
- 不在用户未授权 archive 时修改 `openspec/specs/`；未被当前归档准备范围列出的跨模块设计继续保持不变。
- 当前实现与测试冲突时，产品代码决定“当前事实”，测试失败作为显式 debt 记录，不能反向虚构产品行为。

实现复核确认了以下不能被规格掩盖的事实：

- 缺少 `AICOService.Write` 时，Composer textarea 当前确实禁用；旧 Stable scenario 和一条旧测试仍声称可编辑。
- Mermaid 只有 `securityLevel: "strict"` 加有限 regex cleanup，不具备完整 SVG allowlist、危险 URI/CSS 清理、容量限制或安全日志保证。
- 当前产品代码已经移除 raw/parsed stream frame debug buffer 和 `ADNCLAW_STREAM_DEBUG` 入口；本 baseline 不再把已删除的 buffer 描述为当前实现或 Known divergence。
- `skill-selector-ui` Stable 当前自相矛盾地要求默认 `"skills"` 同时渲染和不渲染 Skill 栏，并把“全部”按钮写成 overflow-only；产品代码在 Skill 栏存在时始终渲染“全部”，目录标题为本地化“全部”且使用 20px 标题和副标题。
- background task control 已进入 Stable；当前 Stable 明确允许 seed-only `commandLine` 在存在时继续可用，同时禁止 timeline `BACKGROUND_TASK_*` payload 携带 raw command line。当前 list endpoint/UI 投影与该 Stable 边界一致，不构成本 baseline 的 Known divergence。
- automatic/manual title caller 虽传入 write key，但 gateway 的 existing-session save 不用该 key 建立 title-update replay anchor；manual Web route 每次调用还会生成新的 server key。因此当前标题写入不能被描述为 durable command idempotency。
- edit route 当前只接受 JSON：`attachments` 省略或为空时向 runtime 传 `attachmentIds=[]`，非空 `attachments` 和 multipart edit 都在调用 runtime 前被拒绝。Agent Web edit 不发送 locale；即使外部 JSON client 发送合法 locale，runtime 当前仍固定使用 `zh-CN`。前端会 trim 并拒绝 blank，但 Web schema 和 runtime 没有独立 whitespace-only guard。
- edit 的 `expectedLatestRequestId` 是 snapshot preflight，不是与 acceptance 合并的原子 CAS。
- 新会话入口当前只导航到根路由的 pre-session 状态，不持久化空会话。首次合法普通提交由 Composer controller 先建立并激活 session，再向该 session 提交 request；建立失败会阻断提交并保留输入，已有 route session 则直接复用。附件先绑定 session 的路径由 Attachment Composer owner 单独承载。

## 目标和非目标（Goals / Non-Goals）

### 目标

- 以当前实现和可重复测试为事实源，为 Composer、附件、根路由首次普通提交的会话建立、Turn Run Graph、Mermaid、会话标题和 edit-resubmit 建立准确的 change-local delta。
- 对现有 capability 做最小 delta 修订，删除已不存在的行为并修正权限、HFQ 点击、Skill selector 和 UI 测试门禁语义。
- 明确区分拟进入 Stable 的规范行为、其他 active change 拥有的目标、Implementation-only 事实与 Known divergence。
- 记录并完成归档前需要同步的长期用户说明、前端架构、模块设计和导航；Stable specs 仍只由后续普通 archive 应用。
- 收口本 baseline 引用的组件测试 harness 和陈旧断言，使归档决策基于当前可重复证据，而不是过期失败快照。

### 非目标

- 不修复 Mermaid sanitization、ProcessPanel compatibility fallback、title update durable idempotency、edit locale/whitespace guard 或 latest preflight 原子性。
- 本轮反向规格与文档收口不新增或改变任何 runtime、Web API、UI、样式、配置或依赖；只固化当前代码中已经存在的 owner、contract 和可观察行为。
- 不把其他 active change 规划中的行为提前写成当前事实。
- 不新增前端领域模型、服务、抽象层或 ADR。

## 设计决策（Decisions）

### 决策一：采用“实现 -> 测试 -> Stable/Active/Gap 分类”的单向提取

每条新增或修改的规范性行为必须先能定位到当前产品路径，再用测试作为可重复证据。测试与代码冲突时，以当前产品代码为实现事实，并把测试标为 stale debt。已归档 change 只用于发现遗漏和理解历史意图，不能直接复制为当前契约。

放弃“从 archive 直接恢复全部 spec”，因为这会重新引入 title terminal 触发、统一最短四字符、虚构 audit event、完整 Mermaid sanitization 等已不成立的行为。也放弃只写一份前端总说明而不补 delta specs，因为长期行为仍无法被 OpenSpec review 和归档机制管理。

### 决策二：按行为 owner 拆分七个新增 capability，只修改六个既有 capability

Composer、Attachment Composer、Turn Run Graph 和 Mermaid 是不同的用户交互与质量边界；session title generation、session title update 和 request edit-resubmit 分别具有独立 owner、校验与生命周期。因此建立七个独立 capability delta，不创建包罗全部 UI 的大规格。Composer capability 只拥有键盘、命令、历史召回和公开快捷键；通用 route-scoped 草稿生命周期继续归既有 `ts-run-status-visibility` owner。

HFQ、Skill selector、E2E UI、auth control、architecture test gate 和 run-status visibility 已有 Stable owner，采用精确 `ADDED`/`MODIFIED` delta，不建立平行 capability。`e2e-ui-interaction` 的既有 Session Management UI requirement 承载 pre-session 与首次普通提交的会话建立顺序：没有 active session 时必须先成功建立并激活 session，再提交首个 request；失败则不提交并保留输入，已有 active session 则不得重复建立。该契约不冻结 `createSession` service、HTTP endpoint、route shape 或 storage key，附件绑定顺序继续归 `agent-web-attachment-composer`。`ts-run-status-visibility` 只承载 route draft 存储、切换、降级和普通提交结果；edit 入口与恢复仍由 `request-edit-resubmit` 拥有。附件服务端 intake、session 状态和 stream transport 等已有规格只被引用，不重复定义。

这些 capability 在当前阶段仍是 **active change delta**；只有普通 archive 成功应用 delta 后，才成为 Stable specs。

### 决策三：会话标题以当前 acceptance-time 路径为唯一拟稳定语义

ordinary submit 已持久化并发出 `REQUEST_ACCEPTED` 后，runtime 使用本次 command input 启动 fire-and-forget 标题尝试。当前 runtime instance 通过 session set 和 session owner 结果避免继续覆盖；blank、slash、unsafe、missing 或异常允许后续 ordinary submit 再试。retry/edit 不触发该路径。标题尝试不等待 terminal，不查询 conversation history，不阻塞 scheduler、stream 或 terminal commit。

手动更新进入 session owner 后先 trim，再校验 trimmed title 为 1–100 字符且不匹配 XSS/secret pattern；空字符串和 whitespace-only 输入均拒绝，合法 1–3 字符标题允许保存。成功更新把 `titleSource` 固定为 `manual`，后续自动标题不得覆盖。Web route 还会在 session owner 前按 raw body 的 100 字符上限做 schema validation；frontend rename surface 在提交前 trim，因此三层边界不应被写成“空字符串清空”或“手工标题最短四字符”。

automatic/manual 调用点传入的 write key 不构成现有 session title update 的 durable replay anchor：gateway existing-session 分支覆盖记录并保留 session-create 的 `idempotency_key`，manual route 也不会接受客户端稳定 key。规格因此只承诺可信 scope、title source 和覆盖保护，不承诺跨实例 first-writer convergence 或重复命令无副作用。

放弃 archive 中“terminal 后读取最早可见用户消息”的旧语义，也不把 `isFirstRequest: true` 参数名解释成真实 first-request 门禁：当前调用点对每次 ordinary submit 都传 true，实际去重依赖 runtime-instance set 与 session owner 返回值。

### 决策四：edit-resubmit 由 runtime lane replacement lifecycle 主承载

runtime 负责 trusted owner/Agent scope、latest snapshot preflight、idempotency anchor、attachment authority、accepted checkpoint/event、same-session lane replacement、源请求消息可见性和 terminal semantics。它追加新的 visible USER message；新请求事实落盘并完成 older-lane replacement 后，通过 message store 的 owner+Agent+session+source-request scoped composite write，把源请求当前已持久化消息统一改为 `visible=false` 并记录 `EDIT_REPLACED`。该操作重复执行只补齐仍可见的源消息，不改写既有隐藏原因。

#### agent-contracts 变更确认

用户已于 2026-07-20 确认 edit 应由后端持久修改消息 `visible`。因此 `SessionMessageStoreGateway` 增加唯一的 source-request scoped composite operation；该 contract 不改变 Web edit DTO、stream envelope 或 message Record shape，只把已有 `VisibilityReason=EDIT_REPLACED` 应用于同一事务内的多消息可见性更新。

Web 只拥有 JSON transport validation 和 safe error mapping。当前 JSON edit 不接收 attachment ids，multipart edit 直接拒绝；internal runtime command 仍保留 attachment authority revalidation，但 browser edit 不可达该 file-bearing path。Agent Web 只在当前内存 conversation layer 中隐藏旧 root、插入临时 edited root、reconcile 或 rollback，并拥有 latest-turn affordance、编辑态草稿和失败时的附件恢复；非空附件队列会在 request service 层阻止 edit 调用。

因此：

- durable message 事实仍保留，但默认 conversation projection 不再返回被编辑替换的源请求消息。
- 本地 optimistic replacement 在成功后由后端 durable visibility 接管，因此刷新后保持一致。
- fresh edit 失败时不得隐藏源请求；等价 idempotent replay 必须修复已 acceptance 但 visibility 尚未完成的部分结果。
- latest preflight 不是原子并发权威。
- locale 和 whitespace-only runtime guard 不在本 change 中虚构为已完成。

### 决策五：Run Graph 和 Mermaid 只承诺可证明的有限安全边界

Run Graph 只对可追踪 process turn 提供入口，按 canonical event 顺序和相关坐标投影；边表示 display order，不宣称 causality。当前 graph answer node 只聚合 `LLM_CONTENT_DELTA`，不抢占 Stable structured-answer capability。详情不得暴露 raw chain-of-thought 或 raw event JSON，但任意 plain text 也不能因此被宣称为完整 safe projection。图失败时必须保留文本过程摘要。

当前 `CAPABILITY_RESULT_DELTA` projection 依次优先使用受支持的 `safeResult`、当前安全失败详情，以及非空且非通用的 `safeSummary`。缺少这些安全字段时，同一 ProcessPanel 仍可能进入 model argument、raw result parsing 或 raw/plain detail compatibility fallback；因此本 change 只把已交付的安全字段选择优先级写入 E2E Stable contract，不承诺通用摘要或 fail-closed。结构化结果由现有 Stable projection owner 承载，上述 compatibility fallback 仍是 Implementation-only/Known divergence。

Mermaid 只承诺完整 standalone triple-backtick fence、lazy render、stale result 隔离、通用失败降级和 viewport 通知。当前 `securityLevel: "strict"` 与有限 regex cleanup 记录为实现事实，不进入 sanitization requirement。危险 URI/CSS、malformed SVG、容量限制、审计和日志安全均不在本 change 中宣称已完成。

### 决策六：危险实现现状只登记为 Known divergence，不稳定化

当前代码已移除 raw stream debug buffer；Stable background-task contract 已明确允许 seed-only `commandLine`。这两项不是当前 divergence，不进入以下清单。

以下事实不能进入 Stable capability：

- ProcessPanel 当前仍可能展示 model argument、raw result parsing 或 raw/plain detail compatibility fallback；结构化投影由 Stable `tool-structured-delta` 与 `agent-web-structured-message-rendering` 拥有。
- title existing-session save 不使用调用方 write key 建立 durable title-update replay anchor。
- Mermaid cleanup 不构成完整 sanitization。
- edit latest preflight 非原子，locale 未透传，runtime 缺少 whitespace-only guard。

它们保留在 change 设计、review 结论和未来 follow-up 中。本 change 不通过改规格为这些风险背书。

### 决策七：不提前写 Stable specs，长期文档只按单独授权窄范围同步

OpenSpec 生命周期必须保持清晰：

1. 初始 apply 阶段只维护 `openspec/changes/establish-agent-web-existing-behavior-baseline/`。
2. 已分轮同步 `runtime-boundaries.md`、`agent-session.md`、`web-channel-api-surface.md`、`docs/apis/agent-web-api-list.md` 和前端长期说明的已确认事实。
3. 已同步 `core-contracts.md`、`agent-runtime.md`、`agent-channel-web.md`、`agent-platform-gateway-local.md`、`agent-web.md` 和 `spec-to-design-map.md`；这些文档保留当前 Active/Stable 状态，不提前应用 delta spec。
4. 普通 archive 应用 delta 时同步 `openspec/overview.md`：只将已验证的 latest-question text-only edit-resubmit 加入稳定基线，任意历史消息编辑、browser attachment edit 和批量编辑继续保持范围外。
5. 用户授权 archive 后，运行普通 `openspec archive establish-agent-web-existing-behavior-baseline`，由工具把 delta 应用到 Stable specs。
6. 归档前后均运行全量 strict validation。

不采用 `--skip-specs`。该选项会掩盖 apply 阶段提前手工写 Stable 的流程错误，使 delta 与 Stable 基线失去单一、可验证的合并点。

## 文档承载决策（Documentation Ownership）

当前 change 内：

- proposal：定义缺口、scope、capability 影响和生命周期边界。
- design：定义事实提取方法、owner 边界、排除项和 promotion plan。
- delta specs：承载拟进入 Stable 的可观察行为。
- tasks：承载当前 change-local 工作和验证证据。

已授权同步的长期文档：

- `docs/apis/agent-web-api-list.md` 承载手工标题 API 的 raw body 上限、session-owner trim、1–100 字符非空校验和安全错误语义。
- `web-channel-api-surface.md` 承载当前 bootstrap、submit、SSE/WS、title、edit 和 pending-input answer transport 入口。
- `runtime-boundaries.md` 承载 ordinary submit acceptance 后、session 未 resolved 前可重试的非阻塞 title 回调边界。
- `agent-session.md` 承载 automatic/manual title owner、校验和覆盖保护。
- `docs/frontend/README.md` 与 `docs/frontend/user-workflows.md` 承载用户工作流及 Stable/Active/Implementation-only/Known divergence 分类。
- `frontend/agent-web/ARCHITECTURE.md` 承载当前 package owner/status 边界，不复制 API schema。
- `docs/frontend/development.md`、`frontend/agent-web/README.md` 与测试追溯快照只维护到当前 API 清单位置的导航。

本轮已完成的其余归档准备：

- `core-contracts.md` 只承载 title/edit 跨模块导航，不复制 UI 或 API 细节。
- `agent-runtime.md`、`agent-channel-web.md` 分别承载 edit replacement owner 和 Web projection。
- `agent-platform-gateway-local.md` 承载 existing-session title write 的当前映射与非 durable replay-anchor 限制。
- `agent-web.md` 作为 Stable 前端 module owner，只补本 baseline 对 Composer、根路由会话建立、附件、Turn Run Graph、有限 Mermaid、title/edit UI 的最小长期职责，并合并 assistant Markdown 与 Pending Input UI 的独立 promotion；不重复 AICO、structured delta 或 Expand Panel 已有事实。
- `spec-to-design-map.md` 已同步 capability 到设计、实现和验证入口的索引。

## 风险与取舍（Risks / Trade-offs）

- 把危险现状写成 Stable 后可能被误认为安全批准。缓解：Mermaid cleanup、ProcessPanel compatibility fallback 和 title non-durable write key 只登记为 Known divergence；已删除的 stream debug buffer 与 Stable 明确允许的 seed-only `commandLine` 不再误列为偏差；E2E delta 只承诺当前已交付的 `safeResult`/`safeSummary` 选择优先级。
- 当前代码与旧测试冲突可能导致按测试写出错误规格。缓解：产品代码决定当前事实；失败按 Provider harness debt 或真实 spec drift 分类并保留数量和原因。
- active change 可能同时计划修改同一长期文档。缓解：每轮只修改已授权文件，并按 requirement 而不是 capability 目录名判断冲突。当前扫描中，`stabilize-agent-web-popup-and-scroll` 与本 baseline 对 `e2e-ui-interaction`、`skill-selector-ui` 的 requirement 名称互不重叠；`refine-session-title-and-search-validation` 的 title 实现已经进入当前代码，其 title delta 在本 baseline 归档后将成为重复描述，后续处理该 change 时必须删除或重基于 Stable title requirement，不得再次覆盖当前代码事实。本 baseline 不修改这两个 active change。
- 规格可能过度冻结组件内部细节。缓解：不写 storage key、test id、localId、debounce、CSS helper 或 raw component state，只写可观察行为和跨层 contract。
- title archive 历史可能被错误恢复。缓解：明确 automatic title 的 acceptance-time、command input、短 fallback、无 audit-event，以及 manual title 的 trim、1–100 字符非空校验和 blank rejection 当前事实。
- edit transport 可能被误写成支持 JSON attachment ids、multipart files 或 locale 透传。缓解：明确 JSON 只允许空 attachments、multipart edit 被拒绝，并把 runtime 固定 `zh-CN` 登记为未解决偏差。
- 手工提前同步 Stable 会造成普通 archive 重复应用 delta。缓解：仍不修改 Stable specs；本次长期文档同步不复制 delta，未来只使用普通 archive 应用规格。

## 迁移与归档计划（Migration / Archive Plan）

### 当前已授权阶段

- 完成 proposal、design、tasks 和 13 个 capability delta。
- 逐条将 delta 与当前实现、测试、HEAD Stable owner 和其他 active changes 对照。
- 保持 `openspec/specs/`、生产代码和其他 active changes 不变；只补 characterization tests，长期 docs/designs 只修改每轮明确授权的范围。
- 运行 change strict、全量 strict、diff check 和 workspace boundary review。

### 归档前阶段（已获授权并完成文档 promotion）

- 已按 proposal 的 Baseline Promotion Plan 更新跨模块/模块设计和 spec-to-design map。
- 已重新审查仍 active 的 changes；`agent-web.md` 按 Stable module owner 做最小合并，没有覆盖其他 change 的专属行为。
- 已重新运行实现证据和全量 strict validation；frontend build、全量 frontend Vitest、OpenSpec、architecture lint 和定向 title/edit/Markdown/Pending Input 路径均通过。

### 归档阶段（当前门禁已通过，未执行）

- 本 baseline 引用的组件测试、frontend build、全量 frontend Vitest、影响范围内验证和仓库架构门禁均绿色后，运行普通 `openspec archive establish-agent-web-existing-behavior-baseline`。
- 确认七个新增 capability 和六个修改 capability 的 delta 被正常应用。
- 不使用 `--skip-specs`。
- 归档后再次运行 `openspec validate --all --strict` 并检查长期导航。

### 回滚

当前阶段的回滚只需撤回本 change 目录及各轮授权的长期文档，不影响 runtime、Stable specs、代码或其他 active change。未来其余归档准备的长期文档变更仍应与本 change promotion 保持单一职责并可独立 review。

## 验证证据与已知债务

- 当前刷新（2026-07-18）：frontend package build 通过；第一批指定的 9 个测试文件 / 152 项全部通过，其中完整 `chat-page.route-state.test.tsx` 为 80/80；再合并 Markdown rendering 与 Pending Input 自有验证后，最终聚焦范围为 13 files / 216 tests 全部通过。继续收口 Sidebar、TurnBlock、PIU、annotation 等测试装配后，默认并发的全量 frontend Vitest 连续两次为 278/278 test files、1101/1101 tests 通过，0 failed、0 skipped。
- 第二批失败均由缺少当前 `AppProviders`、图标/API/host service mock 漂移、ProcessPanel 文件内状态未清理或陈旧可观察行为断言造成；修复仅触达 test helper、mock 和断言，`src` 下唯一 diff 是 co-located `MessageInputAssociation.test.tsx`，无生产实现 diff，也未修改 Stable specs 或非本轮复核的 active change。
- 历史快照（2026-07-17）的 frontend package build 曾因 `conversationAdapter.ts`、`requestStore.ts` 和 `safeCapabilityResult.httpResponse.test.ts` 共 4 个 TypeScript error 失败；这些错误已修复，仅作为历史证据保留。
- 历史快照中 Composer panel、command catalog、draft cache、Run Graph 和 process projection 为 4 files / 72 tests 通过；`processDetailsProjection.test.ts` 的 stale `FAILED` detail 断言已按当前投影结果修正，且未扩大 `safeResult`/`safeSummary` 契约。
- title extraction 34 项、local-gateway session title 8 项通过。
- Web multipart/edit route 7 项、runtime acceptance/supersede 4 项通过；frontend `requestService`/`requestStore` 67 项通过，其中覆盖 JSON text-only edit、non-empty attachment guard、optimistic replacement 和 failure rollback。
- assistant Markdown 11 项、Pending Input UI 定向 9 项、lazy Mermaid 5 项通过。
- 根路由 route-state characterization tests 证明 pre-session 不提前建立会话、首次普通提交严格先建立会话再提交、建立失败保留输入且不提交，以及已有会话不重复建立。
- 历史快照中 `MessageInput.attachments.test.tsx` 5 项、`MessageInput.edit.test.tsx` 4 项和 `TurnBlock.mermaid-scroll.test.tsx` 5 项因缺少 `AppProviders` 失败；当前已复用同一 test helper 装配当前 Provider，三文件 14/14 通过。
- API schema coverage 的 2 项失败来自其他 active remote-upload route 尚未进入 API inventory/schema；gateway broad file 的 4 项失败位于 Todo、blob 和 conversation annotation，与本 title/edit 定向 8 项无重叠。它们不被计为本 change 通过证据。
- 历史快照中 `SkillSelector.test.tsx` 的 4 项失败仍断言旧 `skill-selector-bar`、overflow-only “全部”按钮和旧标题“全部skill”；当前已按实现与 delta spec 统一为 `skill-bar`、始终可用的“全部”入口和本地化标题，整文件 19/19 通过。
- change strict 和全量 strict 均通过，当前全量为 203/203；这只能证明 OpenSpec 结构/引用合法，不能替代上述实现语义复核。
- 合并最新 main 后，本次归档准备通过三个自有 change strict、全量 strict 207/207、frontend build、全量 frontend Vitest、architecture lint 和 `git diff --check`；architecture lint 为 dependency 0 违规、package manifest policy 通过、34 files / 207 tests 通过。
- 原 `requests.ts` 和 `memory.ts` 的 4 条 architecture lint 违规已由对应 committer 在 main 上修复，本 baseline 未接管或修改该实现；当前未执行 archive 仅因为本轮同步与推送不包含 archive 授权。

## 归档前更新基线（Baseline Promotion Plan）

- 普通 archive 应用七个新增 capability 和六个现有 capability delta。
- `openspec/designs/architecture/core-contracts.md`、`openspec/designs/modules/agent-runtime.md`、`agent-channel-web.md`、`agent-platform-gateway-local.md`、`agent-web.md` 和 `openspec/designs/spec-to-design-map.md` 已完成长期 owner、边界与导航同步。
- `openspec/overview.md` 在 archive 应用 delta 时增加已验证的 request edit-resubmit 稳定入口，并将“完整 edit 用户控制”的范围外表述收窄为任意历史消息编辑、browser attachment edit 和批量编辑等未稳定能力。
- ADR 无更新；本 change 不引入新技术取舍或 owner 迁移。

## 待确认问题（Open Questions）

无。Mermaid/ProcessPanel 安全缺口、title update durable replay anchor、edit latest 非原子竞态、locale 传播和 whitespace-only guard 均明确属于后续独立工作，不是当前授权阶段的开放设计选择。raw stream debug buffer 已从当前代码删除，seed-only `commandLine` 已由 Stable background-task contract 明确允许，二者不再作为本 baseline 的 deferred 风险。归档证据中的测试 harness 与陈旧断言已转为当前可执行的验证收口任务，不再作为 deferred 产品能力。
