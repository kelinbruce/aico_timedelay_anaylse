## 背景和现状（Context）

现有会话历史搜索提供一组时间范围参数：

- public Web API：`createdFrom` / `createdTo`
- runtime / session / gateway contract：`createdAtFrom` / `createdAtTo`

但 gateway-local 当前把它们映射到 `sessions.created_at`。与此同时，用户在历史列表中看到的时间和排序都来自 `updatedAt`，Web 输出字段为 `lastActivityAt`。因此，同一个会话的“筛选语义”和“列表可见语义”不一致，导致用户按历史时间理解时看到越界结果。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让时间范围筛选和历史列表可见时间保持同一语义：都基于会话最后活动时间。
- 维持现有 query 参数名和内部字段名，避免本次问题修复扩大为 API 重命名。
- 用黑盒测试覆盖越界会话不再被返回的边界。

**非目标：**

- 不新增 `updatedFrom` / `updatedTo` 或 `lastActivityFrom` / `lastActivityTo` 新参数。
- 不修改文本搜索、分页、排序、结果投影或前端控件交互。
- 不改变 contract 字段命名；本次只调整其实际过滤语义。

## 设计决策（Decisions）

1. **唯一实现路径：保留参数名，统一到活动时间语义。**  
   这次问题的根因不在前端状态，也不在分页，而在时间过滤列选错。最小修复路径是保留现有 `createdFrom` / `createdTo` 与 `createdAtFrom` / `createdAtTo` 形状，只把 gateway-local 的 SQL 条件改为 `sessions.updated_at`。这样可以在不改变 API 形状的前提下，让用户筛选结果与列表里看到的“最后活动时间”一致。

2. **黑盒契约以用户可见结果为准，不以字段命名为准。**  
   虽然内部字段仍叫 `createdAtFrom`，但稳定行为契约需要表达为“按会话活动时间进行闭区间过滤”。黑盒上，用户只关心结果是否与列表可见时间一致，而不关心内部字段名。

3. **排序和过滤继续共用 `updatedAt` 语义。**  
   结果本来就按 `updatedAt DESC, sessionId ASC` 排序。把过滤列也切到 `updatedAt` 后，列表的筛选和排序将共享同一事实源，避免再次出现“筛出来但看起来越界”的不一致。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 正确性 | 时间筛选与用户可见的历史活动时间一致，范围外活动会话不再误入结果。 | gateway 黑盒测试 |
| 安全 | Owner Scope、Agent Scope、参数校验和 SQL literal escaping 规则不变。 | 既有 route / gateway tests |
| 可维护性 | 只改一个 SQL 过滤事实和对应规格场景，不新增平行参数或分支逻辑。 | diff review |
| 可测试性 | 用创建时间和活动时间交叉构造会话，直接验证越界会话被排除。 | `tests/agent-kernel/local-gateway-contract.test.ts` |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 时间范围过滤按活动时间生效 | 1.1, 2.1 | gateway 黑盒测试 |
| 创建时间在范围内但活动时间在范围外的会话不得返回 | 1.1, 2.1 | gateway 黑盒测试 |
| 排序继续按活动时间稳定执行 | 1.1, 2.1 | gateway 黑盒测试 |
| 现有 API 形状与参数校验不变 | 2.2 | `session-list-search-route.test.ts` |

## 风险与取舍（Risks / Trade-offs）

- [风险] public 参数名仍然叫 `createdFrom` / `createdTo`，与实际语义不完全直观。 -> 本次先以最小修复解决错误筛选；如后续需要统一命名，应由独立 change 定义兼容迁移方案。
- [风险] 旧用例若把它理解为“按创建时间搜”会改变结果。 -> 当前黑盒问题已经表明该语义与用户可见列表不一致，优先收敛到用户实际感知的历史时间。

## 待确认问题（Open Questions）

无。
