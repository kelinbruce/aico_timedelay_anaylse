## 背景和现状（Context）

NextAgent 已实现分类问题推荐（`add-ts-category-question`），通过 JSONL 文件和内存 Catalog 提供静态预设问题，每个问题有 SHA-256 hash（内部使用）和 `fixed` 标记。现有高频问题组件（`agent-web-high-frequency-questions`）仅在 WelcomeState 渲染 4 个 i18n 硬编码问题，无用户行为数据、无 DB 持久化、无动态排序。

用户消息的 `BubbleActions`（TurnBlock.tsx）已有复制和编辑图标，缺少"添加到常问"功能。现有 `conversation_annotations` 表的收藏是 session turn 级别（收藏回答），不适用于问题级别的用户行为追踪。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 新增 `user_question_activity` SQLite 表，存储 owner-scoped + agent-scoped 的问题级用户行为
- 实现 `ask_frequency` 自动增长（submit 和 edit 路径注入，cancel/retry 不增长）
- 实现 `is_pinned` 显式管理（仅 pin API，无 unpin），pin 数量上限 + 先进先出淘汰
- 实现 `FrequentQuestionService` 合并排序 5 层来源
- 用户消息新增「添加到常问」图标 + toast 提示
- WelcomeState 高频问题区域重构为 `GuideArea` 参数化容器
- HighFrequencyQuestions 从静态 i18n 改为动态 API + fallback，最多展示 3 行

**非目标：**
- 不做输入联想（`GET /api/v1/question-suggestions`），留到后续 change
- 不做问题级 annotation（点赞/点踩），仅复用现有 turn 级 annotation
- 不做 unpin API，用户 pin 了就不能取消
- 不做 `ask_frequency` 的独立管理 API，仅在 submit/edit 路径自动增长

## 设计决策（Decisions）

### D1: user_question_activity 表与 conversation_annotations 分离

不复用 `conversation_annotations` 表。原因：
- annotation 是 turn 级别（收藏某个回答），粒度不同
- annotation 的 `is_favorited` 语义是"收藏回答"，不是"常问问题"
- 问题活动需要 `ask_frequency` 计数字段和 `pinned_at` 时间戳，annotation 表没有也不应该加

新表 `user_question_activity` 独立承载问题级用户行为，遵循 AGENTS.md 的专用业务 store 原则。

### D2: ask_frequency 增长时机

| 路径 | 增长 | 说明 |
|------|------|------|
| submit | +1 | 新问题插入或已有问题 frequency +1 |
| edit | 新问题 +1，旧问题保留 | edit 产生新 inputText，新问题 +1 |
| cancel | 不变 | 频率保留 |
| retry | 不变 | retry 是重跑同一 request，不是新问题 |

submit 和 edit 路径均采用 fire-and-forget 模式，DB 操作失败不阻断主流程。

### D3: is_pinned 仅通过 Pin API 设置

- 只有 `POST /api/v1/user-questions/pin`，没有 unpin
- `ask_frequency` 增长不修改 `is_pinned`
- 重复 pin 同一问题幂等返回成功，不更新 `pinned_at`

### D4: Pin 数量上限与先进先出淘汰

- 配置项 `nextAgent.highFrequencyQuestion.pinLimit`，默认 100
- 达到上限时自动淘汰 `pinned_at` 最早的记录（`is_pinned` 设为 0，`pinned_at` 设为 NULL）
- 淘汰和新增 pin 在同一数据库事务中完成

### D5: FrequentQuestionService 合并排序

`FrequentQuestionService` 位于 `agent-app/composition`，实现 `FrequentQuestionPort`。依赖：
- `CategoryQuestionResourceDiscovery`（内存目录，提供 fixed 和剩余静态问题）
- `UserQuestionActivityStoreGateway`（DB，提供 pinned 和 high-frequency 问题）
- `AgentAssemblyRegistry`（解析 agent scope）

排序逻辑：
1. 从内存目录取所有问题，分出 fixed 和 non-fixed 两组（按 locale 过滤）
2. 从 DB 查 `is_pinned=true` 的问题（按 `pinned_at DESC`，不按 locale 过滤）
3. 从 DB 查 `ask_frequency > threshold` 的问题（按 `ask_frequency DESC`，不按 locale 过滤，排除已出现在 pinned 中的）
4. 合并：fixed → pinned → high-frequency → non-fixed（排除已出现的）
5. 按 `question_hash` 去重

`threshold` 来自配置项 `nextAgent.highFrequencyQuestion.frequencyThreshold`，默认 8。

### D6: Pin API 设计

```
POST /api/v1/user-questions/pin    { question }
```

- owner scope 从 identity resolver 获取
- agent scope 用 `activeAgentId`
- 问题文本在后端计算 hash，不从客户端传入
- 需要 `AuthGate`（`AICOServiceOperation.Write`）权限控制
- 无 unpin API

### D7: 前端「添加到常问」图标

- 位置：user BubbleActions 中，复制和编辑之间
- 图标：始终 `FolderAddOutlined`，不切换状态
- 权限：`AuthGate`（`AICOServiceOperation.Write`）包裹
- 点击后调用 pin API，成功后 toast "已添加至常用问题"，失败后 toast 错误提示
- 重复点击同一问题：后端幂等，前端也显示成功提示
- 超长截断：当问题文本超过 `PIN_QUESTION_MAX_LENGTH`（2000）字符时，前端先 trim 再截断至 2000 字符，弹出 warning toast 提示用户已截断，后端 pin 路由也做 trim + slice(0, 2000) 兜底截断

### D8: GuideArea 与 QuickOperatorArea 同形同策

