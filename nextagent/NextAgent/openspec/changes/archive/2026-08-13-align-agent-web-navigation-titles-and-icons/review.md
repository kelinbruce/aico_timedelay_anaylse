## 审查结果

- Change：`align-agent-web-navigation-titles-and-icons`
- 类型：OpenSpec change
- 日期：2026-08-13
- 状态：PASS（实施、归档与推送前验证完成）
- 结论：前置 change 与当前 change 均已归档，stable spec、Function、Feature、module 和 spec-to-design map 已按唯一目标态同步；未发现阻止提交或推送的问题。

## Findings

无未处理的 BLOCKER、HIGH、MEDIUM 或 LOW finding。

本轮 review 发现并已在同一轮修复：

| ID | 严重级别 | 领域 | 位置 | 问题 | 处理结果 |
|---|---|---|---|---|---|
| SR-01 | MEDIUM | Feature 追踪 | proposal、`agent-web-page-layout` Function 汇总、baseline plan | `FN-10.35` 的呈现范围新增记忆管理，但最初未同步 `F-8.2` 的 Function 组成 | 已增加 `F-8.2` Feature delta、`覆盖特性` 汇总和归档刷新计划 |
| SR-02 | MEDIUM | 受约束自然语言 | `内置业务页面的导航标识与页面标题保持一致` | 图标尺寸最初使用未闭合的 `MAY`，无法唯一判断不同导航区域的验收尺寸 | 已改为 Sidebar `20px × 20px`、Immersive RIGHT/Collaborative `16px × 16px` 的确定契约 |
| SR-03 | MEDIUM | 并行边界 | design、tasks | `refine-agent-web-expand-panel-dsl-lifecycle` 与本 change 触达相同 Collaborative 扩展内容路径，最初未显式保留 `setView()` 的 DSL 清理语义 | 已补充当前实现、唯一修改路径、风险和 task negative case；保留 `setView()` → `open()` |
| SR-04 | LOW | Function 变更汇总 | `agent-web-page-layout` delta | 规格项最初写为“页面与宿主范围”，与长期 Function 的“首批页面与宿主范围”不一致 | 已改为精确的既有规格项名称 |
| SR-05 | LOW | 可执行验证路径 | `tasks.md` | 六处验证命令最初引用不存在的 `immersive-entry.test.tsx` | 已统一改为仓库实际测试入口 `immersive-routing.test.tsx`，并执行通过 |
| SR-06 | MEDIUM | 归档一致性 | `tasks.md` 归档前检查 | 最初写成“其他 Feature 保持不变”，与 proposal/design 要求刷新 `F-8.2 长期记忆` 相冲突 | 已明确归档时刷新 `F-8.2`，其他 Feature 保持不变 |
| IR-01 | MEDIUM | 浏览器实现 | `AIAgentPiuRuntime.css` | Collaborative 英文长标题可让 flex item 中的 `16px` 图标收缩为 `15px`，不满足精确尺寸契约 | 已为菜单图标增加 `flex: 0 0 16px`；真实浏览器复验通过 |
| IR-02 | MEDIUM | 多宿主图形语义 | `ImmersiveApp.tsx` | Local 与 Collaborative/PIU 的新建会话入口使用现有主题 SVG，Immersive 同名入口仍使用通用 `PlusOutlined` | 已新增独立黑盒 Requirement；Immersive 改用同一组 `new-session` 主题资源并保持原 handler、位置与名称 |
| SR-07 | LOW | Artifact 职责 | proposal、`agent-web-page-layout` delta | 补充范围最初在 proposal 暴露资源标识，且 spec 未显式穷尽英文入口名称 | proposal 已改回用户可见结果；spec 明确 `zh-CN`“新建会话”与 `en-US`“New Session” |

## 需群内确认

