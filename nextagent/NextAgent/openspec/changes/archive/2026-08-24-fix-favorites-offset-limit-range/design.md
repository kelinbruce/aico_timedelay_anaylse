# Design: Tighten Favorites Offset/Limit Range And Align Field-Level Error Messages

## 设计范围

| Spec | 目标变化 | Delta Requirement |
| --- | --- | --- |
| `web-channel-input-security` | favorites offset 0–10000、字段级消息、schema 下沉 | `列表查询 limit 上限`（MODIFIED，扩展 offset 上界 + 消息） |

## 目标与规范依据

`web-channel-input-security/spec.md` 现有要求（Requirement `列表查询 limit 上限`，:62-105）：

- :70 `GET /api/v1/sessions/:sessionId/runs/:runId/annotations`（favorites）：`limit` MUST 在 1 到 100 之间。**路径标注有误**（实际 favorites 是 `GET /api/v1/favorites`，非 annotations upsert 路由）。
- :72 超限 `limit` MUST 返回 HTTP 400；负数 `limit` MUST 被拒绝。
- scenario :91-105：favorites limit 负数/0/100 的接受拒绝。
- **无 offset 上界约束**，**无字段级消息文案规定**。

`conversation-annotation/spec.md:183` scenario `Limit exceeds maximum`：`GET /api/v1/favorites?limit=200` → 400（仍成立，不破坏）。

## 当前实现

`favoritesListQuery`（`annotation-dto.ts:17`）：
- `offset`：`pattern: ^\d+$` + `maxLength: 7`。
- `limit`：`maxLength: 3`（**无 pattern**）。

swagger `annotation.yaml`：
- path 参数 offset：`pattern: ^\d+$` + `maxLength: 7`；limit：`pattern: ^[1-9]\d*$` + `maxLength: 3`。
- `FavoritesListQuery` definition 同上。
- **swagger limit 有 pattern，本仓 annotation-dto limit 无 pattern** —— 不一致。

favorites handler（`requests.ts:1716`）：
- `offset = parseStrictInteger(query.offset, 0, 'offset')` —— 无负数检查、无上界。
- `limit = parsePositiveInteger(query.limit, 50, 'limit')` —— `limit > 100` 抛 `limit must not exceed 100.`（硬编码 100）。

## GAP 分析

| 场景 | 当前行为 | 目标行为 | GAP |
| --- | --- | --- | --- |
| `limit=1.5`（部署/swagger） | `400 limit format is invalid.`（swagger pattern 拦） | `400 limit must be a positive integer.` | swagger pattern 下沉 |
| `limit=1.5`（本仓） | `400 limit must be a positive integer.`（parser） | 不变 | 无（本仓已对） |
| `offset=-1` | `400 offset format is invalid.`（schema pattern 拦） | `400 offset must be a non-negative integer.` | schema pattern 下沉 + parser 负数检查 |
| `offset=1.5` | `400 offset format is invalid.`（schema pattern 拦） | `400 offset must be an integer.` | schema pattern 下沉 |
| `offset=9999999` | `400 WM_HTTP_ERROR`（漏到 memory） | `400 offset must not exceed 10000.` | 缺长度守卫 + 上界 |
| `offset=10000` | 透传 | `200`（保留） | 无 |
| `offset=0`/`limit=50` | `200` | `200` | 无 |
| swagger vs 本仓 schema | limit pattern 不一致 | 统一下沉（无 pattern） | schema 对齐 |

## 修改方案

### 1. schema 下沉（annotation-dto.ts + swagger）

`favoritesListQuery` offset/limit 改 `Type.Optional(Type.String())`（移除 pattern/maxLength/minLength）。swagger path 参数 + definition 同步移除，加 description 注明 parser 强制与范围。保留 `additionalProperties: false`（未知字段仍 AJV 拒 → `Field '{name}' is not allowed.`）。

### 2. offset 长度守卫 + 数值上界 + 负数检查（requests.ts handler）

handler 在 `parseStrictInteger` 之前加长度守卫（`query.offset.length > 5` → `offset must not exceed 10000.`）；解析后加负数检查（`< 0` → `offset must be a non-negative integer.`）与上界（`> 10000` → `offset must not exceed 10000.`）。

### 3. limit 上界常量化

`MAX_FAVORITES_LIMIT = 100` 替代硬编码；`limit > 100` 抛 `limit must not exceed 100.`。小数由 `parsePositiveInteger` 的 `/^\d+$/` 拦 → `limit must be a positive integer.`。

## 质量属性影响

- **可靠性**：超大 offset 不再漏到 memory 变 `WM_HTTP_ERROR`。
- **一致性**：swagger 与本仓 schema 对齐（均无 pattern，校验在 parser）；字段级消息与 preview/conversation 端点风格统一。
- **可测试性**：边界用例明确（10000 放行、9999999 拒、-1/1.5 字段级消息）。
- **向后兼容**：`offset` >10000 由透传变 400 是收紧（favorites 收藏数远不达 10000）；非法值消息变准确，不影响合法请求。

## 风险与取舍

- **schema 下沉后非法值到 parser**：移除 pattern 后，负数/小数/超大值全部到 parser。parser 的 `parseStrictInteger`（`/^-?\d+$/`）对小数抛 `must be an integer.`、对负数解析后由新增 `< 0` 检查抛 `non-negative`。长度守卫挡超大 digit string 防 `Number()` 溢出前的 `finite safe integer` 与漏到 memory。
- **不动共享函数**：offset 长度守卫写在 favorites handler，不影响 createdFrom/createdTo 等端点。
- **路径标注修正**：spec :70 路径写成 `/runs/:runId/annotations`（annotations upsert 路由），实际 favorites 是 `/api/v1/favorites`。delta 修正此标注。
- **offset 10000 上界**：favorites 收藏会话数远不达 10000，上界宽松不影响现实使用。

## 验证策略

- `tsc -b` 干净。
- `annotation-routes.test.ts`：offset 9999999→`offset must not exceed 10000.`（且 listFavoriteTurns not called）、10000→200、-1→`non-negative`、1.5→`integer`；limit 1.5→`positive integer`、200→`limit must not exceed 100.`。
- `openspec validate fix-favorites-offset-limit-range --strict`。

## 待确认问题

无。
