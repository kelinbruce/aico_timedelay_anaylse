## 背景和现状（Context）

`add-skill-catalog-source-metadata` 已让 `/api/v1/skills` 返回可选 `sourceMetadata`，
前端 `resolveSkillDisplayName` 在中文界面使用 `sourceMetadata.zh-name`、其他语言使用
`sourceMetadata.en-name`。但 `web-skill-catalog` 基线 spec 的关键字搜索要求明确
限定只匹配 `displayName` 和 `capabilityId`，且 MUST NOT 搜索 `metadata`。前端显示
名与搜索匹配范围脱节，导致中文关键字必然无结果。

前端 Modal 搜索输入框没有任何长度约束，后端 schema 虽有 `maxLength: 512`，但前端
未镜像该上限，超长输入被 400 拒绝后静默清空。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 让关键字搜索匹配范围覆盖用户可见的本地化显示名（`sourceMetadata.zh-name`、
  `sourceMetadata.en-name`），与 `resolveSkillDisplayName` 的展示一致。
- 前端搜索输入框限制关键字最大长度，超过服务端上限时不发起请求。

**非目标：**
- 不搜索 `description`、`extension`、运行治理 metadata 或其他非可见字段。
- 不改变 `sourceMetadata` 的投影范围、catalog governance、分页或 scope 校验。
- 不改变后端 `keyword` 的 `maxLength` 上限（仍为 `WEB_QUERY_TEXT_MAX_LENGTH`）。
- 不引入前端关键字最小长度规则。

## 设计决策（Decisions）

关键字匹配范围扩展为：`displayName`、`capabilityId`、以及已投影 `sourceMetadata`
中的字符串值 `zh-name` 和 `en-name`。只匹配这两个约定的本地化显示名键，不遍历
`sourceMetadata` 的全部键值，避免把作者可能放入的其他非展示文本纳入搜索。匹配仍
使用 case-insensitive 子串包含；`toLowerCase` 对中文无害。`sourceMetadata` 不存
在或对应键缺失/非字符串时，该 Skill 仍可由 `displayName` 和 `capabilityId` 匹配。

前端长度约束使用 antd `Input` 的 `maxLength` 属性，上限值与后端
`WEB_QUERY_TEXT_MAX_LENGTH`（512）一致，在前端 `inputLimits.ts` 定义独立常量
`SKILL_SEARCH_KEYWORD_MAX_LENGTH`。`maxLength` 同时阻止键盘输入和粘贴超长内容，
因此无需在 service 层再做二次截断。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不扩大 metadata 投影范围，只匹配已公开的两个显示名键。 | catalog port 测试断言只匹配 zh-name/en-name。 |
| 性能/容量 | 匹配仍在已加载 descriptor 列表上做内存子串匹配，无额外 I/O。 | 既有 catalog 查询测试。 |
| 可靠性/恢复 | sourceMetadata 缺失或非字符串时安全回退到 displayName/capabilityId。 | catalog port 缺失场景测试。 |
| 可维护性 | 前端长度上限集中为常量，与后端 schema 上限一致。 | 前端单元测试。 |
| 可测试性 | port 匹配行为和前端 maxLength 分别可独立断言。 | Vitest 定向测试。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 关键字匹配 sourceMetadata 本地化显示名 | 1.1-1.2 | `packages/agent-app/tests/skill-catalog-query-port.test.ts` |
| 不搜索 description/extension/治理 metadata | 1.3 | `packages/agent-app/tests/skill-catalog-query-port.test.ts` |
| 前端 maxLength 约束 | 2.1-2.2 | `frontend/agent-web` Modal 测试 |
| 契约和架构边界无回归 | 3.1 | `npm run test:contract`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/web-skill-catalog/spec.md` 和
  `openspec/specs/skill-selector-ui/spec.md` 在归档时归并对应 requirement 修改。
- 设计视图：无新增设计文档；本 change 复用现有 catalog query 和前端展示边界。

## 风险与取舍（Risks / Trade-offs）

- [Skill 作者在 sourceMetadata 放入非展示文本] -> 只匹配 `zh-name`、`en-name` 两
  个约定键，不遍历全部键。
- [sourceMetadata 键缺失或非字符串] -> 回退到 displayName/capabilityId 匹配。
- [未来需要搜索 description] -> 另行定义 OpenSpec change，不扩展本 change。

## 迁移计划（Migration Plan）

无数据迁移。服务端与前端同时发布后生效；前端面对未携带 sourceMetadata 的旧 Skill
仍按 displayName 搜索，行为不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/web-skill-catalog/spec.md`：归并关键字搜索匹配范围扩展。
- `openspec/specs/skill-selector-ui/spec.md`：归并 Modal 搜索 maxLength 约束。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.8-发现技能` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/skill-selector-ui/spec.md`、`openspec/specs/web-skill-catalog/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
