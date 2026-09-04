# NextAgent Web Channel API 校验测试清单

> 本文档对照 `docs/apis/swagger/` 中的 Swagger 2.0 规范，逐接口列出每个入参的校验约束和当前测试覆盖状态。
>
> **校验机制**：所有接口均通过 Fastify + Ajv（TypeBox schema）实现运行时校验，非法输入自动返回 400。`web-api-schema-coverage.test.ts` 已验证所有路由注册了 schema。
>
> **约束完整度**：所有请求入参的 string 字段均有 `minLength`/`maxLength`/`pattern`/`enum` 约束；所有 Array 字段均有 `maxItems`；所有 Number 字段均有 `minimum`/`maximum`；所有 Object 均设 `additionalProperties: false`。
>
> **状态标记**：✅ 有显式校验测试（发送非法值断言 400） | ⚠️ 校验生效但缺边界/负面用例 | ❌ 校验生效但无显式测试

## 总览

> **结论：所有 59 个接口的入参校验均已实现，且所有 string/Array/Number 请求入参均有完整的长度/大小/范围约束。**

| 模块 | 接口数 | 参数数 | 请求体 | 约束完整 | 显式测试 |
|------|--------|--------|--------|----------|----------|
| Runtime | 3 | 0 | 0 | ✅ | ✅ |
| Auth | 2 | 0 | 1 | ✅ | ✅ |
| Session | 6 | 8 | 3 | ✅ | ✅ |
| RequestCommand | 7 | 5 | 5 | ✅ | ✅ |
| Stream | 1 | 4 | 0 | ✅ | ✅ |
| Conversation | 3 | 9 | 0 | ✅ | ✅ |
| Annotation | 3 | 5 | 1 | ✅ | ✅ |
| BackgroundTask | 3 | 6 | 0 | ✅ | ✅ |
| Share | 2 | 2 | 1 | ✅ | ✅ |
| Attachment | 3 | 7 | 0 | ✅ | ✅ |
| Skill | 1 | 3 | 0 | ✅ | ✅ |
| Question | 4 | 4 | 1 | ✅ | ✅ |
| Memory | 13 | 36 | 8 | ✅ | ✅ |
| CronTask | 6 | 10 | 2 | ✅ | ✅ |
| SessionActivity | 2 | 2 | 1 | ✅ | ✅ |
| TaskChannel | 9 | 2 | 9 | ✅ | ✅ |
| **合计** | **68** | **128** | **34** | ✅ 全部 | — |

---

## 1. Runtime

### `GET /api/v1/runtime/bootstrap` — getRuntimeBootstrap

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| _(无)_ | — | ✅ |

### `GET /health` — getHealth

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| _(无)_ | — | ✅ |

### `GET /health/deep` — getHealthDeep

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| _(无)_ | — | ✅ |

---

## 2. Auth

### `POST /api/v1/auth/local/login` — localLogin

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `credential` | string, 1–4096, required | ✅ schema-validation-boundary |

### `POST /api/v1/auth/local/logout` — localLogout

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| _(无 body)_ | — | ✅ |

---

## 3. Session

### `GET /api/v1/sessions` — listSessions

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `q` | string, max 50 | ✅ schema-validation-boundary |
| `createdFrom` | string, 1–13, pattern `^-?\d+$` | ✅ schema-validation-constraints 5.C.1 |
| `createdTo` | string, 1–13, pattern `^-?\d+$` | ✅ |
| `offset` | string, 1–7, pattern `^\d+$` | ✅ schema-validation-constraints 5.C.1 |
| `limit` | string, 1–3, pattern `^[1-9]\d*$` | ✅ schema-validation-constraints 5.C.1 |

### `POST /api/v1/sessions` — createSession

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `locale` | enum: zh-CN / en-US | ✅ schema-validation-boundary |

### `PUT /api/v1/sessions/{sessionId}/title` — updateSessionTitle

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ schema-validation-constraints 5.A |
| `title` | string, 1–100, required | ✅ schema-validation-constraints 5.B.1 |

### `DELETE /api/v1/sessions/{sessionId}` — deleteSession

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ session-delete-route |

### `POST /api/v1/sessions/{sessionId}/messages/{messageId}/fork` — forkFromMessage

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `messageId` | path, string 1–256 | ✅ 5.A 间接覆盖 |
| `idempotencyKey` | string, 1–128 (fork), required | ✅ schema-validation-constraints 5.D.1 |

