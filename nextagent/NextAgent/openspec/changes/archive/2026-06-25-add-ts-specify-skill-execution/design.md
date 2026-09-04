## 背景和现状（Context）

NextAgent 后端已完整实现 `targetSkill` 路由约束的执行路径：

- `RoutingConstraintsSchema`（`agent-contracts/runtime`）接受 `targetSkill` 字段，使用 safe-id pattern 校验。
- `submitBody` 和 `convenienceSubmitBody`（`agent-channel-web`）已透传 `routingConstraints`。
- `TargetedSkillRouter`（`agent-core`）在 Agent routing 阶段执行受治理的 Skill 调用，包括 binding 校验、forbidden 检查、budget 检查、deadline 检查和 cancellation 处理。
- `RoutingConstraintGovernor`（`agent-core`）在 governance 阶段验证 locale、maxToolCalls、forbiddenCapabilityIds 等。

缺失的是"发现"环节：用户无法在提交请求前查看可用 Skill 列表。`CapabilityCatalog.listAvailable()`（`agent-capability`）已在内部聚合所有 SKILL capability，但未通过任何 Web API 投影到客户端。

当前 Web channel 的 API surface 仅包含 session、conversation、request、stream、health 和 runtime bootstrap 端点，没有 capability 或 skill 查询端点。

约束：
- Web channel 只负责 transport 和 projection，不拥有 request lifecycle，不直接依赖 `CapabilityCatalog` 或 `AssemblyRegistry`。
- 跨 package 只能通过 `agent-contracts` 和 `agent-common` 协作。
- 不可信边界（HTTP query）必须 runtime schema validation。
- Agent Scope 只能来自 trusted app composition / hosted-agent selection。
- Owner Scope 只能来自 channel/auth boundary。
- Skill 数量极限场景不超过 500 个。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 新增 `GET /api/v1/skills` 端点，支持分页和关键字模糊搜索。
- 通过 `SkillCatalogQueryPort` 隔离 Web channel 与 capability catalog 内部实现。
- 前端新增 Skill 选择栏组件、全部 Modal、选中 chip 和 request body 集成。
- 在 LOCAL 和 REMOTE deployment mode 下正确聚合 Skill 来源。

**非目标：**
- 不修改 `targetSkill` 路由执行路径、`RoutingConstraintsSchema`、`TargetedSkillRouter` 或 `RoutingConstraintGovernor`。
- 不实现 REMOTE deployment mode 本身（只确保 Skill 列表 API 在 REMOTE 模式可用时正确包含 SKILL_HUB Skill）。
- 不实现输入框上方自定义组件区的完整扩展框架（只为 Skill 栏预留第一个 slot 位置）。
- 不新增持久化表或 gateway store（Skill 列表是实时查询，不持久化）。
- 不实现 Skill 列表的客户端缓存（每次查询都调用后端 API）。
- 不实现多 Agent 选择或 session-bound `agentId` 查询（当前仅支持 hosted `activeAgentId` / 单 Agent UI；既有 session 内的 Skill 展示可能列出默认 Agent 的 Skill 而非 session-bound Agent 的 Skill）。

## 设计决策（Decisions）

### D1: 新增 SkillCatalogQueryPort 而非直接暴露 CapabilityCatalog

**选择：** 在 `agent-contracts/runtime` 新增 `SkillCatalogQueryPort`、`SkillCatalogQueryRequest`、`SkillCatalogQueryResult` 和 `SkillCatalogSummaryEntry` 类型。Web channel 依赖该 port，`agent-app` composition 实现该 port。

**理由：** Web channel 的架构边界是 transport/projection，不应直接依赖 `agent-capability` 内部的 `CapabilityCatalog` 和 `AssemblyRegistry`。现有模式中 Web channel 已通过 `RuntimeCommandPort` 和 `RuntimeSessionPort` 与 runtime 交互，新增 `SkillCatalogQueryPort` 遵循同一模式。

**放弃的方案：**
- 直接在 Web channel 注入 `CapabilityCatalog` + `AssemblyRegistry`：违反架构边界，Web channel 会直接依赖 `agent-capability` 内部类型。
- 在 `agent-contracts/capability` 新增 query port：capability contracts 已承载 invocation/descriptor/catalog 契约，skill 列表查询是 Web channel 投影需求，不是 capability 核心契约。放在 runtime 更合适，因为 Web channel 已依赖 runtime contracts。

### D2: SkillCatalogQueryPort 放在 agent-contracts/runtime

