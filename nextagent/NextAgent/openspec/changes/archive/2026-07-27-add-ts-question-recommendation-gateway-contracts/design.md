## 当前实现基线（Current Baseline）

### Gateway contract 与 binding

- `packages/agent-contracts/src/gateway/index.ts` 定义 `GatewayBindings` 和 `WorkingMemoryGatewayBindings`。后者当前聚合 request run、session、message、fork、attachment、active context、timeline、checkpoint、pending input、conversation annotation 和 conversation share gateway。
- `GatewayAdapterKind` 已包含 `"working-memory"`；当前没有问题推荐专用 kind，也没有 `QuestionRecommendationGateway`。
- gateway subpath 已使用 TypeScript interface 加导出的 `JsonObject` runtime schema 表达不可信边界，例如 RAG retrieval request/result。慢边界方法接收 `AbortSignal`。
- 正式问题推荐尚无 app service、Web route、前台 consumer 或 local/remote adapter，因而当前运行路径无法从统一 contract 查询历史高频问题或预置相似问题。

### Conversation annotation

- `ConversationAnnotationRecord` 是 `agent-contracts/gateway` 的 gateway-owned persistence DTO，按 `OwnerScoped + agentId + sessionId + requestRunId` 定位，当前包含 `sentiment`、`isFavorited` 和 `comment`。
- `ConversationAnnotationStoreGateway.saveAnnotation()` 实现 partial upsert；`listFavoriteTurns()` 仅查询 `is_favorited=1`；`listSessionAnnotations()` round-trip 当前记录字段。
- SQLite adapter 在专用 `conversation_annotations` 表中保存 annotation。启动建表后通过 `ensureColumn()` 为既有数据库补列，当前表没有 `question_favorite`。
- 当前空标注判定为 `sentiment=null && isFavorited=false`，`comment` 不阻止物理删除。该判定无法保留仅有问题收藏的记录。
- `packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts` 已覆盖 scope 隔离、partial upsert、空行删除和 answer favorite 查询；目前没有问题收藏覆盖。

## 目标设计（Proposed Design）

本设计采用 proposal 中“唯一 Working Memory 问题推荐 gateway”和“问题收藏独立于回答收藏”的目标，实施最小 contract 与 SQLite delta。remote adapter、application service、Web API 和前台接入仍按 proposal 非目标处理。

现有 `question-recommendation` capability 拥有回答完成后的 `SuggestedQuestionPort`、Web API 和前台 Suggested Questions 行为。本 change 在同一 capability 下增加数据来源 gateway contract，但不修改 `SuggestedQuestionPort` 的触发、模型生成、输出清洗、Web route 或前台行为；两者不形成可互换的 fallback。

### 1. Canonical QuestionRecommendationGateway

`packages/agent-contracts/src/gateway/index.ts` 是问题推荐 contract 的唯一 owner。新增以下类型，并从现有 `@nextagent/agent-contracts/gateway` public subpath 导出：

```ts
interface ListFrequentHistoryQuestionsRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly limit: number;
  readonly locale?: RequestLocale;
}

interface FrequentHistoryQuestion {
  readonly content: string;
  readonly frequency: number;
}

interface ListFrequentHistoryQuestionsResult {
  readonly questions: readonly FrequentHistoryQuestion[];
}

interface RecommendSimilarPresetQuestionsRequest extends OwnerScoped {
  readonly agentId: AgentId;
  readonly query: string;
  readonly limit: number;
  readonly locale?: RequestLocale;
  readonly product?: string;
  readonly domain?: string;
  readonly scene?: string;
}

interface PresetQuestionRecommendation {
  readonly questionId: string;
  readonly content: string;
}

interface RecommendSimilarPresetQuestionsResult {
  readonly questions: readonly PresetQuestionRecommendation[];
}

interface QuestionRecommendationGateway {
  listFrequentHistoryQuestions(
    request: ListFrequentHistoryQuestionsRequest,
    signal?: AbortSignal
  ): Promise<ListFrequentHistoryQuestionsResult | SafeError>;

  recommendSimilarPresetQuestions(
    request: RecommendSimilarPresetQuestionsRequest,
    signal?: AbortSignal
  ): Promise<RecommendSimilarPresetQuestionsResult | SafeError>;
}
```

`WorkingMemoryGatewayBindings` 增加：