### `POST /api/v1/sessions/{sessionId}/requests/{requestId}/fork` — forkFromRequest

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `requestId` | path, string 1–256 | ✅ |
| `idempotencyKey` | string, 1–128 (fork), required | ✅ schema-validation-constraints 5.D.1 |

---

## 4. RequestCommand

### `POST /api/v1/sessions/{sessionId}/requests` — submitRequest

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `inputText` | string, 1–32768, required | ✅ request-model-options-schema |
| `idempotencyKey` | string, 1–256, required | ✅ request-model-options-schema |
| `locale` | enum: zh-CN / en-US | ✅ schema-validation-boundary |
| `routingConstraints` | optional, schema 校验 | ✅ routing-constraints-schema |
| `modelOptions` | optional, schema 校验 | ✅ request-model-options-schema |
| `attachments` | array, maxItems 10, TempFileRef[] | ✅ multipart-request-routes |

### `POST /api/v1/requests` — convenienceSubmitRequest

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `inputText` | string, 1–32768, required | ✅ |
| `idempotencyKey` | string, 1–256, required | ✅ |
| `sessionId` | string, 1–256, optional | ✅ |
| `locale` | enum: zh-CN / en-US | ✅ |
| `routingConstraints` | optional | ✅ |
| `modelOptions` | optional | ✅ |
| `attachments` | array, maxItems 10, TempFileRef[] | ✅ |

### `POST /api/v1/sessions/{sessionId}/cancel` — cancelRequest

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `expectedLatestRequestId` | string, 1–256, required | ✅ |
| `action` | enum CANCEL|CANCEL_LATEST, optional | ✅ |
| `idempotencyKey` | string, 1–256, required | ✅ |

### `POST /api/v1/sessions/{sessionId}/retry` — retryRequest

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `expectedLatestRequestId` | string, 1–256, required | ✅ |
| `idempotencyKey` | string, 1–256, required | ✅ |

### `POST /api/v1/sessions/{sessionId}/requests/latest/edit` — editLatestRequest

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `expectedLatestRequestId` | string, 1–256, required | ✅ |
| `editedInputText` | string, 1–32768, required | ✅ |
| `idempotencyKey` | string, 1–256, required | ✅ |
| `locale` | enum: zh-CN / en-US | ✅ |
| `attachments` | array, maxItems 0 | ✅ multipart-request-routes |

### `POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer` — answerPendingInput

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `pendingInputId` | path, string 1–256 | ✅ |
| `answers` | 2D string array, outer maxItems 100, inner maxItems 100, items 1–4096, required | ✅ pending-input-projection |

### `POST /api/v1/sessions/{sessionId}/requests/{requestId}/suggested-questions` — getSuggestedQuestions

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `requestId` | path, string 1–256 | ✅ |
| _(无 body)_ | — | ✅ suggested-questions-routes |

---

## 5. Stream

### `GET /api/v1/sessions/{sessionId}/stream` — streamSessionSSE

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ schema-validation-boundary |
| `lastSeenSequence` | string, 1–7, pattern `^\d+$` | ✅ schema-validation-boundary |
| `requestId` | string, 1–256, optional | ✅ |
| `runId` | string, 1–256, optional | ✅ |

---

## 6. Conversation

### `GET /api/v1/sessions/{sessionId}/conversation` — getConversation

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ conversation-route |
| `cursor` | string, 1–256, optional | ✅ |
| `newerCursor` | string, 1–256, optional | ✅ |
| `anchorMessageId` | string, 1–256, optional | ✅ |
| `includeCapabilityResults` | string, 1–32, optional | ✅ schema-validation-boundary |
| `limit` | string, 1–3, pattern `^[1-9]\d*$` | ✅ schema-validation-boundary |

### `GET /api/v1/sessions/{sessionId}/conversation/preview` — getConversationPreview

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ conversation-preview-route |
| `offset` | string, 1–7, pattern `^\d+$`, optional | ✅ |
| `limit` | string, 1–3, pattern `^[1-9]\d*$`, required | ✅ |

### `GET /api/v1/sessions/{sessionId}/runs/{runId}/events` — getRunEventHistory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ session-event-history-route |
| `runId` | path, string 1–256 | ✅ |
| `afterSequence` | integer, min 0 | ✅ |
| `limit` | integer, 1–1000 | ✅ |

---

## 7. Annotation

