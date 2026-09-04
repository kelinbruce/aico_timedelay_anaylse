## 背景和现状（Context）

NextAgent 前端输入框上方当前只有 Skill 选择栏（`skill-selector-ui` spec 定义）。电信网络运维场景下用户需要快速选择常见问题类别并发送预设问题。当前没有静态分类问题推荐机制——`question-recommendation` 是 AI 动态生成的追问，不是面向业务场景的静态预设。

现有架构中，agent package 下的 `skills/` 目录通过 `LocalSkillDiscovery`（SEARCH mode）使用 `AgentPackageSourceLocator` 定位并扫描。prompt 模板在 `prompts/` 目录下。分类问题需要一个新的 `resource/` 子目录，承载 JSONL 格式的静态分类问题数据。

本次 change 复用 skill discovery 的架构模式（文件 + 内存、agent-scoped、readiness evidence），但不复用 `CapabilityDiscovery` 接口——分类问题不是 capability，不进入 capability catalog。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 新增 `CategoryQuestionResourceDiscovery`，从 `agents/{agentId}/resource/category-question-{locale}.jsonl` 加载分类问题到内存
- 新增 `CategoryQuestionPort` 契约和 `CategoryQuestionService` 实现
- 新增 `GET /api/v1/category-questions?locale=zh-CN` Web API
- 新增前端分类问题 chip 组件（复用 Skill chip 渲染）和 modal 组件
- 输入框上方区域参数化为可切换组件容器，默认渲染分类问题组件

**非目标：**
- 不建数据库表，不做用户活动持久化（favorites、frequency）
- 不做高频问题组件和输入联想
- 不修改 skill catalog API 或 capability catalog
- 不实现前端组件切换参数的后端配置（前端内部参数控制）
- 不实现 question hash 的 API 暴露

## 设计决策（Decisions）

### D1: 分类问题不进入 Capability Catalog

分类问题不是 capability（不是 Tool、Skill 或 Agent），不参与 capability governance、conflict resolution 或 invocation。因此不实现 `CapabilityDiscovery` 接口，不注册到 `StaticCapabilityCatalog`。

新增独立的 `CategoryQuestionResourceDiscovery` 类，放在 `agent-capability/src/local/` 下（与 `LocalSkillDiscovery` 同目录），复用 `AgentPackageSourceLocator` 但实现自己的 discovery 逻辑。

### D2: 文件 + 内存存储，不进数据库

与 skill 同形同策：JSONL 文件是 source of truth，启动时加载到内存，应用生命周期内不可变。不写入 SQLite。

理由：
- 数据是 agent-scoped、只读、部署时确定的，没有持久化需求
- 放数据库引入同步问题（文件改了要同步表）
- AGENTS.md 要求"主路径持久化必须使用专用业务 store/table"，但静态目录不是持久化事实，是资源

### D3: JSONL 格式与内存模型

JSONL 每行一个一级分类对象。一级分类的 `questions` 和 `records` 可以共存：`questions` 作为直接问题，`records` 作为二级分类。二级分类的 `records` 字段被忽略（仅解析 `questions`），最多支持二级分类。

解析校验规则：
- 一级分类 `category` 缺失/空/非字符串 → 跳过整行 + evidence
- 一级分类 `questions` 和 `records` 同时为空/不存在 → 跳过整行 + evidence
- 二级分类 `category` 缺失/空/非字符串 → 跳过该二级分类 + evidence
- 二级分类 `questions` 为空/不存在 → 跳过该二级分类 + evidence
- 二级分类 `records` 存在 → 忽略，不拒绝
- question `question` 缺失/空/非字符串 → 跳过该 question + evidence
- question `fixed` 缺失/非布尔 → 跳过该 question + evidence
- 单行 JSON 解析失败 → 跳过整行 + evidence
- 单行为 null/数组/原始类型 → 跳过整行 + evidence
- 一级分类下所有 questions 和 records 均无效 → 跳过整行 + evidence