```ts
readonly questionRecommendations?: QuestionRecommendationGateway;
```

该字段保持可选，因为本 change 不提供产品 adapter。可选性只表达 deployment readiness，不建立第二套推荐来源。不得修改 `GatewayBindings` 顶层 shape 或 `GatewayAdapterKind`。

### 2. Runtime schema 与失败边界

四个 canonical 数据对象分别具有导出的 `JsonObject` schema：

- `listFrequentHistoryQuestionsRequestSchema`
- `listFrequentHistoryQuestionsResultSchema`
- `recommendSimilarPresetQuestionsRequestSchema`
- `recommendSimilarPresetQuestionsResultSchema`

全部 object schema 使用 `additionalProperties: false`。静态约束如下：

| 对象 | 字段 | 约束 |
|---|---|---|
| 两类 request | `tenantId`, `subjectId`, `agentId` | 必填非空字符串 |
| 历史 request | `limit` | 必填整数，1..10 |
| 历史 request | `locale` | 可选字符串，1..10 |
| 历史 result item | `content` | 必填非空字符串 |
| 历史 result item | `frequency` | 必填整数，0..2147483647 |
| 历史 result | `questions` | 必填数组，最多 10 项 |
| 相似 request | `query` | 必填字符串，1..512 |
| 相似 request | `limit` | 必填整数，1..20 |
| 相似 request | `locale` | 可选字符串，1..10 |
| 相似 request | `product` | 可选字符串，匹配 `^[a-zA-Z0-9-]{1,64}$` |
| 相似 request | `domain`, `scene` | 可选字符串，1..128 |
| 相似 result item | `questionId`, `content` | 必填非空字符串 |
| 相似 result | `questions` | 必填数组，最多 20 项 |

adapter 必须在外部调用前验证 request，在构造 canonical result 后验证 result。除 schema 静态上限外，adapter 还必须保证返回条目数量不超过本次 request 的 `limit`；超过时按原顺序截断到 `limit` 后再执行 result validation。空数据统一规范化为 `questions: []`，不得使用 `undefined`。

gateway 失败统一使用 `SafeError`，不把 provider error body、URL、credential 或原始异常暴露给 consumer：

| 条件 | `SafeError.code` | category | retryable |
|---|---|---|---|
| canonical request validation 失败 | `QUESTION_RECOMMENDATION_INVALID_INPUT` | `VALIDATION` | `false` |
| AbortSignal 已取消或调用中取消 | `QUESTION_RECOMMENDATION_CANCELED` | `CANCELED` | `false` |
| provider 不可用、超时或调用失败 | `QUESTION_RECOMMENDATION_UNAVAILABLE` | `UNAVAILABLE` | `true` |
| provider 成功响应无法映射为合法 canonical result | `QUESTION_RECOMMENDATION_INVALID_PROVIDER_RESULT` | `UNAVAILABLE` | `true` |

超时归一为 `UNAVAILABLE` 是该 gateway 的 consumer contract：本 change 不增加独立 timeout 配置或 timeout error code。adapter 的内部 observability 可以保留低基数失败原因，但不得记录查询文本、推荐内容、Owner Scope 标识或 provider raw error。

### 3. Provider wire mapping

remote adapter 不在本 change 实现，但 canonical contract 必须能够无损承载两条既定 service operation。未来 adapter 只有以下唯一映射，不把 provider DTO 泄漏到 contract：

#### 历史高频问题

`POST /rest/naie/memory/v1/user/portrait`

| Canonical request/result | Provider wire |
|---|---|
| `tenantId` | body `tenantId` |
| `subjectId` | body `userId` |
| `agentId` | body `agentId` |
| `limit` | body `searchCriteria.questionTopN` |
| 固定行为 | body `portraitType=["QUESTION"]` |
| `locale` | header `system-language`；缺失时不发送 |
| result `questions[].content` | response `questions[].value` |
| result `questions[].frequency` | response `questions[].count` |
| result `{ questions: [] }` | response 未返回 `questions` |

#### 预置相似问题

`POST /rest/naie/memory/v2/recommendation/similar-question`

| Canonical request/result | Provider wire |
|---|---|
| `query` | body `query` |
| `limit` | body `topn` |
| `locale`, `product`, `domain`, `scene` | 同名 body 字段；缺失时不发送 |
| `agentId`、Owner Scope | 只用于 NextAgent 可信 scope 和 adapter 调用上下文，不写入该 provider body |
| result `questions[].questionId` | response `data[].questionId` |
| result `questions[].content` | response `data[].content` |
| result `{ questions: [] }` | 成功响应未返回 `data` |