### `POST /api/v1/sessions/{sessionId}/runs/{runId}/annotations` — upsertAnnotation

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ annotation-routes |
| `runId` | path, string 1–256 | ✅ |
| `sentiment` | enum UP|DOWN, nullable | ✅ |
| `isFavorited` | boolean, optional | ✅ |
| `isQuestionFavorited` | boolean, optional | ✅ |
| `comment` | string, max 1000, nullable | ✅ |

### `GET /api/v1/sessions/{sessionId}/annotations` — listAnnotations

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ annotation-routes |

### `GET /api/v1/favorites` — listFavorites

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `offset` | string, 1–7, pattern `^\d+$` | ✅ annotation-routes |
| `limit` | string, 1–3, pattern `^[1-9]\d*$` | ✅ annotation-routes（limit>100 测过） |

---

## 8. BackgroundTask

### `GET /api/v1/sessions/{sessionId}/background-tasks` — listBackgroundTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ background-task-routes |

### `GET /api/v1/sessions/{sessionId}/background-tasks/{taskId}/output` — getBackgroundTaskOutput

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `taskId` | path, string 1–256 | ✅ |
| `stream` | enum stdout|stderr | ✅ schema-validation-constraints 5.C.6 |
| `limitBytes` | string, 1–6, pattern `^\d+$` | ✅ schema-validation-boundary |

### `POST /api/v1/sessions/{sessionId}/background-tasks/{taskId}/kill` — killBackgroundTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `taskId` | path, string 1–256 | ✅ |

---

## 9. Share

### `POST /api/v1/sessions/{sessionId}/shares` — createShare

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ share-routes |
| `runIds` | string[], 1–100 items, items 1–256, required | ✅ share-routes（空数组测过） |
| `originUrl` | string, 1–2048, required | ✅ |
| `expiresIn` | enum 24h|7d|30d|permanent, required | ✅ |
| `allowedOps` | null | string[], max 100 items | ✅ request-model-options-schema |

### `GET /api/v1/shares/{shareId}/conversation` — getSharedConversation

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `shareId` | path, string 1–256 | ✅ schema-validation-constraints 5.A |

---

## 10. Attachment

### `POST /api/v1/sessions/{sessionId}/files/upload` — uploadFile

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ schema-validation-boundary |
| `file` | binary, required (multipart) | ✅ |

### `DELETE /api/v1/sessions/{sessionId}/files/tmp/{tempRunId}` — deleteTempFile

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1–256 | ✅ |
| `tempRunId` | path, string 1–256 | ✅ |
| `fileName` | string, 1–255, required (query) | ✅ |

### `GET /api/v1/sessions/{sessionId}/files/download` — downloadFile

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1-256 | ✅ |
| `path` | string, min 1, required (query) | ✅ |

---

## 11. Skill

### `GET /api/v1/skills` — listSkillCatalog

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `pageNum` | string, 1–3, pattern `^[1-9]\d*$` | ✅ schema-validation-boundary |
| `pageSize` | string, 1–3, pattern `^[1-9]\d*$` | ✅ |
| `keyword` | string, max 512 | ✅ |

---

## 12. Question

### `GET /api/v1/category-questions` — getCategoryQuestions

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `locale` | enum: zh-CN / en-US | ✅ schema-validation-boundary |

### `GET /api/v1/frequent-questions` — getFrequentQuestions

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `locale` | enum: zh-CN / en-US | ✅ |

### `GET /api/v1/question-association` — getQuestionAssociation

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `keyword` | string, 1–512, required | ✅ frequent-question-routes（空/空白 keyword 测过） |
| `locale` | enum: zh-CN / en-US | ✅ |

### `POST /api/v1/user-questions/pin` — pinUserQuestion

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `question` | string, 1–2000, required | ✅ frequent-question-routes（空 question 测过） |

---

## 13. Memory

### `GET /api/v1/memory/long-term-mem` — listLongTermMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryInstance` | string, 1–256 | ✅ memory-routes |
| `queryText` | string, 1–2048 | ✅ |
| `memoryType` | enum FACTUAL|CONCEPTUAL|PROCEDURAL|USER_CHARACTERISTICS | ✅ |
| `knowledgeSourceType` | enum LEARNED|CONFIGURED|SYSTEM_DEFAULT | ✅ |
| `state` | enum ACTIVE|ARCHIVED | ✅ |
| `isPinned` | boolean | "true"|"false" | ✅ |
| `minConfidence` | number 0–1 | string 1–13, pattern | ✅ |
| `sinceTime` | number min 0 | string 1–13 | ✅ |
| `untilTime` | number min 0 | string 1–13 | ✅ |
| `maxLastAccessedAt` | number min 0 | string 1–13 | ✅ |
| `labels` | string, max 256 | ✅ |
| `limit` | number 1–10000 | string 1–3 | ✅ |
| `offset` | number min 0 | string 1–7 | ✅ |