内存模型：

```
CategoryQuestionCatalog (per agentId + locale)
├── locale: string
├── categories: CategoryL1[]
│   ├── CategoryL1
│   │   ├── name: string
│   │   ├── mode: "direct" | "nested" | "mixed"
│   │   ├── questions: QuestionEntry[]          (direct 或 mixed 时有值)
│   │   └── subCategories: CategoryL2[]         (nested 或 mixed 时有值)
│   │       └── CategoryL2
│   │           ├── name: string
│   │           └── questions: QuestionEntry[]
│   │               └── QuestionEntry
│   │                   ├── text: string
│   │                   ├── fixed: boolean
│   │                   └── hash: string (SHA-256, 内部使用)
```│   │                   └── hash: string (SHA-256, 内部使用)
```

### D4: Port 契约设计

`CategoryQuestionPort` 定义在 `agent-contracts/runtime`：

```typescript
interface CategoryQuestionRequest {
  readonly agentId: AgentId;
  readonly locale?: string;  // BCP 47, default "zh-CN"
}

interface CategoryQuestionResult {
  readonly locale: string;  // normalized, e.g. "zh"
  readonly categories: readonly CategoryL1Dto[];
}

interface CategoryQuestionPort {
  listCategoryQuestions(
    request: CategoryQuestionRequest,
    signal?: AbortSignal
  ): Promise<CategoryQuestionResult>;
}
```

DTO 不包含 hash。Port 由 `CategoryQuestionService`（agent-app/composition）实现，注入到 Web channel。

### D5: Web API 路由设计

`GET /api/v1/category-questions?locale=zh-CN`

与 `GET /api/v1/skills` 同形：
- identity resolver → owner scope
- `activeAgentId` → agent scope
- 不接受 request body
- 响应通过 TypeBox schema 校验
- 注入到 `WebChannelDependencies`

### D6: Locale 规范化策略

normalize 逻辑：取 BCP 47 locale 的 `-` 前部分，小写。`zh-CN` → `zh`，`en-US` → `en`。文件不存在时回退到 `zh`。

locale 来源：前端从 `site.locale` 获取（`agent-app-frontend-hosting` 的 `createStandalonePreludeLoaderSource` 中定义 `site.locale`）。本地开发默认 `zh-cn`。

### D7: 前端组件切换容器

输入框上方区域重构为 `QuickOperatorArea` 容器组件，接收一个内部参数控制渲染内容。默认渲染分类问题组件。参数不走后端 API，由前端自行管理。

本次不实现切换参数的 UI 控件，只在代码层面做好组件化拆分，默认渲染分类问题组件。

### D8: 问题块布局策略

问题块使用 CSS Grid 或 Flex 实现响应式列数：
- immersive/local: `grid-template-columns: repeat(2, 1fr); gap: 8px;`
- collaborative: 根据 `body[data-nextagent-host-mode="collaborative"]` 和输入框宽度动态切换 1 列 / 2 列
- collaborative 模式下通过 ResizeObserver 监听输入框宽度，达到 1080px 时切换为 2 列

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 分类问题路径仅来自 trusted AgentPackageSourceLocator，不从请求体获取。API 通过 identity resolver 校验 owner scope，使用 activeAgentId 作为 agent scope。日志不包含问题文本。 | contract 测试：API scope 校验、路径不可外部覆盖 |
| 性能/容量 | JSONL 文件在启动时一次性加载到内存，查询时直接读内存，无 IO。文件大小预期 < 1MB（几百个问题）。locale 回退不产生额外 IO（回退文件也在启动时加载）。 | 单元测试：加载性能、内存 Catalog 查询 |
| 可靠性/恢复 | JSONL 单行校验失败不中断整体解析。文件缺失不阻断应用启动。Port 查询失败时 API 返回 503 safe error。 | contract 测试：部分行损坏、文件缺失 |
| 可维护性 | 复用 skill discovery 架构模式，放在同目录下。Port 契约在 agent-contracts，实现在 agent-app，路由在 agent-channel-web。跨 package 通过 public export 协作。 | 架构检查：无 private path import |
| 可测试性 | Discovery 支持注入自定义 resourceRoot 进行测试。Port 接口可 mock。Web API 可通过 Fastify inject 测试。 | contract 测试、单元测试 |
| 审计/可追溯性 | readiness evidence 通过 structured logging 记录，包含 outcomeCode 和 agentId。日志不包含问题内容。 | 单元测试：evidence 产出 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| JSONL 结构校验（questions XOR records） | T2 | contract 测试 |
| 二级分类无 records 字段 | T2 | contract 测试 |
| Locale 规范化和回退 | T3 | 单元测试 |
| Readiness evidence 产出 | T4 | 单元测试 |
| 内存 Catalog agent scope 隔离 | T4 | 单元测试 |
| Hash 不暴露给 API | T6 | contract 测试 |
| API owner scope + agent scope 校验 | T6 | contract 测试 |
| Web channel 通过 Port 查询 | T6 | 架构检查 |
| Chip 渲染复用 Skill chip 逻辑 | T8 | 前端组件测试 |
| Modal 布局和尺寸 | T9 | 前端组件测试 |
| 问题块响应式列数 | T9 | 前端组件测试 |
| 输入框上方区域可切换 | T7 | 前端组件测试 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/category-question-source/spec.md`、`openspec/specs/category-question-api/spec.md`、`openspec/specs/category-question-ui/spec.md`、`openspec/specs/skill-selector-ui/spec.md`
- 模块设计：`openspec/designs/modules/agent-capability.md`（`CategoryQuestionResourceDiscovery` 模块职责）、`openspec/designs/modules/agent-channel-web.md`（`category-questions` 路由）
- 架构设计：无新增跨模块设计（复用现有 skill discovery 架构模式）
- ADR：无新增长期技术决策
- 导航：`openspec/designs/spec-to-design-map.md` 更新

