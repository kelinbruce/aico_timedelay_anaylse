## ADDED Requirements

### Requirement: 内存 Catalog LRU 淘汰

分类问题内存 Catalog 的缓存 MUST 使用 maxSize 受限的 LRU（Least Recently Used）淘汰策略。缓存 MUST NOT 使用无界 `Map`。缓存 MUST 限制最大条目数不超过 `maxCacheEntries`（64）。

LRU 淘汰 MUST 通过以下方式实现：
- `get` 操作 MUST 将被访问的条目移到 Map 的末尾（最近使用），通过 `delete` + `set` 实现。
- `set` 操作 MUST 在 `size > maxCacheEntries` 时删除 Map 的第一个条目（最久未使用），通过 `cache.keys().next().value` 获取并 `delete`。

`maxCacheEntries` 为固定常量，系统 MUST NOT 从 client payload、client metadata 或配置读取或覆盖上限值。LRU 淘汰 MUST NOT 影响 `loading` Map 和 `unavailable` Map（后者已有 `MAX_SOURCE_AVAILABILITY_STATES = 256` 上限）。

#### Scenario: 超过 maxSize 时淘汰最旧条目

- **WHEN** 缓存已有 64 个条目，新条目被 `set`
- **THEN** 最久未使用的条目 MUST 被删除
- **AND** 缓存大小 MUST 保持 64

#### Scenario: get 操作刷新条目位置

- **WHEN** 缓存中有条目 A（最旧）和条目 B（最新），`get(A)` 被调用后，新条目 C 被 `set`
- **THEN** 条目 B MUST 被淘汰（而非条目 A）
- **AND** 条目 A 和条目 C MUST 保留在缓存中

#### Scenario: 正常缓存命中不受影响

- **WHEN** 缓存条目数未达到 64
- **THEN** `get` 和 `set` MUST 正常工作
- **AND** MUST NOT 淘汰任何条目
