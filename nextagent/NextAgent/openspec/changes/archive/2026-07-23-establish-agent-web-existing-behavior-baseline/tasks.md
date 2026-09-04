## 1. 事实基线与增量规格

- [x] 1.1 完成 implementation、Stable specs、active changes、archive changes 和测试的前端覆盖映射，区分拟稳定行为、其他 active owner、Implementation-only 与 Known divergence。
  验证：逐项检查 `frontend/agent-web/src`、`packages/agent-session`、`packages/agent-runtime`、`packages/agent-channel-web`、HEAD `openspec/specs`、未归档 `openspec/changes` 和 archive 证据。
- [x] 1.2 初始创建七个新增 capability 与五个既有 capability 的 change-local delta specs，确保每条规范行为有当前实现证据且不复制其他 active change owner。
  验证：`openspec status --change establish-agent-web-existing-behavior-baseline --json`；逐个 delta spec 与实现及测试做 requirement-by-requirement review。
- [x] 1.3 修正 Composer draft 的 Stable owner，把通用 route-scoped 草稿生命周期归并到既有 `ts-run-status-visibility`，使当前总数成为七个新增 capability 与六个既有 capability delta。
  验证：完整重述 `Frontend local view state MUST remain visually and navigationally stable` requirement；保留原 scrollbar/session-list 场景，补 root-route draft、route 隔离、storage 降级及普通提交成功/失败语义；`agent-web-composer-interaction` 不再定义平行 draft requirement，edit 入口特有恢复继续由 `request-edit-resubmit` 拥有。

## 2. Delta 语义复核

- [x] 2.1 复核 Composer、Attachment Composer 和 Skill selector delta。
  验证：对照 `MessageInput.tsx`、`commandCatalog.ts`、`ShortcutRegistry.ts`、composer controller、`attachmentRules.ts`、request store、`QuickOperatorArea.tsx`、`SkillSelectorBar.tsx`、`ChipBar.tsx`、`SkillCatalogModal.tsx` 及对应 tests；确认 local ready queue 未被写成 server uploaded，权限和批次失败语义与实现一致；默认 Skill 入口、“全部”始终存在及当前 Modal 标题/样式与产品代码一致。
- [x] 2.2 复核 Turn Run Graph 和 Mermaid delta。
  验证：对照 run graph view state、panel、diagram、assistant markdown 与 lazy Mermaid tests；确认 graph edge 只表示显示顺序，不宣称因果；plain text 不被泛化为完整 safe projection；Mermaid Stable requirement 不接管 SVG sanitization。
- [x] 2.3 复核 session title generation/update 和 request edit-resubmit delta。
  验证：对照 submit/session preparation、title extraction、session owner、gateway existing-session save、runtime command、Web JSON-only edit route、multipart rejection、request store/route-state edit tests；确认 acceptance-time title、title write key 非 durable replay anchor、本地 optimistic hide、internal attachment revalidation、browser text-only edit、非原子 latest preflight、固定 locale 和 whitespace guard 缺口均被准确表达。
- [x] 2.4 复核 HFQ、E2E UI、auth control 和 architecture test gate delta。
  验证：确认 HFQ fill-only、backend-selected SSE/WebSocket、Capability result 的 `safeResult`/安全失败详情/`safeSummary` 选择优先级、缺少安全字段时的 compatibility fallback 不被稳定化、无 API Key/model UI、textarea/stop Write gate、`/help` catalog 与 disabled submit guard 的区别、explicit `ops:null` 语义、host-specific gate 缺口、无 `/clear` 和去除 test-id/storage-key 伪稳定细节。

## 3. 验证与审查

- [x] 3.1 运行实现证据测试并区分通过项与既有债务。
  验证记录：
  - frontend package `npm run build` 通过。
  - Composer panel、command catalog、draft cache、Run Graph、process safe projection：5 个文件、80 项通过。
  - title extraction 34 项、session title local-gateway 8 项通过。
  - `SkillSelector.test.tsx`：15 项通过、4 项失败；失败均为旧 `skill-selector-bar` test id、overflow-only“全部”按钮或旧“全部skill”标题期望，与当前产品代码冲突。