`agentName` 不进入 canonical request。当前可信 Agent Scope 使用 `agentId`，而 provider `agentName` 是可选检索维度且语义不同；把二者直接互映会产生错误的身份语义。若未来产品必须按 provider `agentName` 过滤，必须由后续 change 定义其可信配置来源和 contract，而不是在 adapter 中把 `agentId` 静默改名。

### 4. Conversation annotation 字段与 SQLite 映射

`ConversationAnnotationRecord` 增加：

```ts
readonly isQuestionFavorited?: boolean;
```

该字段与现有 `isFavorited` 同属一个 request-run annotation fact。字段不是 nullable：`undefined` 只在 write input 中表示不修改；读取结果必须返回显式布尔值。SQLite 使用以下唯一映射：

| Contract | SQLite | 写入与读取 |
|---|---|---|
| `isQuestionFavorited` | `question_favorite INTEGER NOT NULL DEFAULT 0 CHECK (question_favorite IN (0, 1))` | `true ↔ 1`，`false ↔ 0` |

新数据库的 `CREATE TABLE` 直接包含该列。既有数据库在 schema 初始化后通过 `ensureColumn("conversation_annotations", "question_favorite", "INTEGER NOT NULL DEFAULT 0 CHECK (question_favorite IN (0, 1))")` 补列；已有记录得到默认值 0。无需创建新表或新增索引，因为本 change 不提供按问题收藏独立列表查询。

`saveAnnotation()` 在同一 SQLite transaction 内按以下规则求目标值：

```text
nextSentiment = input.sentiment !== undefined ? input.sentiment : stored.sentiment
nextAnswerFavorite = input.isFavorited !== undefined ? input.isFavorited : stored.is_favorited === 1
nextQuestionFavorite =
  input.isQuestionFavorited !== undefined
    ? input.isQuestionFavorited
    : stored.question_favorite === 1

delete row iff
  nextSentiment === null
  && nextAnswerFavorite === false
  && nextQuestionFavorite === false
```

INSERT 时缺失的两个 favorite 字段均取 `false`。insert、update、row mapper 和 method return 均包含 `isQuestionFavorited`。`listFavoriteTurns()` 的 SQL predicate 继续只使用 `is_favorited=1`；`question_favorite` 不参与 answer favorite 投影。现有 `deleteAnnotationsByRun()` 和 session composite delete 按整行清理，无需改变调用链。

### 5. 明确保持不变的边界

- `UserQuestionActivityStoreGateway`、Pin 写入、高频问题排序与问题联想 contract 不修改。
- 既有 `SuggestedQuestionPort`、suggested-questions Web route 和前台组件不修改，也不改为消费本 change 的 gateway。
- `ConversationAnnotationStoreGateway` 不增加专用“问题收藏”方法；既有 `saveAnnotation()` partial upsert 已是同形写入边界。
- 不增加 `QuestionFavoriteRecord`、新业务表或跨 session 聚合 gateway。
- 不修改 `ConversationAnnotationRecord` 的 request-run 锚点、唯一约束、idempotency option 或 cleanup owner。
- 不让 `questionRecommendations` 成为 `SqliteGatewayStoreBindings` 成员；SQLite 只承担 conversation annotation 字段持久化，不伪造远程推荐能力。

## 备选方案（Alternatives Considered）

### 将问题推荐作为顶层 GatewayBindings

未选择。两类查询属于 Working Memory service 能力，顶层 binding 会与现有 deployment adapter 粒度形成平行概念，并增加新的 adapter kind 与 composition 分支。

### 复用 UserQuestionActivityStoreGateway

未选择。该 gateway 拥有本地问题活动 persistence 语义，正式推荐是可取消的远程查询。复用会把 persistence record、Pin 行为和 provider DTO 混在同一 port。

### 为问题收藏新建独立 store 或字段复用 isFavorited

