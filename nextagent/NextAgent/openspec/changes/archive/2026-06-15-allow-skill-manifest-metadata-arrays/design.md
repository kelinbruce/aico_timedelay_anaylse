## 背景和现状（Context）

`agent-capability` 当前用轻量 parser 解析 `SKILL.md` leading frontmatter。该 parser 只支持顶层 scalar、block scalar 和一层 `metadata` string map。`metadata` 进入 parser 后先通过 string-to-string map 校验，再把受治理 key 映射到 `version`、`denied-tools`、`model` 等字段，剩余 safe string metadata 保存到 `SkillMetadata.sourceMetadata`。

当前 implementation-vs-spec gap 是：作者需要为 `exclusiveWith`、`compatibleWith`、`tags` 写多值 metadata，但 stable spec 和实现都只允许 string-to-string map，导致数组值被拒绝。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 允许 `metadata.exclusiveWith`、`metadata.compatibleWith`、`metadata.tags` 使用 YAML block list 和 inline list。
- 数组元素必须是安全、非空字符串，并继续受 source metadata 安全过滤约束。
- 保持 `SkillMetadata` governed fields 不变；数组 key 只作为 `sourceMetadata` 保存。
- 保持 manifest parser 的实现边界在 `agent-capability` 内。

**非目标：**

- 不实现 Skill 互斥、兼容性过滤、标签检索或 Agent assembly 治理行为。
- 不新增 `SkillMetadata` public schema 字段。
- 不引入完整 YAML parser 或改变 manifest 支持的 YAML 子集。
- 不改变 `allowed-tools`、`metadata.denied-tools` 的 space-separated string contract。

## 设计决策（Decisions）

1. 继续使用现有轻量 frontmatter parser，并把 `RawFrontmatterValue` 扩展为 `string | boolean | string[] | metadata object`。理由是本 change 只需要一层 metadata list，不需要完整 YAML 语义；引入 YAML 依赖会扩大解析面和安全审查范围。

2. `metadata` 的内部类型改为 `Record<string, string | readonly string[]>`。parser 只在 nested metadata 中识别两种数组写法：`key: [a, b]` 和 `key:` 后的缩进 `- a` list。inline list 不支持嵌套数组或对象；block list item 必须是 scalar string。

3. 受支持的数组 key 固定为 `exclusiveWith`、`compatibleWith`、`tags`。其他 metadata key 若出现数组值，manifest validation MUST reject，而不是降级保留或字符串化。这样可以避免未知 metadata 悄悄获得新结构语义。

4. `sourceMetadata` 在 public `SkillMetadataSchema` 中仍保持 object。由于 `SkillMetadata` 交叉 `JsonObject`，实现可在 `sourceMetadata` 中保存 string 或 string array；但 governed fields 不新增字段，不从这些 key 派生行为。`isSafeSourceMetadata` 需要同步接受仅限允许 key 的 safe string array。

5. 安全过滤沿用 source metadata key/value 规则：key 长度不超过 128，string value 长度不超过 512，key/value 不匹配现有 unsafe patterns。数组元素使用同一 value 规则，并且必须非空。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 数组支持只开放给固定 key；元素复用 safe source metadata 过滤；不从数组 key 派生 capability 权限、Agent 选择或模型选择。 | `skill-manifest.test.ts` invalid array cases；code review 检查 `parseSourceMetadata` 和 `isSafeSourceMetadata` |
| 性能/容量 | frontmatter 仍受 64 KiB 读取上限约束；新增数组解析只遍历当前 metadata lines 和 array elements，无持久化增长路径。 | 单元测试；现有 bounded frontmatter reader 不变 |
| 可靠性/恢复 | manifest parse 是纯函数；非法数组 shape fail closed，不产生部分 descriptor。 | 单元测试覆盖 rejected outcome |
| 可维护性 | 不引入新依赖；数组 key 集中在一个 allowlist；metadata value helper 复用在 parse 和 validation 中。 | TypeScript build；代码审查 |
| 可测试性 | 通过 manifest parser 黑盒测试覆盖 block list、inline list、unsupported array key、非法元素。 | `npm test -- packages/agent-capability/tests/skill-manifest.test.ts` |
| 审计/可追溯性 | diagnostic reason code 不新增；错误继续使用 safe `INVALID_OFFICIAL_FIELD` 或既有 source metadata degraded diagnostic，不暴露 raw manifest。 | 单元测试检查 outcome/reason code |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `exclusiveWith`、`compatibleWith`、`tags` 支持 block list 和 inline list | 1.1, 1.2 | `npm test -- packages/agent-capability/tests/skill-manifest.test.ts` |
| 其他 metadata key 数组值必须 rejected | 1.2, 2.1 | `skill-manifest.test.ts` negative case |
| 数组元素必须是 safe non-empty string | 1.2, 2.1 | `skill-manifest.test.ts` negative case |
| 不扩展 descriptor governed metadata fields | 1.2, 2.1 | `SkillMetadataSchema` validation 和 mapped metadata assertions |
| OpenSpec delta 有效 | 3.1 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-manifest-contract/spec.md` 主承载 metadata shape、允许数组 key 和 rejection/degradation 规则。
- 架构和跨模块设计：`openspec/designs/architecture/skill-manifest-contract.md` 归档时补充 manifest contract 的数组 metadata 边界。
- 模块设计：`openspec/designs/modules/agent-capability.md` 归档时补充 parser 在 `agent-capability` 内部拥有 value normalization。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 无新增导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] `sourceMetadata` 当前 schema 写作 string map，保存数组会暴露 schema/implementation gap。-> 本 change 明确数组只保存在 source metadata，并在实现中同步 runtime schema/type guard，避免 descriptor accessor 拒绝合法 Skill。
- [风险] 轻量 parser 的 YAML 子集有限。-> 本 change 只承诺两种具体数组写法，复杂 YAML 仍拒绝。
- [取舍] 不把 `exclusiveWith` 等提升为 governed fields。-> 保持本 change 聚焦解析/校验，后续治理语义必须另开 change。

## 迁移计划（Migration Plan）

无数据迁移。已有逗号分隔字符串写法继续作为普通 string source metadata 被接受；作者可逐步改成数组写法。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/skill-manifest-contract/spec.md`：合并 metadata 数组 key 的 shape、校验和 source metadata preservation 规则。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/skill-manifest-contract.md`：补充 manifest parser 支持受治理 source metadata array allowlist 的设计事实。
- `openspec/designs/modules/agent-capability.md`：补充 `agent-capability` 负责 parser value normalization 和 safe source metadata validation。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：无。

## 待确认问题（Open Questions）

无。