- [x] 3.2 对初始 proposal、design、tasks、12 个 delta、HEAD Stable owner、其他 active changes 和实现证据做独立语义 review。
  验证：结论必须为 PASS 或 PASS WITH FOLLOW-UP；修复所有 P0/P1 以及本 change 范围内 P2，并列出明确不稳定化的实现 gap。
  初始结果：PASS WITH FOLLOW-UP；当时记录为本 change 内 P0=0、P1=0、P2=0。已补 `skill-selector-ui` 缺失 delta，收窄 Run Graph structured answer、Capability result、title durable idempotency、Composer history modifier 和 `/help` 权限语义，并移除对 `agent-web-selfdefine-config`、`add-ts-tool-structured-delta`、`add-ts-expand-panel` 的 ownership 抢占。后续 3.7 复核发现 Capability result 仍把未交付的 fail-closed 写成规范性行为，已按当前实现再次收窄。
- [x] 3.3 完成初始 apply 的严格校验与工作区边界检查。
  验证：`openspec validate establish-agent-web-existing-behavior-baseline --strict`；`openspec validate --all --strict`；`git diff --check`；`git status --short`。最终只能保留本 active change 和用户已有的无关未跟踪文件，不得修改 `openspec/specs/`、长期 docs/designs、代码或其他 active change。
  初始 apply 结果：change strict 通过；全仓 strict 198/198；frontend package build 通过；tracked/staged diff 为空；change-local 文件无 trailing whitespace；工作区只保留本 active change 和两个既有无关未跟踪 HTML 报告。`openspec/specs/`、长期 docs/designs、代码及其他 active changes 均未修改。
- [x] 3.4 完成本次用户授权的窄范围归档准备和修改后独立语义 review。
  验证：只同步 `runtime-boundaries.md`、`agent-session.md`、`web-channel-api-surface.md`、当前位于 `docs/apis/agent-web-api-list.md` 的 API 清单中的 title/Web API 事实；运行 change strict、全量 strict、`git diff --check`、允许文件边界检查，并复核 draft 单一 owner、13/7/6 统计、title 语义和 route/method/transport 路径。
  结果：独立 review 首轮发现 Composer Escape 场景重复承诺 edit draft 恢复，以及 3.3 历史验证快照时间口径不清；均在授权文件内修正后复核。最终 P0=0、P1=0、P2=0、P3=0，结论 PASS。change strict 通过；全仓 strict 198/198；`git diff --check` 通过；13 个 delta 中 7 个新增、6 个修改；tracked diff 仅含四个获授权长期文档，Change 内只触达 proposal/design/tasks、Composer delta 和新增 run-status delta；代码、测试、Stable specs、其他 active changes 与两个既有 HTML 报告均未修改。

- [x] 3.5 刷新前端长期说明、API 导航和当前 owner map。
  验证：把 `docs/frontend/README.md`、`docs/frontend/user-workflows.md`、`frontend/agent-web/ARCHITECTURE.md` 中本 baseline 涵盖的行为标为 Active；把已归档 AICO、structured delta、Expand Panel 和 turn-granularity favorite list 标回 Stable；区分收藏数据与精确定位交互；把 delta spec 中 quick-info、structured answer、Expand Panel 与 Skill directive 的 owner 引用更新为现有 Stable capabilities；将自有文档中的 API 链接统一到 `docs/apis/agent-web-api-list.md`。完成后运行 Markdown 链接扫描、三个自有 change strict、全量 strict、API 文档对齐测试和 `git diff --check`。
  结果（2026-07-17）：长期说明和 change-local owner 引用已按当前仓库状态刷新；6 份前端/测试追溯 Markdown 的本地链接全部可达；三个自有 change strict 全部通过；全仓 strict 202/202；API 文档对齐测试 1 file / 4 tests 通过；`git diff --check` 通过。代码、Stable specs、其他 active change 和三个既有 `docs/reports/*.html` 均未修改。