**选择：** Port 定义在 `agent-contracts/runtime`，与 `RuntimeCommandPort`、`RuntimeSessionPort` 并列。

**理由：** `agent-contracts/runtime` 已是 Web channel 依赖的 contract subpath。Skill 列表查询是 runtime 层面的只读查询，不是 capability invocation 或 gateway persistence。放在 runtime 避免让 Web channel 新增对 `agent-contracts/capability` 的直接依赖。

### D3: 分页和关键字过滤在内存中执行

**选择：** `SkillCatalogQueryPort` 实现先调用 `CapabilityCatalog.listAvailable()` 获取当前 Agent Scope 下的全部 SKILL descriptor，然后在内存中执行关键字过滤和分页切片。

**理由：** Skill 数量极限场景不超过 500 个。`listAvailable()` 本身已经是内存操作（catalog 在 request-scope 构建可见视图）。在 500 条记录上做 substring filter + slice 的性能开销可忽略。引入数据库分页或缓存层属于过度设计。

**放弃的方案：**
- 在 SQLite 中持久化 skill 列表并分页查询：增加持久化复杂度，skill 列表是动态的（随 catalog governance 变化），持久化需要同步机制。
- 在 catalog 层面支持分页参数：修改 `CapabilityCatalog.listAvailable()` 的 frozen contract，影响面过大。

### D4: Skill summary DTO 不暴露 CapabilityDescriptor 全部字段

**选择：** `SkillCatalogSummaryEntry` 只包含 `capabilityId`、`displayName`、`description`、`providerKind` 和可选 `version`。

**理由：** `CapabilityDescriptor` 包含 `inputSchema`、`outputSchema`、`compatibility`、`metadata`、`replayPolicy` 等字段，这些字段包含 provider 私有信息或内部实现细节，不适合暴露给浏览器客户端。Skill summary 只包含用户选择 Skill 所需的最少信息。

**放弃 `availabilityStatus` 字段：** 规格要求 disabled、unauthorized 或 unavailable provider 的 Skill 不出现在结果中。因此返回的 Skill 几乎恒为 `AVAILABLE`，该字段信息价值极低且无必要地扩大 public contract。移除该字段使 DTO 更精简。

### D5: Agent Scope 来源为 hosted agent activeAgentId（单 Agent 限制）

**选择：** Skill 列表查询使用 `systemConfig.activeAgentId` 解析 active agent assembly，与 health check 和 default route 的 Agent Scope 一致。

**理由：** Skill 列表查询是 session 提交前的发现操作，此时还没有 session 绑定的 agentId。使用 hosted agent 的 activeAgentId 与产品当前单 Agent 模式一致。

**已知限制：** 当前版本仅支持单 Agent 模式。`GET /api/v1/skills` 使用 hosted `activeAgentId` 而非 session-bound `agentId`。若 UI 在某个既有 session 内展示 Skill，该端点可能列出默认 Agent 的 Skill 而非 session-bound Agent 的 Skill。未来支持多 Agent 时，需增加 `agentId` 查询参数或从 session 上下文解析 agent scope，当前不实现。此限制在 Non-Goals 中明确记录。

### D6: 前端 Skill 栏初始加载使用第一页

**选择：** Skill 栏初始化时调用 `GET /api/v1/skills?pageNum=1&pageSize=50`，根据返回的 `total` 和实际渲染的 chip 数量决定是否显示"全部"按钮。

**理由：** 50 条 Skill 足以填满一行 chip。如果 `total` 超过实际渲染数量，显示"全部"按钮。Modal 打开时独立分页加载，不复用 Skill 栏的已加载数据（因为 Modal 支持搜索，数据集不同）。

### D7: Modal 搜索防抖延迟 300ms

**选择：** 搜索输入框防抖延迟设为 300ms。

**理由：** 300ms 是常见的搜索防抖值，在响应速度和减少无效请求之间取得平衡。防抖实现在前端组件中，不作为后端 API 参数。

### D8: 选中 Skill 提交后 state 保持

**选择：** 用户提交请求后，选中的 Skill state 保持不变。后续请求继续携带相同的 `targetSkill`，直到用户主动点击"x"取消。

**理由：** 用户可能在同一 session 中多次使用同一 Skill。保持 state 减少重复操作。如果用户想换 Skill 或取消，通过 chip 的"x"按钮操作。

### D9: Skill chip 使用统一中性色而非 per-index 色彩

