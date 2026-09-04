## 背景和现状（Context）

Skill manifest 已将非治理的字符串 metadata 保存在 `SkillMetadata.sourceMetadata`。目录查询在 `agent-core` 中从 `CapabilityDescriptor` 生成较小的 `SkillCatalogSummaryEntry`，再由 `agent-channel-web` 的 schema 作为 `/api/v1/skills` response 对外公开。当前投影未包含 source metadata，前端只能使用固定的 `displayName`。

本变更只解决已配置 `zh-name`、`en-name` 的电信领域 Skill 在页面中的可见性。`sourceMetadata` 是已校验的简单字符串/字符串数组 map；`extension` 与运行治理字段属于不同边界。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 将经过 manifest 校验的 `sourceMetadata` 作为可选字段沿 Skill catalog contract 返回。
- 在所有已有的 Skill 目录和已选 Skill 文本显示处，按当前 UI 语言优先使用 `zh-name` 或 `en-name`，缺失时回退 `displayName`。
- 保持 capabilityId、请求提交和模型侧 descriptor 名称不变。

**非目标：**
- 不公开 `extension`、模型设置、工具约束或完整内部 metadata。
- 不修改 `SKILL.md` 解析、引入翻译服务、增加语言配置，或改变 Skill 搜索和路由语义。
- 不为 description 增加本地化字段。

## 设计决策（Decisions）

选择唯一实现路径：在 runtime 的 `SkillCatalogSummaryEntry` 新增可选 `sourceMetadata`；`agent-core` 仅从 `readSkillMetadata(descriptor)` 的已匹配 `sourceMetadata` 投影该字段；Web response schema 与前端 DTO 同步该公开字段。前端新增一个无状态显示名 resolver，由 `react-i18next` 的当前语言决定优先键：语言以 `zh` 开头使用 `zh-name`，其他语言使用 `en-name`，非字符串或缺失一律回退 `displayName`。

不将 `CapabilityDescriptor.metadata` 原样透传，因为它会把运行治理字段扩大为 Web API contract。也不为两个名称单独增加专用字段，因为当前 manifest 的安全 source metadata 已是稳定 authoring 边界，页面只需读取其中两个约定键。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只公开已校验的 source metadata；extension 与运行治理字段不投影。 | catalog port 测试断言排除字段；Web schema 测试。 |
| 性能/容量 | 查询仅引用已在 descriptor 中存在的 map，不增加 I/O、分页或缓存。 | 既有 catalog 查询测试。 |
| 可靠性/恢复 | 无写入、状态转换或重试；缺失和非字符串值稳定回退。 | 前端回退测试。 |
| 可维护性 | 本地化选择集中为一个 resolver，避免各组件复制 metadata 访问逻辑。 | 前端单元测试与 TypeScript build。 |
| 可测试性 | port、route schema 和 resolver/页面显示分别可独立断言。 | Vitest 定向测试。 |
| 审计/可追溯性 | 无新日志或审计事件；不记录 metadata 内容。 | 代码审查确认。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 仅公开 validated source metadata | 2.1-2.3 | `packages/agent-app/tests/skill-catalog-query-port.test.ts`、Web route/schema 测试 |
| 不公开 extension 和治理 metadata | 2.2 | catalog port 测试 |
| 中文、非中文与缺失值回退 | 3.1-3.3 | `frontend/agent-web/tests/SkillSelector.test.tsx` |
| 契约和架构边界无回归 | 4.1 | `npm run test:contract`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-catalog-query/spec.md` 是目录返回 metadata 与本地化回退的唯一规范性承载。
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md` 记录公开 summary contract 边界。
- 模块设计：`openspec/designs/modules/agent-core.md`、`agent-channel-web.md`、`agent-web.md` 分别记录投影、transport schema 与展示责任。
- ADR：无；此变更复用现有 metadata 边界，未引入长期新取舍。
- 导航：`openspec/designs/spec-to-design-map.md` 在归档时补充或更新该 capability 的导航。

## 风险与取舍（Risks / Trade-offs）

- [Skill 作者在 source metadata 放入非展示文本] -> API 仍只公开已校验的 source metadata；前端仅消费两个名称键。
- [语言键缺失或类型不符] -> 回退现有 `displayName`，不影响 Skill 选择或提交。
- [未来需要本地化 description] -> 另行定义专用 Web display contract，不扩展本 change。

## 迁移计划（Migration Plan）

无数据迁移。服务与前端同时发布时直接生效；前端面对未携带新字段的旧服务会回退 `displayName`，服务面对旧前端不会改变既有字段。回滚只需回退应用版本，Skill manifest 无需改动。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/skill-catalog-query/spec.md`：归并目录 source metadata 公开边界与本地化显示回退行为。
- `openspec/designs/architecture/core-contracts.md`：归并 `SkillCatalogSummaryEntry` 的公开字段边界。
- `openspec/designs/modules/agent-core.md`：归并 Skill catalog projection 的职责。
- `openspec/designs/modules/agent-channel-web.md`：归并 `/api/v1/skills` response schema 的职责。
- `openspec/designs/modules/agent-web.md`：归并前端显示名 resolver 的职责。
- `openspec/designs/spec-to-design-map.md`：归并 capability 到上述设计及验证入口的导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.8-发现技能` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/skill-catalog-query/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