无。本 change 不修改 `agent-contracts`、公共 API、stream、runtime command、gateway、persistence、Owner Scope 或 Agent Scope。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | 修改限于 `frontend/agent-web` 浏览器投影、OpenSpec 和测试；三宿主继续复用既有页面与业务状态，未新增导航 authority。 |
| core contracts | PASS | 不触及 frozen core contract、request lifecycle、canonical timeline 或可信 scope。 |
| roadmap owner boundaries | PASS | 标题、Tooltip、无障碍名称和入口图标归浏览器投影；Cron、收藏、记忆和投诉业务 owner 均不变化。 |
| roadmap change rules | PASS | Cron legacy Requirement 已形成来源 `REMOVED` + canonical `ADDED` 原子迁移；协调的前置 change 已归档。 |
| current code | PASS | 四组页面名称已收敛到业务 i18n key；Sidebar/RIGHT/PIU 使用对应主题 SVG；三宿主新建会话入口复用同一主题资源；投诉页面 wrapper 与纯模态内容边界已落实。 |
| engineering principles | PASS | 复用现有业务 i18n 命名空间、主题 SVG、`PageHeader` 和纯投诉内容组件；不新增依赖、目录、注册表、store 或路由。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 无新增 Function/spec；`FN-10.35` 与 `agent-web-page-layout`、`FN-1.13` 与 `favorite-turn-list` 保持唯一主规格；前置归档后 `FN-10.9` 以 `cron-task-management-api` 为 canonical 主规格。 |
| Delta/stable operation | PASS | Page layout 的两个 ADDED Requirement 名称在 stable 中均为 0 次；favorite MODIFIED 和 Cron source REMOVED 分别精确匹配 1 次；Cron target ADDED 在 stable target 中 0 次。 |
| Legacy Requirement 迁移 | PASS | `Cron task dashboard lists manageable tasks` 的来源/目标为不可拆分迁移对；前置 change 已归档，目标完整保留 `createdByName`、空值占位符和单一卡片菜单义务。 |
| Function 变更汇总 | PASS | 三个主规格 delta 均按长期 Function 实际字段组织，并反向引用全部 ADDED/MODIFIED Requirements；legacy 来源不伪造汇总。 |
| Function 规格 | PASS | `FN-10.35` 修改既有“首批页面与宿主范围”规格项；`FN-10.9`、`FN-1.13` 不为普通标题变化制造新规格项。三个长期 Functions 当前均有非空规格。 |
| Requirement 元数据 | PASS | 所有 ADDED/MODIFIED Requirements 均声明功能性需求；Function 归属只在主规格顶部声明。 |
| 质量属性分层 | PASS | 没有伪造黑盒质量 Requirement；可维护性和可测试性仅作为 `FN-10.35` 的局部实现与验证关注点。 |
| 触发机制 | PASS | 以宿主已提供入口、语言/主题和用户选择页面作为可见触发；不要求缺失入口被补齐。 |
| 输入和前置条件 | PASS | 宿主集合、投诉探针 gate、前置 Cron change 与现有主题/语言条件明确。 |
| 输出和副作用 | PASS | 精确冻结四组中英文名称、图标语义、尺寸、页面/模态标题数量；明确不改变业务状态、API 或持久化。 |
| 核心决策逻辑 | PASS | 业务 i18n key 是唯一名称来源；页面包装与纯投诉内容用途唯一；三宿主菜单差异保留。 |
| 存量代码基线 | PASS | design 覆盖直接相关组件、资源、活动 change 重叠和既有测试。 |
| 增量实施路径 | PASS | 仅替换目标 key/icon、增加同文件页面包装、修改两处页面标题并补目标测试。 |
| 唯一实施路径 | PASS | 明确拒绝全局菜单注册表、菜单集合统一、路由或 store 扩张。 |
| flow 集成 | PASS | 当前语言/主题 → 宿主既有入口 → 同一业务标题键/主题 SVG → 既有业务页面与状态路径。 |
| 失败和降级 | PASS | 投诉探针关闭、`window.Prel` 不可用、Cron 503、收藏读取失败均保留既有结果。 |
| 验收示例 | PASS | 覆盖两语言、两主题、三宿主、单标题、宿主特有菜单和禁止新增入口。 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | OpenSpec capability 仅用于 Function；未把 runtime Tool/Skill/Agent Capability 混入。 |
| canonical terminology | PASS | 页面名称、页面级标题、图形语义、宿主名称和 canonical spec 跨 artifacts 一致。 |
| BCP 14 规范关键词 | PASS | 新增规则使用 `MUST`/`MUST NOT`；收藏完整重述中的既有 `MAY` 行为无语义变化且受 100 条硬上限与服务端过滤边界约束。 |
| 语义闭合 | PASS | 明确入口存在/缺失、主题、宿主表面、模态例外、图标尺寸和菜单不变边界。 |
| 量词与可测量边界 | PASS | Sidebar 与三宿主新建会话图标为 `20px × 20px`，Immersive RIGHT/Collaborative 业务入口为 `16px × 16px`；标题数量为恰好一个；未使用开放式尺寸条件。 |
| 形式化表示适配性 | PASS | 行为无状态，不需要状态机；精确名称集合直接在 Requirement 中穷尽。 |
| scenario-to-test 来源 | PASS | tasks 引用精确 Requirement/Scenario，并要求先失败、后实现、再回归。 |
| 黑盒/白盒边界 | PASS | spec 只定义可见名称、图标与页面结果；i18n key、SVG 文件、React 组件和调用顺序只在 design/tasks。 |
| 端到端追踪 | PASS | `F-8.2`（适用）→ `FN-10.35/FN-10.9/FN-1.13` → Requirements → Scenarios → test-first tasks 可定位。 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | PASS | proposal 包含 Why、目标/非目标、What Changes、Feature/Function 影响和影响范围。 |
| 创建前覆盖检查 | PASS | stable specs、Functions、Feature、代码和 active change 均已检查；未创建平行能力。 |
| 生成后一致性确认 | PASS | proposal、specs、design、tasks 指向同一最小前端路径，strict validation 全量通过。 |
| release scope / not-planned / candidate | N/A | 不是 roadmap release 立项或候选优先级变更。 |
| 并行边界 | PASS | Cron 同名 Requirement 的顺序依赖已满足；DSL lifecycle 与 locale 文件重叠均按当前代码保留，未形成同名 Requirement 冲突。 |
| 第一性原理/KISS/SOLID | PASS | 真实问题是页面身份投影分叉；方案收敛名称来源和既有资产，不重构业务页或宿主菜单。 |
| 基于存量代码的增量设计 | PASS | 所有生产代码落点和既有测试入口可定位。 |
| 唯一可实施路径 | PASS | 不存在互斥 adapter、registry、state 或 owner 方案。 |