**选择：** Skill 栏 chip 和 Modal 列表项均使用统一中性色（未选中）和统一选中色（`--color-bg-active` + `--color-primary`），不按索引分配 green/purple/orange/blue 色彩。

**理由：** per-index 色彩方案增加视觉噪声且无功能价值；统一中性色让选中态对比更清晰，降低用户认知负担。色彩变量 `--skill-color-*` 和 `getSkillColorScheme` 函数保留在代码中但不再被产品路径调用，属于早期实验遗留，后续清理。

**放弃的方案：**
- per-index 色彩方案：视觉噪声大，选中态需要额外定义 4 套 selected 配色，维护成本高。

### D10: Modal 键盘导航

**选择：** Modal 打开时自动聚焦搜索输入框，支持 `ArrowUp`/`ArrowDown` 循环导航列表项，`Enter` 确认选择，键盘焦点项自动滚动到可视区域。键盘导航通过 `document` 级 `keydown` 捕获实现（capture phase），在搜索输入框聚焦时也生效。

**理由：** 用户打开 Modal 后通常先搜索再选择，自动聚焦搜索框减少一次点击。键盘导航让熟练用户无需鼠标即可完成 Skill 选择，提升效率。使用 `document` capture phase 确保无论焦点在哪都能捕获按键。键盘焦点项使用 `--color-bg-hover` 与选中项的 `--color-bg-active` 区分，避免视觉混淆。

**放弃的方案：**
- 仅在列表项聚焦时响应键盘：用户需要先 Tab 到列表才能导航，增加操作步骤。
- 使用 roving tabindex：实现复杂度高，对于简单的线性列表不值得。

### D11: chip 最大宽度与 flexShrink

**选择：** chip wrapper 设置 `maxWidth: 400px`、`overflow: hidden` 和 `flexShrink: 0`。

**理由：** 400px 足以容纳 32 个中文字符（12px 字号下约 384px）。`flexShrink: 0` 防止 flex 容器在 `nowrap` 模式下压缩 chip，确保 `recomputeVisible` 测量到真实宽度。没有 `flexShrink: 0` 时，浏览器会等比压缩所有 chip，导致 `offsetWidth` 测量失真，`recomputeVisible` 误判全部 chip 都放得下。

### D12: "全部"按钮流式排列

**选择：** "全部"按钮跟随 chip 流式排列，不使用 `marginLeft: auto` 固定右侧。

**理由：** "全部"按钮是 chip 序列的逻辑延续（"放不下的其余 Skill"），流式排列在视觉上更连贯。固定右侧会让按钮与 chip 之间出现不自然的空隙。

### D13: WebChannelRegistrationContext 扩展 catalog 和 assemblyRegistry

**选择：** `WebChannelRegistrationContext` 新增 `catalog: CapabilityCatalog` 和 `assemblyRegistry: AgentAssemblyRegistry` 字段，供 `createSkillCatalogQueryPort` 使用。

**理由：** `SkillCatalogQueryPort` 实现需要调用 `CapabilityCatalog.listAvailable()` 和 `AssemblyRegistry.active()`，这两个对象在 composition 阶段已创建。通过 context 传递比通过参数传递更自然，因为 context 已经是 composition 的标准注入点。这不违反架构边界——catalog 和 assemblyRegistry 只在 composition 层使用，不泄露到 Web channel。

### D14: statusFor 错误处理扩展（Web error contract 变更）

**选择：** `statusFor` 函数从接受 `error.category` 改为接受完整 `error` 对象，新增 `LOCAL_AUTH_REQUIRED -> 401` 和 `UNAVAILABLE -> 503` 映射。

**理由：** Skill catalog 端点在 catalog 不可用时抛出 `category: "UNAVAILABLE"` 的 `AgentError`，需要映射为 503。原有 `statusFor` 不处理 `UNAVAILABLE` category，会 fallback 到 400。

**Web error contract 影响：** 此改动影响全局错误处理。现有 Web route 已有 attachment dependency unavailable 等场景抛出 `UNAVAILABLE` 错误（如 `ATTACHMENT_DEPENDENCY_UNAVAILABLE`），此前这些错误 fallback 到 400。新增 `UNAVAILABLE -> 503` 映射会改变这些现有路由的错误响应状态码。该变化是合理的（503 比 400 更准确地表达 service unavailable 语义），但 MUST 作为 Web error contract 变更覆盖回归测试，确保所有现有路由的 `UNAVAILABLE` 错误在新映射下行为正确。

### D15: Skill 来源包含 BUNDLED builtin-skills