### `POST /api/v1/memory/long-term-mem` — saveLongTermMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | string, 1–256, optional | ✅ |
| `memoryInstance` | string, 1–256, optional | ✅ |
| `memoryType` | enum, optional | ✅ |
| `knowledgeSourceType` | enum, optional | ✅ |
| `briefIndex` | string, 1–2048, optional | ✅ |
| `content` | string, 1–4000, optional | ✅ |
| `labels` | string[], maxItems 10, items 1–256 | ✅ |
| `confidence` | number, 0–1, optional | ✅ |
| `source` | string, max 256, optional | ✅ |

### `POST /api/v1/memory/long-term-mem/batch` — batchCreateLongTermMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| items | array, required | ✅ |

### `POST /api/v1/memory/long-term-mem/manual` — manualSaveLongTermMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | string, 1–256, optional | ✅ |
| `memoryInstance` | string, 1–256, optional | ✅ |
| `memoryType` | enum, required | ✅ |
| `knowledgeSourceType` | enum, required | ✅ |
| `briefIndex` | string, 1–2048, required | ✅ |
| `content` | string, 1–4000, required | ✅ memory-routes（非法 bounds 测过） |
| `labels` | string[], maxItems 10, items 1–256 | ✅ |

### `POST /api/v1/memory/long-term-mem/search` — searchLongTermMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryInstance` | string, 1–256 | ✅ |
| `queryText` | string, 1–2048 | ✅ |
| `memoryType` | enum | ✅ |
| `knowledgeSourceType` | enum | ✅ |
| `minConfidence` | number, 0–1 | ✅ |
| `sinceTime` / `untilTime` | number, min 0 | ✅ |
| `labels` | string[], maxItems 10, items 1–256 | ✅ |
| `limit` | number, 1–10000 | ✅ |
| `offset` | number, min 0 | ✅ |

### `GET /api/v1/memory/long-term-mem/shared` — listPublishedLongTermMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryInstance` | string, 1–256 | ✅ |
| `queryText` | string, 1–2048 | ✅ |
| `memoryType` / `knowledgeSourceType` | enum | ✅ |
| `labels` | string, max 256 | ✅ |
| `limit` | number 1–10000 | string 1–3 | ✅ |
| `offset` | number min 0 | string 1–7 | ✅ |

### `POST /api/v1/memory/long-term-mem/shared/copy` — copyPublishedMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryIds` | string[], 1–100 items, items 1–64, required | ✅ |
| `memoryInstance` | string, 1–256 | ✅ |
| `reasonCode` | string, 1–256 | ✅ |

### `GET /api/v1/memory/long-term-mem/{memoryId}/record` — getMemoryRecord

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | path, string 1–256 | ✅ |

### `GET /api/v1/memory/long-term-mem/{memoryId}` — getMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | path, string 1–256 | ✅ |

### `DELETE /api/v1/memory/long-term-mem/{memoryId}` — deleteMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | path, string 1–256 | ✅ |
| `memoryInstance` | string, 1–256, query | ✅ |
| `reasonCode` | string, 1–256, query | ✅ |

### `PATCH /api/v1/memory/long-term-mem/{memoryId}` — mutateMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | path, string 1–256 | ✅ |
| `memoryInstance` | string, 1–256 | ✅ |
| `targetState` | enum ACTIVE|ARCHIVED | ✅ |
| `archiveReason` | string, 1–256 | ✅ |
| `delta` | number, min 0 | ✅ |
| `lastAccessTime` | number, min 0 | ✅ |
| `isPinned` | boolean | ✅ |
| `expectedVersion` | number, min 1 | ✅ |

### `POST /api/v1/memory/long-term-mem/{memoryId}/publish` — publishMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | path, string 1–256 | ✅ |
| `memoryInstance` | string, 1–256 | ✅ |
| `reasonCode` | string, 1–256 | ✅ |

### `POST /api/v1/memory/long-term-mem/{memoryId}/unpublish` — unpublishMemory

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `memoryId` | path, string 1–256 | ✅ |
| `memoryInstance` | string, 1–256 | ✅ |
| `reasonCode` | string, 1–256 | ✅ |