均未选择。独立 store 会复制相同 request-run anchor、scope、生命周期和事务边界；复用 `isFavorited` 则会把问题收藏错误地加入 `listFavoriteTurns()`。在现有 annotation 行增加独立布尔字段是最小且语义闭合的方案。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | Owner Scope 和 Agent Scope 只由可信调用上下文提供；runtime schema 拒绝未知字段；SafeError 与 observability 不泄漏 query、结果、身份或 provider raw error。 | contract negative tests、模型语义审查、安全边界审查 |
| 性能/容量 | 两类查询分别限制为最多 10 和 20 项；SQLite 仅增加一个非空整数列，不增加索引或额外查询。 | schema 边界测试、SQLite characterization |
| 可靠性/恢复 | AbortSignal 可取消慢调用；provider 异常统一安全失败；SQLite schema 初始化为既有数据库补列且默认 0；annotation upsert 仍保持单事务。 | cancellation contract review、既有数据库升级测试、store integration tests |
| 可维护性 | provider DTO 只存在于未来 remote adapter；canonical contract 保持单一命名；问题收藏复用同形 annotation upsert，不新建平行 port。 | TypeScript build、architecture test、模型语义审查 |
| 可测试性 | 四个 runtime schema 能独立验证边界；SQLite 的三字段 truth table 可用黑盒 store 测试覆盖。 | contract tests、SQLite integration tests |
| 审计/可追溯性 | 本 change 不新增审计事件；既有 annotation 时间戳和 request-run anchor 足以追踪问题收藏事实，且不把高基数内容写入 telemetry。 | row round-trip 测试、observability 人工审查 |

## 验证策略（Verification Strategy）

- contract tests 编译 public interface，并使用 Ajv 验证四个 JSON schema 的正常值、边界值、未知字段、错误类型和超限输入。
- type-level/architecture 检查验证 `QuestionRecommendationGateway` 仅出现在 `WorkingMemoryGatewayBindings.questionRecommendations`，且没有新增顶层 binding、adapter kind 或 SQLite recommendation binding。
- SQLite integration/characterization tests 从 public `ConversationAnnotationStoreGateway` 调用，覆盖新记录、partial upsert、两个 favorite 共存、最后一个标注取消后的物理删除、Owner/Agent scope 隔离和 `listFavoriteTurns()` 排除纯问题收藏。
- 既有数据库升级测试先创建缺少 `question_favorite` 的 annotation table/row，再启动 gateway，验证补列、默认 false 和后续 round-trip。
- workspace build、contract gate、architecture lint 和相关 package test 验证 public export、跨 package 编译和 minimal kernel non-regression。
- remote HTTP mapping、Web API 和浏览器行为没有产品实现，因此本 change 不建立对应 integration 或 e2e 测试。

## 风险与取舍（Risks / Trade-offs）

- `isQuestionFavorited` 当前锚定 request run，不能直接表达同一问题跨 session 的统一收藏状态。缓解方式是本 change 不建立跨 session 查询承诺，后续产品语义确认后再通过独立 change 定义聚合规则。
- `questionRecommendations` 为可选 binding，consumer 必须显式处理 unavailable。缓解方式是 contract tests 固定 binding 位置，并禁止回退到旧问题活动 store。
- 未来 provider 可能扩展响应字段。canonical result schema 有意拒绝未知字段；remote adapter 必须先投影已定义字段再验证 canonical result，避免把 provider 演进直接暴露给 consumer。
- SQLite `ALTER TABLE ADD COLUMN` 不能为已有列补充约束；本设计只新增带 CHECK 的列，不修改既有列，升级路径保持确定。

## 迁移与回滚（Migration / Rollback）

实施顺序为：先发布可选 contract 与 SQLite 兼容列，再由其他代码库实现 remote adapter，最后由后续 change 增加 application/Web/frontend consumer。当前阶段不要求 remote adapter 与本仓同步上线。

SQLite schema 初始化对既有数据库执行幂等补列。回滚到不认识该列的旧版本时，SQLite 保留额外列，旧查询和写入继续只访问既有列；问题收藏值不会被旧版本读取或修改。若补列失败，gateway 初始化失败，不允许在部分 schema 状态下继续提供 store。升级和回滚验证以既有数据库 fixture 重启为准。

## 确认结论（Confirmed Decisions）

- **已确认（2026-07-25）：** 群内已确认新增 `QuestionRecommendationGateway`、两组 canonical request/result/item、四个 runtime schema、`WorkingMemoryGatewayBindings.questionRecommendations?`，以及 `ConversationAnnotationRecord.isQuestionFavorited?`；可以按本 change 进入代码实施。
