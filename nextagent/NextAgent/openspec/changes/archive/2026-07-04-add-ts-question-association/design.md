## 设计决策

### D1 新增独立 API 而非扩展现有 frequent-questions

现有 `GET /api/v1/frequent-questions` 的 DTO 故意抹掉来源信息，spec 明确要求"MUST NOT 包含 hash、frequency、is_pinned、pinned_at 或任何 DB 内部字段"。联想场景需要每条结果带 `source` 来源标签用于纯视觉展示，与现有 API 的 DTO 约束冲突。

新增独立 `GET /api/v1/question-association` 端点，DTO 带来源标签，与现有 `frequent-questions` 并行，各服务各的场景（welcome 卡片 vs 输入联想）。两个 API 共享底层 service 和数据源，但 DTO 和查询语义独立。

### D2 三层排序不同于现有五层排序

现有 `listFrequentQuestions` 的五层排序为 `fixed → pinned → high-freq → non-fixed-static`，静态问题中 fixed 优先级最高。

联想场景的排序为 `pinned → high-freq → static`（fixed 和非 fixed 合并为一层），原因：
- 联想是用户打字时的实时辅助，用户自己的数据（pinned、high-freq）应优先于所有静态推荐。
- 联想场景下不需要区分 fixed 和非 fixed 静态问题，合并为一层避免来源标签过度细分。
- static 层内按目录原始顺序排序（fixed 和非 fixed 混合，不保持 fixed 优先）。

### D3 关键词过滤在 service 层 in-memory 完成

三个数据源本就被 service 全量加载：
- `listPinned()` 返回 owner+agent scoped 的全部 pinned 记录（上限 pinLimit=100）。
- `listHighFrequency()` 返回 threshold 过滤后的全部高频记录（数量有限）。
- `loadCatalog()` 返回 locale 过滤后的静态目录（有限）。

总量在几十到一两百条量级，在 service 层对每层做 `text.toLowerCase().includes(keyword.toLowerCase())` 子串匹配，不需要给 gateway 加 LIKE 查询或全文检索。保持 gateway 接口不变，避免持久化层复杂度。

### D4 cap 级联填充策略

三层各设 cap：pinned=10、high-frequency=5、static=5。当某层匹配数不足 cap 时，剩余 slot 向下级联填充：

```
pinned_matches = min(pinned_cap=10, pinned_filtered.length)
remaining_after_pinned = 20 - pinned_matches
freq_matches = min(freq_cap=5, highfreq_filtered.length, remaining_after_pinned)
remaining_after_freq = 20 - pinned_matches - freq_matches
static_matches = min(static_cap=5, static_filtered.length, remaining_after_freq)
remaining_after_static = 20 - pinned_matches - freq_matches - static_matches
```

若三层初次分配后仍有剩余 slot，按优先级从各层剩余匹配项回填：
1. high-frequency 剩余匹配项（受 remaining_after_static 限制）
2. static 剩余匹配项
3. pinned 已在首轮取满，无剩余

回填仍受总和不超过 20 约束。

### D5 去重按 hash，优先级取首次出现

三层来源中同一问题文本可能同时出现在 pinned 和 high-frequency（用户 pin 了一个也频繁问的问题），或同时出现在 static 和 high-frequency（目录中的问题用户也频繁问）。

去重以 `question_hash`（SHA-256 of trimmed text）为准，遍历顺序为 pinned → high-frequency → static，首次出现时记录 hash 和 source，后续重复 hash 跳过。因此同一问题的 source 标签取最高优先级来源。

### D6 static 层 hash 计算

pinned 和 high-frequency 的 hash 来自 DB 的 `question_hash` 字段（已持久化）。static 层来自 `CategoryQuestionResourceDiscovery` 内存目录，`QuestionEntry` 已包含 `hash` 字段（`computeQuestionHash(text)`），service 直接使用，不需要重新计算。

### D7 空关键词不触发联想

输入为空或 trim() 后为空时不调用联想 API。理由：
- welcome 页已有 `HighFrequencyQuestions` 卡片展示全量问题，输入框联想应该是"打字时才有"的行为。
- 空关键词联想会和 welcome 卡片重复，增加不必要的 API 调用。

前端在 debounce 后检查 keyword trim 后是否非空，空则不发请求。

### D8 联想面板与斜杠命令面板互斥

`MessageInput` 已有斜杠命令面板（`/help` `/retry` `/edit`），以 `/` 开头触发。联想面板的触发规则：
- 输入以 `/` 开头 → 斜杠命令面板（现有行为不变）。
- 输入普通文本（非 `/` 开头，trim 后非空）→ 联想面板。
- 输入为空 → 无面板。
- 两个面板互斥，不会同时出现。

键盘交互复用斜杠面板模式：`ArrowUp/Down` 导航、`Enter/Tab` 选中填入 textarea、`Escape` 关闭。

### D9 来源标签纯视觉，无交互语义

`source` 字段仅用于前端展示来源分类标签（如图标或文字标记），不承载交互语义：
- 不提供点击标签取消 pin 的能力（现有 spec 明确不提供 unpin API）。
- 不提供按来源过滤或切换的能力。
- 标签样式区分：pinned（已收藏）、high-frequency（高频）、static（推荐），具体视觉由前端实现。

### D10 locale 处理

联想 API 的 `locale` 参数仅影响 static 层（内存目录 locale 过滤），pinned 和 high-frequency 层不按 locale 过滤（与现有 `listFrequentQuestions` 的 D5 设计一致）。locale 缺省时使用 `"zh-CN"`。