**选择：** Skill 列表查询 MUST 聚合 `BUNDLED`（builtin-skills）、`LOCAL_DIRECTORY`（local-skills-system 和 local-skills-agent-owned）provider 的 Skill。在 REMOTE deployment mode 下额外包含 `SKILL_HUB` provider 的 Skill。

**理由：** builtin-skills 是随框架包发布的内置 Skill（如 `telecom-domain-qa`），对所有用户可见且应可被选择执行。此前设计遗漏了 `BUNDLED` 来源，导致内置 Skill 不会出现在 Skill 列表 API 结果中。`CapabilityCatalog.listAvailable()` 本身已经聚合所有 provider 的 Skill，查询实现只需投影，不需要额外过滤掉 `BUNDLED` 来源。

### D16: agent-owned Skill source 授权校验

**选择：** `local-skills-agent-owned` provider 的 Skill MUST 经过 agent-owned source authorization 校验。未通过授权的 agent-owned Skill MUST NOT 出现在查询结果中。

**理由：** `local-skills-agent-owned` provider 的 Skill 来自 Agent package root 下的 `skills/` 目录，按 request-scope 搜索加载。在多 Agent 场景下，不同 Agent 的 owned Skill 应有访问控制。当前单 Agent 模式下所有 agent-owned Skill 属于同一 active agent，授权校验等效于全量放行。查询实现通过 `CapabilityCatalog.listAvailable()` 已有的 governance 边界消费授权结果，不自行实现第二套授权逻辑。未来多 Agent 时需扩展 catalog governance 以支持 per-agent-owned source authorization。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Skill 列表查询通过 trusted Web channel identity resolver 解析身份；不接受 identity/agent/tenant override；Skill summary DTO 不暴露 provider 私有配置、credential、文件路径或 catalog 内部 governance evidence；关键字搜索仅限 `displayName` 和 `capabilityId`，不搜索内部字段 | contract test：未认证 401、非法参数 400、响应字段安全断言 |
| 性能/容量 | `listAvailable()` 返回的全部 SKILL descriptor 在内存中过滤和分页；Skill 数量上限 500，单次查询内存开销可忽略；`pageSize` 最大 100 防止过大响应；前端搜索防抖 300ms 减少无效请求 | contract test：分页边界、pageSize 上限断言 |
| 可靠性/恢复 | catalog 或 assembly registry 不可用时返回 503 safe error，不暴露 raw error；`SkillCatalogQueryPort` 接收 `AbortSignal` 支持取消；查询是只读操作，不影响任何持久化状态 | contract test：catalog unavailable 503、取消安全终止 |
| 可维护性 | Web channel 通过 `SkillCatalogQueryPort` 与 catalog 解耦；port 定义在 `agent-contracts/runtime`，实现集中在 `agent-app` composition；不修改任何 frozen contract | architecture test：Web channel 不直接依赖 `agent-capability` |
| 可测试性 | `SkillCatalogQueryPort` 可被 test composition mock；Web channel route 可通过 Fastify inject 测试；DTO shape 有 TypeBox schema 校验 | contract test：route inject + port mock |
| 审计/可追溯性 | Skill 列表查询通过 structured logging 记录（HTTP method、route、status family、agentId）；日志不包含 skill 列表内容、provider 配置或 credential | observability test：日志字段断言 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `GET /api/v1/skills` 端点接受 pageNum/pageSize/keyword 参数 | T1 | contract test: 默认分页、自定义分页、非法参数 |
| 响应 DTO 包含 total/pageNum/pageSize/skills 且不暴露敏感字段 | T1 | contract test: 响应字段断言 |
| LOCAL 模式返回 BUNDLED + LOCAL_DIRECTORY Skill | T2 | contract test: providerKind 断言 |
| REMOTE 模式返回 BUNDLED + LOCAL_DIRECTORY + SKILL_HUB Skill | T2 | contract test: providerKind 断言（需 REMOTE 模式 test composition） |
| agent-owned Skill 未授权时不返回 | T2 | contract test: 授权失败场景断言 |
| statusFor UNAVAILABLE -> 503 回归测试 | T8 | 现有路由 attachment UNAVAILABLE 错误响应状态码断言 |
| 关键字搜索仅匹配 displayName 和 capabilityId | T1 | contract test: keyword 匹配/不匹配/空关键字 |
| Web channel 通过 SkillCatalogQueryPort 查询，不直接依赖 catalog | T3 | architecture test: import 断言 |
| 未认证请求返回 401 | T1 | contract test: 未认证场景 |
| Catalog 不可用返回 503 safe error | T1 | contract test: catalog unavailable 场景 |
| Skill 栏渲染在输入框上方 16px，宽度齐平 | T4 | 前端组件测试 |
| Skill 栏单行渲染，溢出显示"全部"按钮 | T4 | 前端组件测试 |
| Modal 328px 宽，右下角对齐"全部"按钮 | T5 | 前端组件测试 |
| Modal 搜索防抖 + 无限滚动分页 | T5 | 前端组件测试 |
| 选中 Skill 在输入框显示 chip + x 按钮 | T6 | 前端组件测试 |
| 提交时 body 携带 routingConstraints.targetSkill | T6 | 前端组件测试 + E2E |
| 取消选中后 body 不携带 targetSkill | T6 | 前端组件测试 + E2E |

