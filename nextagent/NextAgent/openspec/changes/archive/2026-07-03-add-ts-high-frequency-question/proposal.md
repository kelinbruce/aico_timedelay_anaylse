## 背景与问题（Why）

NextAgent 已实现分类问题推荐（`add-ts-category-question`），通过 `agents/{agentId}/resource/category-question-{locale}.jsonl` 提供静态预设问题。现有高频问题组件（`agent-web-high-frequency-questions` spec）仅在 WelcomeState 渲染 4 个 i18n 硬编码问题，没有用户行为数据、没有 DB 持久化、没有动态排序。

电信网络运维场景下，用户反复提问相似问题，需要一个能根据用户行为自动学习并推荐高频问题的能力。同时用户需要能主动"添加到常问"某个问题，以及通过输入联想快速找到历史问题。

本次 change 建立用户问题活动持久化机制（`user_question_activity` 表），实现高频问题动态排序和"添加到常问"交互，为后续输入联想能力奠定数据基础。

## 变更范围（What Changes）

**新增 DB 表**：
- 在 `agent-platform-gateway-local` SQLite 中新增 `user_question_activity` 表，承载 owner-scoped + agent-scoped 的问题级用户行为数据（`is_pinned`、`ask_frequency`、`last_asked_at`、来源分类、locale）
- 问题标识使用 `SHA-256(question text)` 作为 hash，与分类问题内存 Catalog 中预埋的 hash 对齐
- `ask_frequency` 在用户每次提交问题时自动 +1
- `is_pinned` 通过"添加到常问" API 显式设置

**新增 Port 契约**：
- 在 `agent-contracts/runtime` 中新增 `FrequentQuestionPort`，定义 `listFrequentQuestions(agentId, locale)` 和 `pinQuestion(command)` / `unpinQuestion(command)` 方法
- 在 `agent-contracts/gateway` 中新增 `UserQuestionActivityRecord` 和对应 store gateway port

**新增 Web API**：
- `GET /api/v1/frequent-questions?locale=zh-CN` — 返回合并排序后的高频问题列表
- `POST /api/v1/user-questions/pin` — 添加问题到常问列表
- `DELETE /api/v1/user-questions/pin` — 从常问列表移除问题
- 提交请求时（`POST /api/v1/sessions/:sessionId/requests`）自动更新 `ask_frequency`

**高频问题排序**：
1. `fixed=true` 的静态问题（from 内存目录）
2. 用户「添加到常问」的问题（from DB, `is_pinned=true`）
3. 用户提问频率 > 8 的问题（from DB, `ask_frequency > 8`）
4. 剩余静态问题（from 内存目录，挨个取）
5. 以上全为空 → i18n 硬编码 4 个默认问题（现有行为）

**前端「添加到常问」交互**：
- 用户消息 hover 时，在复制和编辑图标之间新增「添加到常问」图标
- 图标使用 `PlusOutlined`（未添加态）/ `CheckOutlined`（已添加态）
- Tooltip："收藏此问题，用于快速提问和输入联想"
- 点击后调用 pin API，图标切换为已添加态

**前端 GuideArea 容器**：
- WelcomeState 中的高频问题区域重构为参数化 `GuideArea` 容器
- 容器通过参数控制渲染 HighFrequencyQuestions 或自定义组件，默认渲染 HighFrequencyQuestions
- HighFrequencyQuestions 组件从静态 i18n 硬编码改为调用 `GET /api/v1/frequent-questions` 获取动态排序问题列表
- 当 API 返回空列表时 fallback 到 i18n 硬编码 4 个默认问题

**本次不做**：
- 输入联想（`GET /api/v1/question-suggestions`）留到后续 change
- 问题级 annotation（点赞/点踩）不在本次范围
- `ask_frequency` 的自动增长在 submit 路径中实现，不暴露独立 API

## Capability 影响（Capabilities）

### 新增 Capability
- `user-question-activity`: 用户问题活动持久化——`user_question_activity` 表存储 owner-scoped + agent-scoped 的问题级用户行为（pin、frequency、last asked），问题标识使用 SHA-256 hash
- `frequent-question-api`: 高频问题查询 Web API——`GET /api/v1/frequent-questions` 返回合并排序后的高频问题列表，`POST/DELETE /api/v1/user-questions/pin` 管理常问问题
- `high-frequency-question-ui`: 高频问题前端组件——GuideArea 参数化容器、HighFrequencyQuestions 动态数据获取、用户消息「添加到常问」图标交互

### 修改的 Capability
- `agent-web-high-frequency-questions`: HighFrequencyQuestions 组件从静态 i18n 硬编码改为调用 API 获取动态排序问题列表，空列表时 fallback 到 i18n 硬编码默认问题

## 影响范围（Impact）

**后端代码**：
- `packages/agent-contracts/src/runtime/`：新增 `FrequentQuestionPort`、`FrequentQuestionRequest`、`FrequentQuestionResult` 及 DTO 类型
- `packages/agent-contracts/src/gateway/`：新增 `UserQuestionActivityRecord`、`UserQuestionActivityStoreGateway` 及查询/写入 port
- `packages/agent-platform-gateway-local/src/db/sqlite-gateway-stores.ts`：新增 `user_question_activity` 表 DDL 和 store 实现
- `packages/agent-app/src/composition/`：新增 `FrequentQuestionService` 实现 `FrequentQuestionPort`，在 `create-app.ts` 中组装
- `packages/agent-app/src/composition/create-app.ts`：在 submit 路径中注入 `ask_frequency` 自动增长逻辑
- `packages/agent-channel-web/src/routes/requests.ts`：新增 3 个 API 路由

**前端代码**：
- `frontend/agent-web/src/features/chat/components/TurnBlock.tsx`：用户消息 BubbleActions 新增「添加到常问」图标
- `frontend/agent-web/src/features/welcome/components/WelcomeState.tsx`：重构为 GuideArea 容器
- `frontend/agent-web/src/features/high-frequency-questions/components/HighFrequencyQuestions.tsx`：改为调用 API 获取动态问题列表
- 新增 `frontend/agent-web/src/features/guide/components/GuideArea.tsx`：参数化容器
- 新增 `frontend/agent-web/src/services/frequentQuestionService.ts`：API 调用
- 新增 `frontend/agent-web/src/state/pinnedQuestionStore.ts`：管理常问状态

**测试**：
- DB store 的 contract 测试（CRUD、scope 隔离、frequency 增长）
- API scope 校验和响应 DTO 测试
- 排序逻辑测试（5 层优先级）
- 前端组件渲染和交互测试

**部署**：
- SQLite schema 自动迁移（新增 `user_question_activity` 表）
- 无配置文件变更

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/user-question-activity/spec.md`：新增
- `openspec/specs/frequent-question-api/spec.md`：新增
- `openspec/specs/high-frequency-question-ui/spec.md`：新增
- `openspec/specs/agent-web-high-frequency-questions/spec.md`：修改（动态数据获取 + GuideArea）

长期背景：
- `openspec/overview.md`：新增高频问题推荐机制和用户问题活动持久化的背景摘要

设计视图：
- `openspec/designs/modules/agent-platform-gateway-local.md`：新增 `user_question_activity` 表设计
- `openspec/designs/modules/agent-app.md`：新增 `FrequentQuestionService` 组装和 submit 路径 frequency 增长
- `openspec/designs/modules/agent-channel-web.md`：新增 3 个路由设计
- `openspec/designs/architecture/`：无需新增跨模块设计（复用现有 gateway 和 composition 模式）

验证入口：
- DB store contract 测试
- API scope 校验和排序逻辑测试
- 前端组件渲染和交互 e2e 测试