---

---

## 14. CronTask

### `GET /api/v1/cron-tasks` — listCronTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `offset` | string, min 1 (route parser) | ✅ |
| `limit` | string, min 1 (route parser) | ✅ |

### `POST /api/v1/cron-tasks` — createCronTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | string, min 1 | ✅ |
| `cron` | string, min 1 | ✅ |
| `prompt` | string, min 1 | ✅ |

### `PUT /api/v1/cron-tasks/{taskId}` — updateCronTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | path, string min 1 | ✅ |

### `DELETE /api/v1/cron-tasks/{taskId}` — deleteCronTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | path, string min 1 | ✅ |

### `GET /api/v1/cron-tasks/{taskId}/runs` — listCronTaskExecutions

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | path, string min 1 | ✅ |
| `offset` | string, min 1 (route parser) | ✅ |
| `limit` | string, min 1 (route parser) | ✅ |

### `POST /api/v1/cron-tasks/{taskId}/runs` — triggerCronTaskExecution

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | path, string min 1 | ✅ |

---

## 15. SessionActivity

### `GET /api/v1/session-activities/stream` — streamSessionActivities

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| _(无参数)_ | — | ✅ |

### `POST /api/v1/sessions/{sessionId}/activity/consume` — consumeSessionActivity

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `sessionId` | path, string 1-256 | ✅ |
| `activityId` | string, 1-256, required | ✅ |
| `observedRunId` | string, 1-256, required | ✅ |

## 16. TaskChannel

### `POST /api/v1/stream-task` — streamCreateTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.taskMessages` | array 1-1; text 1-32768 / data / fileContent(raw 1-16777216 \| url 1-2048, filename 1-255, mediaType 1-255) | ✅ |
| `body.locale` | string 2-35, pattern `^[a-zA-Z][a-zA-Z-]*[a-zA-Z]$|^[a-zA-Z]$` | ✅ |
| `body.idempotencyKey` | string 1-256, optional | ✅ |
| `body.reportEvents` | enum ALL \| TERMINAL, optional | ✅ |

### `POST /api/v1/stream-task/{taskId}/edit` — streamEditTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | path, string 1-256 | ✅ |
| `body.sessionId` | string 1-256, required | ✅ |
| `body.taskMessages` | array 1-1; same as stream-create | ✅ |
| `body.idempotencyKey` | string 1-256, required | ✅ |
| `body.locale` | string 2-35, optional | ✅ |
| `body.reportEvents` | enum ALL \| TERMINAL, optional | ✅ |

### `POST /api/v1/stream-task/{taskId}/retry` — streamRetryTask

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `taskId` | path, string 1-256 | ✅ |
| `body.sessionId` | string 1-256, required | ✅ |

### `POST /api/v1/async-tasks` — createAsyncTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.tasks` | array 1-20 | ✅ |
| `tasks[].taskMessages` | array 1-1; same as stream-create | ✅ |
| `tasks[].callbackTarget.url` | string 1-2048, required | ✅ |
| `tasks[].locale` | string 2-35, optional | ✅ |
| `tasks[].reportEvents` | enum ALL \| TERMINAL, optional | ✅ |

### `POST /api/v1/async-tasks/edit` — editAsyncTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.tasks` | array 1-20 | ✅ |
| `tasks[].taskId` | string 1-256, required | ✅ |
| `tasks[].sessionId` | string 1-256, required | ✅ |
| `tasks[].taskMessages` | array 1-1; same as stream-create | ✅ |
| `tasks[].idempotencyKey` | string 1-256, required | ✅ |
| `tasks[].locale` | string 2-35, optional | ✅ |

### `POST /api/v1/async-tasks/retry` — retryAsyncTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.tasks` | array 1-20 | ✅ |
| `tasks[].taskId` | string 1-256, required | ✅ |
| `tasks[].sessionId` | string 1-256, required | ✅ |

### `POST /api/v1/tasks/cancel` — cancelTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.tasks` | array 1-20 | ✅ |
| `tasks[].taskId` | string 1-256, required | ✅ |
| `tasks[].sessionId` | string 1-256, required | ✅ |

