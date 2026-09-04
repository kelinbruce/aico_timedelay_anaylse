# Design: Tighten Conversation Preview Offset/Limit Range And Error Messages

## 设计范围

| Function | Canonical spec | 目标变化 | Delta Requirement |
| --- | --- | --- | --- |
| FN-1.8 查看会话消息 | `session-conversation-preview` | offset 0–10000、limit 1–100、消息对齐 | `会话预览查询校验返回确定字段级结果`（MODIFIED） |

## 目标与规范依据

`session-conversation-preview/spec.md` 现有要求（Requirement `会话预览查询校验返回确定字段级结果`，:333-361）：

- :345-346 `offset`/`limit` 超出有限安全整数范围 → `offset must be a finite safe integer.` / `limit must be a finite safe integer.`
- :349-350 `limit` 小于 1 或大于 500 → `limit must be between 1 and 500.`
- scenario `Preview validates paging parameters without imposing a total cap`（:64-70）：`limit greater than 500` SHALL return a validation error；标题为 "without imposing a total cap"。

另：stable spec :349-350 写 `limit must be between 1 and 500.`，但实现 `parseConversationPreviewQuery` 抛 `limit must not exceed 500.`（`parsePositiveInteger` 不重复报 <1，统一 positive-integer 消息）—— **spec 与实现文案本就漂移**。

## 当前实现

`parseConversationPreviewQuery`（`requests.ts:3093`）：

- `offset`：`parseStrictInteger(query.offset, undefined, 'offset')` → 负数校验。无上界、无长度守卫。
- `limit`：`parsePositiveInteger(query.limit, undefined, 'limit')` → `limit > MAX_CONVERSATION_PREVIEW_LIMIT(500)` 抛 `limit must not exceed 500.`。

`parseStrictInteger`（:3160-3177）：`/^-?\d+$/` 校验整数串 → `Number(value)` → `Number.isSafeInteger` 不通过抛 `must be a finite safe integer.`。超大 digit string（`1e27`）在 `Number()` 后超出 `MAX_SAFE_INTEGER`，命中此分支。

SQLite gateway `listConversationPreview`（`sqlite-gateway-core.ts:2367`）backstop：`offset < 0` 或 `limit < 1` 或 `limit > 500` → `Conversation preview paging parameters are invalid.`。

## GAP 分析

| 场景 | 当前行为 | 目标行为 | GAP |
| --- | --- | --- | --- |
| `offset=1e27`（28 位） | `400 offset must be a finite safe integer.`（误导） | `400 offset must not exceed 10000.` | 缺长度守卫 |
| `offset=99999`（5 位，>10000） | 透传 gateway（无意义大 OFFSET） | `400 offset must not exceed 10000.` | 缺数值上界 |
| `offset=10000`（边界） | 透传 | `200`（保留） | 无 |
| `offset=-1` | `400 offset must be a non-negative integer.` | 不变 | 无 |
| `limit=101` | `200`（≤500） | `400 limit must not exceed 100.` | 上限过宽 |
| `limit=501` | `400 limit must not exceed 500.` | `400 limit must not exceed 100.` | 上限文案/值 |
| `limit=01`（前导零） | `200`（解析为 1） | 不变 | 无 |
| spec `between 1 and 500.` | spec 与实现漂移 | 统一 `must not exceed 100.` | 文案对齐 |

## 修改方案

### 1. offset 长度守卫（修 `1e27` 消息的关键）

`parseConversationPreviewQuery` 在 `parseStrictInteger` **之前**加：

```
if (query.offset !== undefined && query.offset.length > WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH) {
  throwValidation(`offset must not exceed ${MAX_CONVERSATION_PREVIEW_OFFSET}.`);
}
```

`WEB_CONVERSATION_PREVIEW_OFFSET_MAX_LENGTH = 5`（10000 为 5 位数）。6 位以上 digit string 在此拦截，不进 `Number()`，故不触发 `finite safe integer` 分支。

### 2. offset 数值上界

解析后加：

```
if (offset !== undefined && offset > MAX_CONVERSATION_PREVIEW_OFFSET) {
  throwValidation(`offset must not exceed ${MAX_CONVERSATION_PREVIEW_OFFSET}.`);
}
```

覆盖 5 位的 10001–99999（长度守卫放行、数值超界）。

### 3. limit 上限 100

`MAX_CONVERSATION_PREVIEW_LIMIT` 500→100。`limit > 100` 抛 `limit must not exceed 100.`。`limit=100` 放行（前端 preview rail 固定窗口）。

### 4. gateway backstop 同步

`CONVERSATION_PREVIEW_MAX_PAGE_LIMIT` 500→100，新增 `CONVERSATION_PREVIEW_MAX_OFFSET = 10000`，校验条件加 `offset > CONVERSATION_PREVIEW_MAX_OFFSET`。gateway 是 web 边界被绕过时的兜底，须与 web 一致。

## 质量属性影响

- **可靠性**：超大 offset 不再透传到 `LIMIT ? OFFSET ?`，避免无意义大 OFFSET 查询。
- **一致性**：web 边界与 gateway backstop 上限一致（100/10000）；spec 与实现文案一致（`must not exceed`）。
- **可测试性**：边界用例明确（10000 放行、10001 拒、1e27 拒、101 拒、100 放行）。
- **向后兼容**：`limit` 101–500 由 200 改 400 是**破坏性收紧**；preview rail 实际只用 `limit=100`，影响面可控。`offset` >10000 同理收紧。

## 风险与取舍

- **limit 500→100 破坏性**：若有调用方用 `limit>100` 一次拉更多 marker，会变 400。经查前端 preview rail 固定 `limit=100`（stable spec :81），无 >100 用例。accept。
- **offset 10000 上界**：preview marker 为会话 USER 消息数，10000 marker 远超任何单会话现实规模。accept。
- **长度守卫 vs 数值守卫双层**：长度守卫挡 `1e27`（防 `Number()` 溢出前的误导消息），数值守卫挡 10001–99999。两者消息相同，调用方无需区分。
- **不动 `parseStrictInteger` 共享函数**：offset 长度守卫写在 preview 专属 parser，不影响 createdFrom/createdTo 等端点的 `finite safe integer` 行为（那些端点有各自的范围校验，如 createdTo ≤ endOfToday）。
- **spec "without imposing a total cap" 标题**：limit=500 本已是隐式 cap，标题与实现早已不符；本次显式收紧为 100，delta 同步修订 scenario 文案与标题语义。

## 验证策略

- `tsc -b` 干净。
- `conversation-preview-route.test.ts`：offset 10001→400、10000→200、`1e27`→`offset must not exceed 10000.`；limit 101→`limit must not exceed 100.`、100→200。
- `schema-validation-boundary.test.ts`：`limit=01`→200 不回归。
- `local-gateway-contract.test.ts`：`limit=501` 仍被 gateway 拒（>100），`limit=100` 正常分页不回归。
- `openspec validate fix-conversation-preview-offset-limit-range --strict`。

## 待确认问题

无。