- [x] 3.6 按归档时实现重新收窄 edit attachment transport，并完成剩余长期设计 promotion。
  验证：`request-edit-resubmit`、`agent-web-attachment-composer`、API 清单和 frontend workflow 必须与当前 JSON-only edit route、multipart rejection、前端 non-empty attachment guard 及 internal runtime revalidation 一致；只同步 promotion plan 指定的 `core-contracts.md`、`agent-runtime.md`、`agent-channel-web.md`、`agent-platform-gateway-local.md`、`agent-web.md` 和 `spec-to-design-map.md`；运行三项 change strict、全量 strict、定向实现测试、Markdown 链接检查、`git diff --check` 和范围检查。
  结果（2026-07-17）：上述六份长期设计已最小同步；edit 文档与当前 JSON-only/multipart rejection 实现一致；三个 change strict 和全仓 202/202 通过，Markdown 本地链接与 `git diff --check` 通过。定向 Web edit 7 项、runtime 4 项、title 42 项、frontend request service/store 67 项、assistant Markdown 11 项、Pending Input 9 项通过。归档门禁仍被 frontend build 4 个 TypeScript error、`MessageInput` 9 项和 Mermaid scroll 5 项缺少 `AppProviders` 的 harness failure 阻塞；另有 process projection 1 项 stale 文案断言。均未跨范围修改。

- [x] 3.7 按当前 ProcessPanel 实现收窄 Capability result 投影契约。
  验证：`e2e-ui-interaction` 只承诺存在受支持 `safeResult`、当前安全失败详情或非通用 `safeSummary` 时的选择优先级；缺少这些字段时的 model argument、raw result parsing 和 raw/plain detail fallback 只登记为 Implementation-only/Known divergence；proposal、design、tasks 与 delta spec 使用同一边界；运行 change strict、全量 strict、相关文本残留扫描、`git diff --check` 和工作区范围检查。
  结果（2026-07-17）：已删除未交付的通用摘要和 fail-closed 规范性承诺，保留当前已交付的安全投影选择优先级，并把 compatibility fallback 明确留在 Implementation-only/Known divergence。定向 `processDetailsProjection.test.ts` 2 项通过；change strict 通过；全仓 strict 202/202；相关文本扫描和 `git diff --check` 通过。tracked diff 仅包含本 change 的 proposal、design、tasks 和 `e2e-ui-interaction` delta；生产代码、Stable specs、其他 active changes 与三个既有 `docs/reports/*.html` 均未修改。复核 P0=0、P1=0、P2=0、P3=0，结论 PASS；既有 frontend build 和 Provider harness 归档门禁仍保持未通过。

- [x] 3.8 按当前 OpenSpec authoring gate 将规范正文收窄为纯目标态表达。
  验证：`e2e-ui-interaction` 不包含历史名称、实现状态或已知债务等过程性措辞；兼容 fallback 现状继续只由 design 登记；运行三个自有 change strict、全量 strict、定向实现测试、禁止措辞扫描和 `git diff --check`。
  结果（2026-07-17）：已移除规范正文中的历史 requirement 名称说明和 Implementation-only/Known divergence 说明，仅保留已交付安全字段的选择优先级以及缺少字段时不保证 fallback 的目标边界。三个自有 change strict 与全仓 203/203 通过；assistant Markdown 1 项、Pending Input 9 项、Capability safe projection 2 项定向测试通过；禁止措辞扫描和 `git diff --check` 通过。`processDetailsProjection.test.ts` 整文件仍有 1 个既有 Workflow failed 文案断言失败，继续作为既有归档阻塞，不在本次规范收窄中修改。未修改实现、Stable specs 或其他 active change。

## 4. 补齐根路由首次普通提交的会话建立行为

- [x] 4.1 在既有 `e2e-ui-interaction` Session Management UI owner 中补齐根路由 pre-session 与首次普通提交边界
  验证：delta spec 只规定用户可观察的会话建立顺序、失败保留和已有会话不重复创建，不冻结具体 service、endpoint、storage key 或附件路径；proposal、design 与长期文档使用同一 owner 和边界
  结果（2026-07-17）：已在既有 `Session Management UI` MODIFIED requirement 中补齐 pre-session、先建立会话再提交、建立失败保留输入和已有会话不重复创建；附件路径继续归 `agent-web-attachment-composer`，未定义 service、endpoint、route 或 storage shape。change strict 通过。

