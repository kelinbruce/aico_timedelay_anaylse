## 1. favorites offset/limit 范围与消息

- [x] 1.1 在 `packages/agent-channel-web/src/schemas/annotation-dto.ts` 将 `favoritesListQuery` 的 `offset`/`limit` 改为 `Type.Optional(Type.String())`（移除 pattern/maxLength/minLength），保留 `additionalProperties: false`；清理未使用的 `WEB_QUERY_OFFSET_MAX_LENGTH`/`WEB_QUERY_LIMIT_MAX_LENGTH` import。
  来源：design `修改方案 1`；spec `列表查询 limit 上限`
  验证：`tsc -b` exit 0。
  实施证据：offset/limit 下沉，注释说明校验由 parser 强制；import 仅留 `WEB_QUERY_SEARCH_MAX_LENGTH`/`WEB_QUERY_TIMESTAMP_MAX_LENGTH`。

- [x] 1.2 在 `packages/agent-channel-web/src/schemas/validation-limits.ts` 新增 `WEB_FAVORITES_OFFSET_MAX_LENGTH = 5`（不动 `WEB_QUERY_OFFSET_MAX_LENGTH=7`）。
  来源：design `修改方案 2`；spec `列表查询 limit 上限`
  验证：`tsc -b` exit 0。
  实施证据：新增常量，注释说明 10000 为 5 位数、长度守卫防漏到 memory 与 finite safe integer。

- [x] 1.3 在 `packages/agent-channel-web/src/routes/requests.ts` 新增 `MAX_FAVORITES_LIMIT = 100`、`MAX_FAVORITES_OFFSET = 10000`，import `WEB_FAVORITES_OFFSET_MAX_LENGTH`；favorites handler 加 offset 长度守卫（`length > 5` → `offset must not exceed 10000.`）+ 负数检查（`< 0` → `offset must be a non-negative integer.`）+ 数值上界（`> 10000` → 同消息）；limit 上界用 `MAX_FAVORITES_LIMIT` 替代硬编码。
  来源：design `修改方案 2/3`；spec `列表查询 limit 上限`
  验证：`annotation-routes.test.ts` offset 9999999→400 且 listFavoriteTurns not called、10000→200、-1→`non-negative`、1.5→`integer`；limit 1.5→`positive integer`、200→`limit must not exceed 100.`。
  实施证据：长度守卫在 parseStrictInteger 之前；23/23 annotation-routes 测试通过。

- [x] 1.4 更新 `docs/apis/swagger/annotation.yaml`：path 参数 offset/limit 移除 pattern/maxLength/minLength、加 description；`FavoritesListQuery` definition 同步。
  来源：design `修改方案 1`、`GAP 分析`
  验证：swagger 与 annotation-dto 一致（均无 pattern）。
  实施证据：path 参数 2 处 + definition 2 字段下沉，description 注明 range 0–10000 / 1–100。

- [x] 1.5 更新 `docs/apis/agent-web-api-list.md`：favorites 参数表 offset 补"0 到 10000"、limit "1 到 100"；错误表去 `offset format is invalid.`/`limit format is invalid.`，补 `offset must be an integer.`/`offset must be a non-negative integer.`/`offset must not exceed 10000.`。
  来源：proposal `影响范围`
  验证：文档与 parser 一致。
  实施证据：参数表 2 行、错误表 3 行更新。

- [x] 1.6 单元测试覆盖：offset 9999999→`offset must not exceed 10000.`（且不调 listFavoriteTurns）、10000→200、-1→`non-negative`、1.5→`integer`；limit 1.5→`positive integer`、200→`limit must not exceed 100.`。
  来源：design `验证策略`
  验证：上述测试全部通过；`tsc -b` exit 0。
  实施证据：`annotation-routes.test.ts` 新增 6 用例、改 limit=200 用例加消息断言；23/23 通过。

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec strict 校验，确认 proposal / design / spec delta / tasks 结构完整，MODIFIED delta 准确反映 offset 0–10000 上界、字段级消息、schema 下沉、路径标注修正。
  来源：proposal `目标与非目标`、`影响范围`；design `验证策略`
  验证：`openspec validate fix-favorites-offset-limit-range --strict` 预期 exit 0。
  实施证据：pending（待执行 `openspec validate --strict`）。
