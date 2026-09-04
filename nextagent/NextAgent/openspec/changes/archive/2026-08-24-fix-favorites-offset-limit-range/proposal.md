# Tighten Favorites Offset/Limit Range And Align Field-Level Error Messages

## Why

`GET /api/v1/favorites` 的分页参数在服务端测试暴露四类问题：

1. **`limit=1.5` → `limit format is invalid.`**：部署用 swagger 契约 `annotation.yaml`，其 `limit` 带 `pattern: ^[1-9]\d*$`，`1.5` 在 AJV 层被 pattern 拦截，经 `formatFastifyValidationError` 格式化成笼统的 `limit format is invalid.`。而本仓 `annotation-dto.ts` 的 `limit` **无 pattern**（`1.5` 本应到 parser 抛字段级 `limit must be a positive integer.`）—— **swagger 与本仓 schema 不一致**，部署版以 swagger 为准产笼统消息。
2. **`offset=-1` / `offset=1.5` → `offset format is invalid.`**：本仓 `annotation-dto.ts` 的 `offset` 带 `pattern: ^\d+$`，负数/小数在 AJV 层被拦 → `offset format is invalid.`，绕过 parser 里能产字段级消息的逻辑。
3. **`offset=9999999` → `WM_HTTP_ERROR: NAIE Memory service returned HTTP 400`**：`offset` 只校验非负、无上界，超大值过 schema 与 parser 后漏到 backing memory 服务，memory 返 400 被透传成不透明的 `WM_HTTP_ERROR`。
4. **`offset` 无负数检查**：handler 只调 `parseStrictInteger(query.offset, 0, 'offset')`，`parseStrictInteger` 的 `/^-?\d+$/` 允许负号，`-1` 会解析成 -1 透传（schema pattern 当前挡住，但下沉后需 parser 兜底）。

根因：favorites 的 offset/limit 校验分散在 schema（pattern/maxLength）与 parser 两层，schema 层先于 parser 拦截非法值产笼统 `format is invalid.`；offset 无上界导致超大值漏到 memory。与已修复的 `fix-conversation-preview-validation`（schema 下沉）和 `fix-conversation-preview-offset-limit-range`（offset 上界）同类问题。

### 关键约束

- favorites 在 web 边界 handler 解析 offset/limit，**早于 backing service 调用**。错误消息不依赖后端是 SQLite 还是 memory。
- stable spec `web-channel-input-security` 的 Requirement `列表查询 limit 上限` 已固化 favorites `limit` 1–100，但**无 offset 上界约束**，且未规定字段级消息文案。本次为**扩展既有契约**（新增 offset 上界 + 细化消息），写 MODIFIED delta。
- swagger `annotation.yaml` 的 `FavoritesListQuery`（path 参数 + definition）offset/limit 带 pattern/maxLength，须与本仓 `annotation-dto.ts` 同步下沉，消除 swagger 与本仓 schema 差异。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `offset` 范围收紧为 `0` 到 `10000`（含），默认 `0`；超过 `10000` 返回字段级 `offset must not exceed 10000.`。
- 超大 digit string（如 `9999999`，7 位）在 `Number()` 解析前被长度守卫拦截，返回 `offset must not exceed 10000.`，不再漏到 memory 变 `WM_HTTP_ERROR`。
- `offset` 负数 → `offset must be a non-negative integer.`；小数 → `offset must be an integer.`（字段级，替代笼统 `format is invalid.`）。
- `limit` 范围保持 `1` 到 `100`；小数（如 `1.5`）→ `limit must be a positive integer.`（字段级，替代 `format is invalid.`）。
- schema 下沉：`annotation-dto.ts` 与 swagger `annotation.yaml` 的 offset/limit 移除 pattern/maxLength/minLength，校验全部在 parser，消除 swagger 与本仓 schema 差异。

**非目标：**

- 不改 `favoriteType`、`keyword`、`favoritedFrom`、`favoritedTo` 的 schema 与校验。
- 不改 `/conversation`、`/conversation/preview`、`/sessions` 等其他端点的 offset/limit（各自由其 change 处理）。
- 不改 `parseStrictInteger` / `parsePositiveInteger` 共享函数（offset 长度守卫写在 favorites handler 内）。
- 不改成功响应 schema、默认 offset/limit 语义、过滤再分页逻辑。
- 不引入新 SafeError code（复用 `REQUEST_VALIDATION_FAILED`）。

## What Changes

- `annotation-dto.ts` `favoritesListQuery`：offset/limit 改为 `Type.Optional(Type.String())`（移除 pattern/maxLength/minLength），保留 `additionalProperties: false`；清理未使用的 `WEB_QUERY_OFFSET_MAX_LENGTH`/`WEB_QUERY_LIMIT_MAX_LENGTH` import。
- `validation-limits.ts`：新增 `WEB_FAVORITES_OFFSET_MAX_LENGTH = 5`。
- `requests.ts`：新增 `MAX_FAVORITES_LIMIT = 100`、`MAX_FAVORITES_OFFSET = 10000`；favorites handler 加 offset 长度守卫（`>5` 位）+ 负数检查 + 数值上界；limit 上界用常量替代硬编码 `100`。
- `swagger/annotation.yaml`：path 参数 + `FavoritesListQuery` definition 的 offset/limit 移除 pattern/maxLength/minLength，description 注明 parser 强制与范围。
- `agent-web-api-list.md`：参数表 offset 补"0–10000"、limit "1–100"；错误表去 `format is invalid.`、补字段级消息。
- stable spec `web-channel-input-security` 的 `列表查询 limit 上限` Requirement：MODIFIED——扩展 favorites 条目加 offset 0–10000 上界，修正路径标注（`/runs/:runId/annotations` → `/api/v1/favorites`），新增 offset/limit 字段级消息 scenario。

本 change 包含可观察契约变更（offset 新增上界 10000、错误消息由笼统 `format is invalid.` 改字段级），写 MODIFIED delta spec。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- 横切安全 spec `web-channel-input-security`（覆盖 FN-1.13 查看收藏列表等列表查询端点的输入安全边界）
  - 功能边界：favorites offset 新增 0–10000 上界，offset/limit 非法值返回字段级消息而非笼统 `format is invalid.`。
  - 系统质量属性：可靠性、一致性、可测试性。
  - 映射说明：`web-channel-input-security` 为 canonical 横切 spec，本 change 固化 MODIFIED delta。

## 影响范围（Impact）

- API 调用方：`offset>10000` 由透传 memory 变 `WM_HTTP_ERROR` 改为 `400 offset must not exceed 10000.`；`offset=-1`/`1.5`、`limit=1.5` 由 `format is invalid.` 改为字段级消息；`limit` 101–100 仍 400（不变）。
- 前端 favorites 页：默认 `limit=50`、`offset=0`，不受影响。
- 运维人员：失败路径产生字段级 `REQUEST_VALIDATION_FAILED`，不暴露 `format is invalid.` 或 `WM_HTTP_ERROR`。
- swagger 与本仓 schema 对齐，部署版不再因 swagger pattern 产笼统消息。
- 主要受影响范围为 `agent-channel-web` 的 favorites handler 与 `annotation-dto.ts`。