- [x] 4.2 用 route-state characterization tests 证明首次普通提交的成功、失败和已有会话三条路径
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/chat-page.route-state.test.tsx -t "creates a session before submitting when sending from the root route|keeps the root draft when session creation fails|submits in an existing session without creating another session"`
  结果（2026-07-17）：定向 route-state 命令 1 file / 3 tests 通过；另与 Pending Input cancel 场景合并复跑时 1 file / 4 tests 通过。成功路径用 deferred session creation 证明 submit 不会提前发生；失败路径保留根路由草稿且 submit 为 0；已有会话路径 create 为 0。

- [x] 4.3 同步长期前端 module/navigation 并完成严格校验和独立语义复核
  验证：运行本 change strict、全量 strict、Markdown 链接扫描、`git diff --check` 和范围检查；复核必须确认本轮反向规格与文档收口未修改生产代码、Stable specs、其他 active change 或 `docs/reports`，且 P0/P1 为 0
  结果（2026-07-17）：已同步 frontend README/workflow/architecture、`agent-web.md` 和 spec-to-design map；change strict 通过，全仓 strict 203/203，13 份触达 Markdown 的 77 个本地链接、`git diff --check`、active-change 范围和目标态措辞扫描通过。`RespondInput.test.tsx` 整文件 10/10 通过；`chat-page.route-state.test.tsx` 为 77 passed / 3 failed，失败仍是无关 preview scroll 精确值和两条 edit harness。frontend build 仍有 4 个既有 TypeScript error；architecture lint 仍有 4 个既有 channel-web 到 gateway contract 依赖违规。独立语义复核 P0=0、P1=0、P2=0、P3=0，结论 PASS；未修改生产代码、Stable specs、其他 active change 或三个既有 `docs/reports/*.html`。

## 5. 刷新当前归档证据

- [x] 5.1 修复第一批已确认的 Provider harness、service mock 和陈旧断言，不修改生产路径。
  验证：复用一个 test-only `renderWithAppProviders` helper 装配 MessageInput、WelcomeState 和 TurnBlock；将 Skill selector、ProcessPanel、preview scroll 断言与当前 Stable/Active 事实统一；隔离 route-state 的 background-task fetch；禁止修改生产实现，`src` 下只允许触达 co-located test。
  结果（2026-07-18）：9 files / 152 tests 全部通过，其中 `chat-page.route-state.test.tsx` 80/80。edit 两项旧失败来自测试未隔离 `BackgroundTaskHeaderMonitor` 查询，不是 edit-resubmit 产品语义回归；生产目录无 diff。

- [x] 5.2 执行 frontend build 和全量测试，分开记录本批定向结论与仓库级门禁。
  验证：在 `frontend/agent-web` 运行 `npm run build`、上述 9 文件定向 Vitest、合并 Markdown rendering 与 Pending Input 自有测试后的 13 文件聚焦 Vitest，以及全量 `npm test`；任一全量失败必须如实登记。
  结果（2026-07-18）：frontend build 通过；第一批定向 152/152 通过，三个 change 的最终聚焦范围 216/216 通过；修复剩余 Provider/icon/service mock、ProcessPanel 文件内状态泄漏和陈旧行为断言后，默认并发的全量 Vitest 连续两次为 278/278 files、1101/1101 tests 通过，0 failed、0 skipped。`src` 下唯一 diff 是 co-located `MessageInputAssociation.test.tsx`，无生产实现 diff；修复保持在 test harness、mock 和断言范围内。

- [x] 5.3 合并最新 main 后重新执行完整归档门禁，确认外部 architecture lint 阻塞已解除。
  验证：在 `frontend/agent-web` 运行 `npm run build` 和全量 `npm test`；在仓库根目录运行 `openspec validate --all --strict`、`npm run lint:architecture` 和 `git diff --check`。
  结果（2026-07-18）：frontend build 通过；全量 Vitest 为 278/278 files、1101/1101 tests 通过，0 failed、0 skipped；OpenSpec strict 为 207/207；architecture lint 为 dependency 0 违规、package manifest policy 通过、34 files / 207 tests 通过。原 4 条 Web channel/gateway 违规已由对应 committer 随 main 修复，本 change 未修改该实现。

## 归档门禁状态（当前全部通过，尚未执行 archive）

- Baseline Promotion Plan 的长期设计同步已全部完成；除共同复核的另外两个 agent-web change 任务证据外，未修改其他 active changes；生产代码和 `docs/reports/*.html` 未修改。
- 第一批指定的 Provider harness、Skill selector/process detail/preview 陈旧断言和 route-state background-task mock 已收口；9 files / 152 tests 通过，完整 route-state 80/80；合并另两个 change 的自有测试后，最终聚焦范围 13 files / 216 tests 通过，frontend build 通过。
- 全量 frontend Vitest 已恢复为 278/278 files、1101/1101 tests 通过；第二批问题均定位为测试装配、mock 或陈旧断言，不是 baseline、Markdown rendering 或 Pending Input 的产品语义错误。
- 当前 frontend、OpenSpec 和 architecture 门禁均通过；本轮同步与推送不包含 archive 授权，因此 change 保持 Active。
- 用户授权 archive 后再执行独立语义 review 和普通 `openspec archive establish-agent-web-existing-behavior-baseline`；不使用 `--skip-specs`，不在 archive 前手工复制 delta 到 `openspec/specs/`。

## 6. 反向固化现有 Edit replacement durability

- [x] 6.1 核对当前 message-store contract 和 gateway-local coverage，确认 owner+Agent+session+source-request scoped `EDIT_REPLACED` visibility update 已存在且边界唯一。
  验证：SQLite release-config test 2/2 通过，覆盖 scope 隔离和重复调用幂等。
- [x] 6.2 核对当前 runtime characterization coverage，确认覆盖成功 edit replacement、fresh edit 失败时保留原消息，以及等价重放补齐 visibility。
  验证：`retry-input-text-recovery.test.ts` 9/9 通过。
- [x] 6.3 在 proposal、design 和 delta spec 中固化当前 runtime-owned source-request visibility replacement，不修改 browser edit transport、same-session lane 或生产实现。
  验证：源请求消息由一个 gateway-local transaction 更新；runtime replay 补齐同一操作；Web route 与 stream contract 不变。
- [x] 6.4 验证定向 backend tests、受影响 package build、architecture lint 和 strict OpenSpec validation。
  验证（2026-07-20）：root build 通过；默认测试 102 files / 840 tests；contract tests 32 files / 289 tests；architecture 34 files / 215 tests 且 dependency 零违规；OpenSpec strict 212/212；`git diff --check` 通过。

## 7. 合并当前 main 后刷新反向规格事实

- [x] 7.1 按当前代码修正 `session-title-update` delta 和长期文档。
  验证：对照 `packages/agent-session/src/services/session-preparation.ts`、Web `updateTitleBody` schema、Sidebar/Search Dialog rename 提交路径及 `local-gateway-contract.test.ts`；确认 raw Web body 上限、session-owner trim、1–100 字符非空校验、blank rejection、unsafe rejection 和 `titleSource=manual` 与代码一致。
  当前结果（2026-07-23）：delta、API 清单、用户工作流、Web/channel/session module 和 spec-to-design map 已统一为当前分层行为；`local-gateway-contract.test.ts` 1 file / 59 tests 通过，覆盖单字符接受、blank/empty rejection、trim-before-persist、unsafe rejection 和 scoped update。

- [x] 7.2 移除已经失效的 stream debug 与 background-task divergence 描述。
  验证：全仓产品路径不得存在 `streamDebugBuffer` 或 `ADNCLAW_STREAM_DEBUG`；Stable `agent-web-background-task-control` 必须明确允许 seed-only `commandLine`，baseline 不得把任一事实继续登记为当前 Known divergence。
  当前结果（2026-07-23）：产品代码、测试和 Stable specs 中没有 raw stream debug buffer 或环境开关；仅旧 active change 历史任务仍保留旧名称。Stable background-task spec 明确允许 seed-only `commandLine`，baseline 已移除对应 Known divergence。

- [x] 7.3 刷新三个 reverse-spec change 的实现证据并完成归档前语义复核。
  验证：运行 title backend 定向测试、assistant Markdown 与 Pending Input frontend 定向测试、frontend build、三个 change strict、全量 strict、architecture lint 和 `git diff --check`；复核本轮只修改 change artifacts 与长期文档，不修改生产代码、Stable specs 或其他 active change。
  当前结果（2026-07-23）：title backend 59/59、前端 5 files / 164 tests、frontend build、三个 change strict、全量 strict 222/222、architecture 36 files / 225 tests 和 `git diff --check` 全部通过。语义复核确认三个 change 均按当前代码反向固化，未修改生产代码、Stable specs 或其他 active change；`stabilize-agent-web-popup-and-scroll` 的重叠 capability 使用不同 requirement，`refine-session-title-and-search-validation` 的 title delta 在本 baseline 归档后应删除或重基于 Stable requirement；`agent-contracts` 没有新增变更，edit visibility contract 仍沿用 2026-07-20 已确认的当前代码边界。