## 风险与取舍（Risks / Trade-offs）

- [风险] JSONL 文件变更后需要重启应用才能生效 -> 可接受，与 skill 同策。未来如需热更新可通过 OpenSpec change 引入文件 watcher。
- [风险] 问题 hash 基于 text，文件更新问题文本后 hash 变化 -> 可接受。本次不持久化 hash，未来高频问题组件引入 DB 时再评估是否需要稳定 ID。
- [取舍] 不复用 CapabilityDiscovery 接口 -> 分类问题不是 capability，强行套用会增加不必要的 governance 开销。
- [取舍] 前端组件切换参数不走后端 -> 本次需求是前端内部切换，不需要服务端治理。未来如需服务端控制可通过 bootstrap config 扩展。

## 迁移计划（Migration Plan）

无迁移风险。新增功能不修改现有行为。`skill-selector-ui` 的 MODIFIED requirement 仅扩展输入框上方区域为可切换容器，不改变 Skill 选择栏的现有渲染逻辑。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/category-question-source/spec.md`：新增分类问题资源发现行为契约
- `openspec/specs/category-question-api/spec.md`：新增分类问题查询 API 行为契约
- `openspec/specs/category-question-ui/spec.md`：新增分类问题前端组件行为契约
- `openspec/specs/skill-selector-ui/spec.md`：修改输入框上方区域为可切换容器
- `openspec/overview.md`：新增分类问题推荐机制背景
- `openspec/designs/modules/agent-capability.md`：新增 `CategoryQuestionResourceDiscovery` 模块设计
- `openspec/designs/modules/agent-channel-web.md`：新增 `category-questions` 路由设计
- `openspec/designs/spec-to-design-map.md`：新增 3 个 spec 到 design 的导航

## 待确认问题（Open Questions）

无。所有关键设计决策已在 explore 阶段与用户对齐。
