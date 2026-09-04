## 背景与问题（Why）

`!364` 已落地高频问题基础设施：`user_question_activity` 表、`FrequentQuestionService` 五层合并排序、pin API 和 welcome 页 `HighFrequencyQuestions` 卡片。但当前高频问题数据的唯一消费出口是 welcome 页静态卡片，用户打字时输入框没有任何联想能力。

用户在输入框打字时需要实时联想，联想结果来自三个已落地数据源：用户 pin 的问题（DB）、高频问题（DB）和静态注册问题（内存目录），且每条结果需要带来源分类标签用于纯视觉展示。

## 变更范围（What Changes）

- **新增** `GET /api/v1/question-association` 端点：接收必填 `keyword`（trim 后非空）和可选 `locale` 查询参数，返回按优先级合并排序的联想问题列表（top 20）。
- **新增** `FrequentQuestionPort.listQuestionAssociations()` 方法：在 service 层全量加载三层来源（pinned / high-frequency / static），对每层做 case-insensitive 子串匹配，按 hash 去重，按优先级 pinned > high-frequency > static 排序，截断 top 20。
- **新增** 来源标签 DTO：每条联想结果带 `source` 字段（`"pinned" | "high-frequency" | "static"`），纯视觉展示用。
- **新增** 每层 cap 级联填充策略：pinned cap=10、high-frequency cap=5、static cap=5，剩余 slot 向下级联回填，总和不超过 20。
- **新增** 前端联想面板：在 `MessageInput` 中新增联想浮层，输入普通文本时触发（debounce），与斜杠命令面板互斥，键盘交互复用斜杠面板模式（↑↓ 导航 / Enter/Tab 选中 / Esc 关闭）。
- **新增** 前端 `questionAssociationService`：调用联想 API，带 debounce 和 loading 状态管理。
- **扩展** `FrequentQuestionService` 实现：新增 `listQuestionAssociations` 方法，复用现有 `listPinned` / `listHighFrequency` / `loadCatalog` 数据源。

## 不在范围内（Explicit Non-Goals）

- 不修改现有 `GET /api/v1/frequent-questions` 端点及其 DTO（现有 spec 明确禁止暴露来源信息）。
- 不修改现有 `HighFrequencyQuestions` welcome 页卡片行为。
- 不新增 unpin API（现有 spec 明确不提供）。
- 不引入后端 LIKE 查询或全文检索（关键词过滤在 service 层 in-memory 完成）。
- 不实现分词、拼音、编辑距离等高级匹配（仅 case-insensitive 子串包含）。
- 不在联想结果中提供 unpin / 管理 / 删除操作（来源标签仅纯视觉展示）。
- 不在空关键词时触发联想（含 trim() 后为空）。

## Capability 影响（Capabilities）

### 新增的 Capability

- `question-association-api`：联想问题查询 API，包含端点定义、DTO、Port 扩展、service 层关键词匹配 + 三层合并排序 + cap 级联填充。
- `question-association-ui`：输入框联想面板 UI，包含触发规则、键盘交互、来源标签视觉展示。

## 影响范围（Impact）

- `agent-contracts/runtime`：`FrequentQuestionPort` 新增 `listQuestionAssociations` 方法，新增 `QuestionAssociationQuery` / `QuestionAssociationResult` / `QuestionAssociationEntryDto` 类型。
- `agent-channel-web`：`routes/requests.ts` 新增 `GET /api/v1/question-association` 路由，新增 `question-association-query.ts` schema。
- `agent-app`：`createFrequentQuestionService` 扩展实现 `listQuestionAssociations`。
- `frontend/agent-web`：`MessageInput` 扩展联想面板，新增 `questionAssociationService.ts`。
- 不改变跨 package 边界，Web channel 仍通过注入的 `FrequentQuestionPort` 查询，不直接依赖 gateway。
- 不改变持久化层，复用现有 `listPinned` / `listHighFrequency` / `loadCatalog`。
