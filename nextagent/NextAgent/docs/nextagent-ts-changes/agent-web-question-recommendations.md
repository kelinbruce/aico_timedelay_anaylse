# agent-web-question-recommendations

规划入口：[roadmap-v2 扩展候选](../nextagent-ts-change-roadmap-v2.md)
所属分组：AgentWeb 前端
对应能力：F16 产品分类问题推荐
优先级：P2

状态：assumption-ready
类型：实施 change
主要 owner：`agent-channel-web`
协作 owner：`agent-web`
依赖：`ship-ts-minimal-agent-kernel`

目标：
- `GET /api/v1/questions/recommended` 返回两级分类推荐问题（`category` -> `subCategory` -> `questions[]`）。
- 前端在 welcome state 展示，支持分类折叠，点击后作为新请求提交。

规格输入：
- 推荐问题数据来源于产品配置文件（app config），不从模型生成、不从用户输入采集、不持久化到 session store。
- `GET /api/v1/questions/recommended` 为公开端点（不需要 owner 认证），返回 `RecommendedQuestionsResponse`。
- `RecommendedQuestionsResponse` 结构为 `categories: RecommendedQuestionCategory[]`，每个 `RecommendedQuestionCategory` 包含 `category: string`、`subCategories: RecommendedQuestionSubCategory[]`。
- 每个 `RecommendedQuestionSubCategory` 包含 `subCategory: string`、`questions: RecommendedQuestion[]`。
- 每个 `RecommendedQuestion` 包含 `text: string`（展示文本）、`requestText: string`（提交为新请求时的输入文本，可与 `text` 不同）。
- 推荐问题内容 MUST 经过 redaction policy，不得包含敏感配置、路径或 credential。
- 端点返回内容 MUST 经过 schema validation，非法配置在启动时产生 safe error 而非运行时崩溃。
- 点击推荐问题后作为新请求提交，复用现有 `POST /api/v1/sessions/{sessionId}/requests` 语义，不新增独立提交路径。
- 端点 MUST 支持 rate limiting。

契约输入：
- `RecommendedQuestionsResponse`、`RecommendedQuestionCategory`、`RecommendedQuestionSubCategory`、`RecommendedQuestion`（`agent-channel-web` schema/projection 层 DTO）。
- app config（`agent-app`）：推荐问题配置文件的 schema 和加载。
- `POST /api/v1/sessions/{sessionId}/requests`（`agent-channel-web`）：现有 request 提交端点，推荐问题点击后复用。

实现约束：
- `agent-channel-web` 拥有 HTTP route、schema validation、DTO projection 和 rate limiting。
- 推荐问题配置文件由 app composition 在启动时加载和校验，不在运行时动态读取。
- `agent-web` 负责前端 welcome state 展示、分类折叠和点击提交交互。
- 配置文件格式 MUST 有明确 schema（JSON 或 YAML），非法配置在启动时 fail-closed。
- 端点不依赖 session state、request run 或 capability invocation，为纯配置读取。

非目标：
- 不定义推荐问题的个性化或动态推荐算法。
- 不定义推荐问题的多语言 variants（首版只支持配置文件中定义的固定文本）。
- 不定义推荐问题的 analytics 或点击统计。
- 不改变现有 welcome state 的其他行为。
- 不定义推荐问题的服务端持久化或更新。

验收要点：
- contract test：`RecommendedQuestionsResponse` 及子结构 schema 覆盖。
- integration test：端点返回两级分类结构。
- security test：端点不泄露敏感配置。
- resilience test：非法配置文件在启动时 fail-closed。
- 验证：`npm run build`、`npm test`、`npm run test:contract`。

并行边界：
- 不修改现有 `POST /api/v1/sessions/{sessionId}/requests` 契约（只复用）。
- 不侵入 `agent-session` 或 `agent-runtime` 的 request lifecycle。
- 不侵入 `agent-app` 的 config schema（只消费配置，不修改 config contract）。
- `agent-web-customization` 可并行推进，两者不耦合。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
- 标为 `assumption-ready` 的条目在 proposal 阶段需显式固化默认假设（配置文件路径、rate limit 阈值、分类层级上限）。