`GuideArea` 位于 `frontend/agent-web/src/features/guide/components/`，接受 `component` 参数控制渲染内容，默认 `high-frequency-questions`。与 `QuickOperatorArea` 完全同构。

### D9: HighFrequencyQuestions fallback 与截断

```
GET /api/v1/frequent-questions → questions.length > 0 → 渲染返回列表（最多 3 行截断）
GET /api/v1/frequent-questions → questions.length === 0 → i18n 硬编码 4 个默认问题
GET /api/v1/frequent-questions → 请求失败 → i18n 硬编码 4 个默认问题
```

3 行截断由 CSS 或 JS 计算决定（flex-wrap + max-height），不出现垂直滚动条。

### D10: 配置项

`default-system.yaml` 新增：
```yaml
nextAgent:
  highFrequencyQuestion:
    pinLimit: 100
    frequencyThreshold: 8
```

`FrequentQuestionService` 读取 `frequencyThreshold`，`UserQuestionActivityStoreGateway` 读取 `pinLimit`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | pin API 通过 identity resolver 校验 owner scope，AuthGate 校验写权限。问题文本在后端计算 hash。日志不含问题文本。 | contract 测试 |
| 性能/容量 | ask_frequency 增长为 fire-and-forget。frequent-questions 查询合并内存 + DB，有索引。界面最多 3 行截断。 | 单元测试 |
| 可靠性/恢复 | ask_frequency 增长失败不阻断 submit/edit。frequent-questions API 失败时前端 fallback。pin 失败时前端 toast 提示。 | contract 测试 |
| 可维护性 | FrequentQuestionService 独立组合，复用现有 discovery 和 gateway 模式。GuideArea 与 QuickOperatorArea 同形同策。配置项可调。 | 架构检查 |
| 可测试性 | DB store 支持注入测试。Service 接口可 mock。API 通过 Fastify inject 测试。排序逻辑可独立测试。 | contract 测试、单元测试 |
| 审计/可追溯性 | user_question_activity 记录 created_at/updated_at/last_asked_at/pinned_at。日志仅含 low-cardinality 字段。 | 单元测试 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| user_question_activity 表结构 + pinned_at | T2 | contract 测试 |
| 问题 hash SHA-256 一致性 | T2 | contract 测试 |
| submit 时 frequency 增长不阻断 | T4 | contract 测试 |
| edit 时新问题 +1 旧问题保留 | T4 | contract 测试 |
| cancel/retry 不增长 | T4 | contract 测试 |
| is_pinned 不被 frequency 增长修改 | T4 | contract 测试 |
| pin 幂等不更新 pinned_at | T5 | contract 测试 |
| pin 上限先进先出淘汰 | T5 | contract 测试 |
| 5 层合并排序 + 去重 | T6 | 单元测试 |
| pinned/high-frequency 不按 locale 过滤 | T6 | 单元测试 |
| Pin API scope 校验 + AuthGate | T7 | contract 测试 |
| API 响应不暴露 hash/frequency/is_pinned | T7 | contract 测试 |
| 无 unpin API | T7 | contract 测试 |
| 配置项 pinLimit/frequencyThreshold | T3 | 单元测试 |
| 前端 fallback 到 i18n 默认问题 | T9 | 组件测试 |
| 前端最多 3 行截断 | T9 | 组件测试 |
| 添加到常问图标仅在用户消息 | T10 | 组件测试 |
| 图标 AuthGate 权限控制 | T10 | 组件测试 |
| 点击后 toast 提示 | T10 | 组件测试 |
| 图标始终 FolderAddOutlined 不切换 | T10 | 组件测试 |
| GuideArea 参数化 | T8 | 组件测试 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/user-question-activity/spec.md`、`openspec/specs/frequent-question-api/spec.md`、`openspec/specs/high-frequency-question-ui/spec.md`、`openspec/specs/agent-web-high-frequency-questions/spec.md`
- 模块设计：`openspec/designs/modules/agent-platform-gateway-local.md`（表设计）、`openspec/designs/modules/agent-app.md`（FrequentQuestionService + submit/edit 注入）、`openspec/designs/modules/agent-channel-web.md`（路由设计）
- 架构设计：无新增跨模块设计
- ADR：无新增长期技术决策
- 导航：`openspec/designs/spec-to-design-map.md` 更新

## 风险与取舍（Risks / Trade-offs）

- [风险] ask_frequency fire-and-forget 可能丢失计数 -> 可接受。频率是软指标，偶尔丢失不影响核心功能。
- [风险] 无 unpin 意味着用户无法主动移除常问问题 -> 可接受。先进先出淘汰机制保证列表不会无限增长。
- [取舍] 界面不展示已添加态 -> 简化交互，用户不需要区分哪些已添加。重复 pin 幂等。
- [取舍] pinned/high-frequency 不按 locale 过滤 -> 用户 pin 的问题就是想快速访问的，不管当前 locale。

## 迁移计划（Migration Plan）

无迁移风险。新增表和 API 不修改现有行为。`HighFrequencyQuestions` 的 fallback 保证新用户看到默认问题。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/user-question-activity/spec.md`：新增
- `openspec/specs/frequent-question-api/spec.md`：新增
- `openspec/specs/high-frequency-question-ui/spec.md`：新增
- `openspec/specs/agent-web-high-frequency-questions/spec.md`：修改
- `openspec/overview.md`：新增高频问题推荐和用户问题活动背景
- `openspec/designs/modules/agent-platform-gateway-local.md`：新增表设计
- `openspec/designs/modules/agent-app.md`：新增 FrequentQuestionService
- `openspec/designs/modules/agent-channel-web.md`：新增路由设计
- `openspec/designs/spec-to-design-map.md`：新增导航

## 待确认问题（Open Questions）

无。