## 需求和设计清晰度

PASS。实现与 review 均遵循四组精确中英文页面名称、三宿主新建会话图形语义、明确的 20px/16px 尺寸边界、页面/模态标题规则、宿主菜单非一致性边界、投诉 wrapper 使用位置和 Cron 原子迁移约束；未引入新的 owner、状态或路由方案。

## 验证

- 前置 `add-cron-task-created-by-name`：已归档到 `archive/2026-08-13-add-cron-task-created-by-name`，stable spec 与 `FN-10.9` 已同步。
- `openspec validate align-agent-web-navigation-titles-and-icons --strict`：PASS。
- `openspec archive -y align-agent-web-navigation-titles-and-icons`：PASS；正常同步四个 delta，未使用 `--skip-specs`。
- 归档后 Cron Requirement 计数：legacy 来源 0、canonical 目标 1；legacy spec 的其他 6 个 Requirements 保留。
- `openspec validate --all --strict`：266 items PASS，0 failed。
- Delta/stable operation 精确计数：PASS。
- 收藏完整 MODIFIED block 归一化对比：除页面名称段与对应 Scenario 外无变化，PASS。
- Cron 目标 block 对 `add-cron-task-created-by-name` 归一化规范行对比：除页面名称来源、中文 Scenario 标题与必需元数据外无变化，PASS。
- `npm test -- src/features/complaint/components/ComplaintHistoryView.test.tsx src/features/sidebar/components/Sidebar.complaintHistory.test.tsx tests/CronTaskDashboardPage.test.tsx tests/favorite-turns-panel.test.tsx tests/sidebar.component.test.tsx tests/immersive-routing.test.tsx tests/piu-runtime-contract.test.tsx tests/page-layout.component.test.tsx tests/local-favorites-navigation.test.tsx tests/favorite-session-navigation.test.tsx --reporter=dot`：9 files、163 tests PASS。
- `npm run build`：PASS。
- `npm run build:vite:modes`：Local、Immersive、Collaborative 三宿主 artifact 构建 PASS。
- `node scripts/run-playwright-smoke.cjs tests/e2e/page-layout.spec.cjs tests/e2e/cron-task-dashboard.spec.cjs tests/e2e/complaint-feedback.spec.cjs --workers=1`：7/7 PASS；默认并发尝试仅出现既有页面滚动距离时序波动，串行复验稳定通过。
- 新建会话 test-first：四种语言/主题组合在 `PlusOutlined` 基线上按预期失败；修复后 `immersive-routing.test.tsx` 22/22 PASS。
- 新建会话真实浏览器复验：`complaint-feedback.spec.cjs` 4/4 PASS，浅色/暗色资源、`20px × 20px` 尺寸和本地化按钮名称均由 DOM 断言证明。
- 真实浏览器截图与 DOM 复核：四组业务名称、主题图标、单标题、宿主特有菜单和三宿主新建会话图形语义均通过；visual verdict 97/100，PASS。
- 旧 i18n key 残留扫描：`NO_MATCHES`。
- `git diff --check`：PASS（仅 Git 的 LF/CRLF 工作区提示）。