## 文档承载决策（Documentation Ownership）

- **行为契约**：`openspec/specs/web-skill-catalog/spec.md` 主承载 Skill 列表查询 API 的可验证行为契约；`openspec/specs/skill-selector-ui/spec.md` 主承载前端 Skill 选择组件的行为契约。
- **架构和跨模块设计**：`openspec/designs/architecture/web-channel-api-surface.md` 主承载 Web channel API 表面的跨模块流程和 `SkillCatalogQueryPort` 边界。
- **模块设计**：`openspec/designs/modules/agent-channel-web.md` 主承载 Web channel 模块中 `GET /api/v1/skills` 路由的职责和 contract 消费关系。
- **ADR**：无需要长期保留的技术决策。所有设计决策在 design.md 中记录，归档后提炼到 architecture 和 modules 文档。
- **导航**：`openspec/designs/spec-to-design-map.md` 更新 `web-skill-catalog` 和 `skill-selector-ui` 到 design 的导航。

## 风险与取舍（Risks / Trade-offs）

- [REMOTE deployment mode 未完整实现] -> Skill 列表 API 在 LOCAL 模式下完全可用；REMOTE 模式的 SKILL_HUB Skill 聚合依赖 REMOTE 模式本身的完整实现，当前只确保 API 在 REMOTE 模式可用时正确工作。
- [内存分页在极端场景的性能] -> Skill 数量上限 500，内存过滤开销可忽略。如果未来 Skill 数量增长超过 1000，需要考虑 catalog 层面的分页支持。
- [前端代码不在本仓库] -> 前端组件的实现和测试在前端代码库中完成。本 change 的 tasks 中标注前端任务，但实际实现和验证在前端仓库执行。
- [Skill 栏与 Modal 数据不复用] -> Skill 栏加载第一页，Modal 独立加载。两个请求之间可能有短暂的 Skill 列表不一致（如 Skill 在两次请求间被 disable），但这是可接受的最终一致性。
- [单 Agent 模式 Agent Scope 错配] -> `GET /api/v1/skills` 使用 hosted `activeAgentId` 而非 session-bound `agentId`。若 UI 在既有 session 内展示 Skill，可能列出默认 Agent 的 Skill。当前产品为单 Agent 模式，此错配不会实际发生；未来支持多 Agent 时需优先解决。
- [statusFor 全局映射影响现有路由] -> `UNAVAILABLE -> 503` 映射改变现有 attachment 路由的错误状态码（400->503）。需覆盖回归测试确保现有路由行为正确。

## 迁移计划（Migration Plan）

无迁移风险。新增端点和前端组件，不修改任何现有 API、contract 或持久化 schema。部署后 `GET /api/v1/skills` 立即可用；前端组件在下一版本发布后可用。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/web-skill-catalog/spec.md`：新增 Skill 列表查询 API 的稳定行为契约。
- `openspec/specs/skill-selector-ui/spec.md`：新增前端 Skill 选择组件的稳定行为契约。
- `openspec/overview.md`：补充 Skill 发现和选择能力的产品背景。
- `openspec/designs/architecture/web-channel-api-surface.md`：新增 `GET /api/v1/skills` 跨模块流程和 `SkillCatalogQueryPort` 边界。
- `openspec/designs/modules/agent-channel-web.md`：新增 `GET /api/v1/skills` 路由职责和 `SkillCatalogQueryPort` 依赖。
- `openspec/designs/spec-to-design-map.md`：新增 `web-skill-catalog` 和 `skill-selector-ui` 导航。

## 待确认问题（Open Questions）

无。设计决策已收敛，所有关键选择在编码前已明确。