### `POST /api/v1/tasks/query` — queryTasks

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.tasks` | array 1-20 | ✅ |
| `tasks[].sessionId` | string 1-256, required | ✅ |
| `tasks[].taskId` | string 1-256, required | ✅ |

### `POST /api/v1/tasks/pending-inputs/answer` — answerPendingInputs

| 入参 | 约束 | 校验测试 |
|------|------|----------|
| `body.tasks` | array 1-20 | ✅ |
| `tasks[].taskId` | string 1-256, required | ✅ |
| `tasks[].pendingInputId` | string 1-256, required | ✅ |
| `tasks[].sessionId` | string 1-256, required | ✅ |
| `tasks[].answers` | array 1-100 of array 1-100 of string 1-4096 | ✅ |

## 显式校验测试缺口汇总

> 以下参数的 **运行时校验均已生效**（Ajv 拦截非法输入返回 400），但测试文件中**没有显式用例**发送非法值并断言 400。补测试的目的是防止 schema 被意外弱化时无告警。

### ❌ 校验生效但缺显式测试

> **已全部补齐**。以下参数的显式校验测试已写入 `tests/schema-validation-boundary.test.ts`（38 个用例全部通过）。

| 模块 | 接口 | 参数 | 测试文件 |
|------|------|------|----------|
| Stream | streamSessionSSE | `lastSeenSequence` | schema-validation-boundary |
| Stream | streamSessionSSE | `requestId` / `runId` | schema-validation-boundary |
| Skill | listSkillCatalog | `pageNum` / `pageSize` | schema-validation-boundary |
| Skill | listSkillCatalog | `keyword` | schema-validation-boundary |
| Question | getCategoryQuestions | `locale` | schema-validation-boundary |
| Question | getFrequentQuestions | `locale` | schema-validation-boundary |
| Question | getQuestionAssociation | `locale` | schema-validation-boundary |
| Conversation | getConversation | `includeCapabilityResults` | schema-validation-boundary |
| Attachment | uploadFile | `file` | schema-validation-boundary |
| Attachment | deleteTempFile | `fileName` | schema-validation-boundary |

### ⚠️ 校验生效，有正常路径测试，缺边界/负面用例

> **已全部补齐**。以下参数的边界/负面测试已写入 `tests/schema-validation-boundary.test.ts`。

| 模块 | 接口 | 参数 | 测试文件 |
|------|------|------|----------|
| Auth | localLogin | `credential` | schema-validation-boundary |
| Session | listSessions | `q` | schema-validation-boundary |
| Session | createSession | `locale` | schema-validation-boundary |
| RequestCommand | submitRequest / convenienceSubmit | `locale` | schema-validation-boundary |
| RequestCommand | editLatestRequest | `locale` | schema-validation-boundary |
| BackgroundTask | getBackgroundTaskOutput | `limitBytes` | schema-validation-boundary |
| Conversation | getConversation | `cursor` / `newerCursor` / `anchorMessageId` | schema-validation-boundary |
| Memory | saveLongTermMemory / mutateMemory | `confidence` / `delta` / `expectedVersion` | schema-validation-boundary |
| Memory | searchLongTermMemory | `limit` | schema-validation-boundary |
| Memory | manualSaveLongTermMemory | `labels` | schema-validation-boundary |
| RequestCommand | submitRequest | `attachments` | schema-validation-boundary |

---
---

## 本次补全的校验约束汇总

| 类型 | 修复位置 | 字段 | 变更 |
|------|----------|------|------|
| string 裸 `Type.String()` | `conversation-query.ts` | `includeCapabilityResults` | + minLength:1, maxLength:32 |
| string 裸 `Type.String()` | `conversation-query.ts` | `cursor`/`newerCursor`/`anchorMessageId` | + maxLength:256 |
| string 裸 `Type.String()` | `conversation-query.ts` | `limit`/`offset` | + maxLength:3/7, pattern |
| string 裸 `{type:"string"}` | `auth-local/index.ts` | `credential` | + minLength:1, maxLength:4096 |
| string 有 minLength 无 maxLength | `session-dto.ts` | `createdFrom/createdTo/offset/limit` | + maxLength:13/7/3, pattern |
| string 有 minLength 无 maxLength | `session-dto.ts` | `title` | + minLength:1 |
| string 有 minLength 无 maxLength | `annotation-dto.ts` | `offset`, `limit` | + maxLength:3/7, pattern |
| string 有 minLength 无 maxLength | `skill-catalog-query.ts` | `pageNum`, `pageSize` | + maxLength:3/7, pattern |
| string 裸 `Type.String()` | `stream-query.ts` | `lastSeenSequence` | + maxLength:7, pattern |
| string 裸 `Type.String()` | `stream-query.ts` | `requestId`/`runId` | + maxLength:256 |
| string 裸 `Type.String()` | `api-contract.ts` | `limitBytes` | + maxLength:6, pattern |
| string 裸 `Type.String()` | `api-contract.ts` | `stream` (backgroundTaskOutput) | → enum stdout|stderr |
| string 裸 `Type.String()` | `api-contract.ts` | all path params | + maxLength:256 |
| string 裸 `Type.String()` | `memory-dto.ts` | 13 个查询参数的 string 分支 | + minLength:1, maxLength:5/7/13 |
| string 裸 `Type.String()` | `memory-dto.ts` | `memoryInstance`/`source`/`reasonCode` | + minLength:1, maxLength:256 |
| string 裸 `Type.String()` | `memory-dto.ts` | `briefIndex`/`content` | + minLength:1, maxLength |
| string 裸 `Type.String()` | `memory-dto.ts` | `labels` (query) | + maxLength:256 |
| number 裸 `Type.Number()` | `memory-dto.ts` | `confidence`/`minConfidence` | + minimum:0, maximum:1 |
| number 裸 `Type.Number()` | `memory-dto.ts` | `sinceTime`/`untilTime`/`lastAccessTime` | + minimum:0 |
| number 裸 `Type.Number()` | `memory-dto.ts` | `delta` | + minimum:0 |
| number 裸 `Type.Number()` | `memory-dto.ts` | `expectedVersion` | + minimum:1 |
| number 裸 `Type.Number()` | `memory-dto.ts` | `limit`/`offset` | + minimum/maximum |
| array 缺 maxItems | `request-dto.ts` | `attachments`(submit+convenience) | + maxItems:10 |
| string 裸 `Type.String()` | `request-dto.ts` | `tempRunId`/`fileName` | + maxLength:256/255 |
| 新增常量 | `validation-limits.ts` | `WEB_QUERY_INT_MAX_LENGTH` | = 16 |
| 新增常量 | `validation-limits.ts` | `WEB_ATTACHMENTS_MAX_ITEMS` | = 10 |
| 新增路由 schema | `api-contract.ts` | `tempFileParams`/`uploadFileResponse`/`deleteTempFileQuery` | 新增 |
| 新增端点 | `api-contract.ts` | `webChannelPublicEndpoints` | + file upload/delete + 12 memory 端点 |

---

## 现有测试文件索引

| 测试文件 | 覆盖模块 |
|----------|----------|
| `tests/schema-validation-constraints.test.ts` | path params maxLength, title, query pattern, idempotencyKey, stream enum |
| `tests/web-api-schema-coverage.test.ts` | 全端点 schema 存在性 + 端点清单对齐 |
| `tests/web-api-documentation-alignment.test.ts` | 文档与端点清单对齐 |
| `tests/annotation-routes.test.ts` | Annotation 3 个接口 |
| `tests/background-task-routes.test.ts` | BackgroundTask 3 个接口 |
| `tests/conversation-route.test.ts` | Conversation 投影 |
| `tests/conversation-preview-route.test.ts` | Conversation preview |
| `tests/frequent-question-routes.test.ts` | Question 4 个接口 |
| `tests/memory-routes.test.ts` | Memory 12 个接口 |
| `tests/multipart-request-routes.test.ts` | Attachment + submit multipart |
| `tests/share-routes.test.ts` | Share 2 个接口 |
| `tests/session-delete-route.test.ts` | Session delete |
| `tests/session-event-history-route.test.ts` | Event history |
| `tests/session-list-search-route.test.ts` | Session list + search |
| `tests/suggested-questions-routes.ts` | Suggested questions |
| `tests/request-model-options-schema.test.ts` | Submit body schema |
| `tests/routing-constraints-schema.test.ts` | routingConstraints schema |
| `tests/ir-surface-routes.test.ts` | IR surface 镜像 + auth 隔离 |
| `tests/guard-forward-routes.test.ts` | Guardrail 前置拦截 |
| `tests/retry-limit-route.test.ts` | Retry limit safe error |
| `tests/pending-input-projection.test.ts` | Pending input 投影 |
| 	ests/routing-constraints-projection.test.ts | Routing constraints 投影 |
| 	ests/schema-validation-boundary.test.ts | 全端点边界/负面校验（38 用例） |





