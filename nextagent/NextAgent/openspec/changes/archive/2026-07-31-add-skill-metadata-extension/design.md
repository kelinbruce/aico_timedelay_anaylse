## 背景和现状（Context）

Skill manifest 的 `metadata` 字段当前只支持两种类型：
1. String value：用于简单的 source metadata（如 `owner: ran-team`）
2. Array value：仅限三个 key（`exclusiveWith`、`compatibleWith`、`tags`）用于多值 metadata

这一约束来自 Agent Skills 兼容性和安全边界要求：metadata 只承载简单的 source metadata，不携带 governed behavior 语义。其他 metadata key 若提供 array 或 object value，会触发 `INVALID_OFFICIAL_FIELD` rejection。

但在电信网络智能体场景中，Skill 作者需要声明更复杂的结构化元数据：
- 嵌套配置参数（如 `threshold: {value: 95, mode: "strict"}`）
- 结构化约束声明（如 `network: {required: true, timeout: 5000}`）
- 结构化兼容性声明（如 `platforms: {5G: {AMF: true, SMF: true}}`）

当前设计中，这些需求只能：
- 拆成多个扁平 string key（破坏结构语义）
- 放入 Skill body（失去 manifest governance 边界）
- 使用外部配置文件（破坏 manifest 的权威性）

本 change 在保持安全边界的前提下，新增 `extension` 字段支持嵌套对象元数据。

## 目标和非目标（Goals / Non-Goals）

**目标：**
1. 在 `SkillMetadata` schema 中新增可选 `extension` 字段，每个 value 是 JSON primitive 或递归 JsonObject，且在顶层及任意嵌套层均排除 JsonArray。
2. Extension 字段不是必填项，Skill manifest 可以不提供 extension metadata。
3. 以 `metadata.extension` 作为保留包装键承载 extension map；其对象值子键 flatten 进 `SkillMetadata.extension.<name>`，不产生 `extension.extension.*` 双层嵌套。
4. Extension value 允许 primitive（string/number/boolean/null）和递归 JsonObject，不允许 JsonArray，并经过安全校验（key/value pattern、类型、深度、大小）。
5. Extension 不被 NextAgent 内部 governed behavior 路径消费，但可通过 typed accessor `readSkillMetadata(descriptor).extension`（即 `CapabilityDescriptor.metadata.extension`）暴露给上层集成服务。

**非目标：**
1. 不改变现有 `sourceMetadata` 的 string/array 约束和行为。
2. 不改变 governed behavior 边界：capability governance、Agent assembly、routing、policy、sandbox、model selection 等仍只消费 governed fields。
3. 不为 extension 定义特殊语义：extension 只作为 authoring metadata 保留，不进入任何 NextAgent 内部 governed decision 路径。
4. 不强制 Skill 必须提供 extension：extension 是完全可选字段。

## 设计决策（Decisions）

### 决策 1：Extension 字段与 SourceMetadata 分离

**选择：** 在 `SkillMetadata` 中新增独立、可选的 `extension` 字段，与现有 `sourceMetadata` 分离。

**可选性说明：**
- Extension 字段完全可选，Skill manifest 可以不提供 extension metadata。
- 缺少 extension 字段不会影响 Skill 的正常解析、注册和执行。
- 只有当 Skill 需要向上层集成服务提供结构化配置时，才需要提供 extension。

**理由：**
- `sourceMetadata` 已有稳定用途：简单 string metadata 和三个特殊 array key。
- 混合 nested object 进入 `sourceMetadata` 会破坏现有解析逻辑和下游 consumer 的类型假设。
- 分离字段明确 boundary：`sourceMetadata` 用于简单 metadata，`extension` 用于复杂 metadata。
- 下游 consumer 可以选择性忽略 `extension`，不影响现有 `sourceMetadata` 消费路径。

**放弃的备选方案：**
- 方案 A：扩展 `sourceMetadata` 支持 JsonObject value。破坏现有 schema 和解析逻辑，影响下游 consumer。
- 方案 B：将 nested object value 解析为 JSON string 存入 `sourceMetadata`。破坏结构语义，consumer 需要额外解析。

### 决策 2：Extension Value 安全校验策略

**选择：** Extension value 必须满足以下安全规则：
1. Key 长度 1-128，禁止 unsafe key pattern（`api_key`、`authorization`、`credential` 等）。
2. Value 允许 primitive（string、number、boolean、null）以及 Map（JsonObject）；**不支持 array**，array value 经 `EXTENSION_OMITTED` diagnostic 静默 omit（degraded）。
3. Nesting depth ≤3 levels（防止过深嵌套）。
4. Map (JsonObject) 内部嵌套 value 同样仅允许 primitive 和 Map，不允许 array。
5. 禁止 unsafe value pattern（`https?://`、`sk-[A-Za-z0-9]`、包含敏感词）。
6. string value ≤512 字符。
7. Total size ≤32KB（防止过大 metadata）。
8. 所有 nested key 和 nested string value 满足相同安全规则。

**理由：**
- 与现有 `modelOptions` 和 `sourceMetadata` 的安全校验保持一致。
- 支持 primitive（如 `smartcanvas: true`、`logging: false` 简单开关）和 Map/JsonObject（结构化配置如 `network: {required: true, timeout: 5000}`），满足作者对简短 flag 和结构化配置两种场景。
- 不支持 array：extension 定位为结构化配置 Map 和 primitive flag，数组场景由 source metadata 的 `exclusiveWith`/`compatibleWith`/`tags` 承载，避免两套同义输入（同形同策）。
- 防止 credential、endpoint、secret 等敏感信息进入 metadata：string 经 `unsafeValuePattern` fail-closed 校验。
- 防止过深嵌套和过大 metadata 影响解析性能和存储。
- Fail-closed 校验：不安全的 extension 立即 omitted，不进入 SkillMetadata。

**放弃的备选方案：**
- 方案 A：不校验 extension value。安全风险：敏感信息可能进入 metadata。
- 方案 B：校验但允许 depth >3。复杂度增加，解析和消费困难。
- 方案 C：支持 array。extension 与 source metadata 的 array 路径形成两套同义输入，违反同形同策；且 extension 定位为 Map/primitive 配置，数组不必要。

### 决策 3：Extension 输入形状与消费边界

**选择：** Extension 数据以 `metadata.extension` 作为保留包装键承载；其对象值子键 flatten 进 `SkillMetadata.extension.<name>`，不产生 `extension.extension.*` 双层嵌套。`metadata.<非 extension 名>: {object}` direct form 视为 invalid official metadata shape 被 reject。Extension 不被 NextAgent 内部 governed behavior 路径消费，但可通过 typed accessor `readSkillMetadata(descriptor).extension`（即 `CapabilityDescriptor.metadata.extension`）暴露给上层集成服务。

**理由：**
- 包装键形状对应"一个 extension map"的单一语义：`metadata.extension` 的每个子键就是一个 extension 条目，避免 direct form 与 wrapper form 两套同义输入（同形同策）。
- Flatten 语义避免 `extension.extension.*` 双层嵌套，外部消费者直接读 `extension.<name>`。
- NextAgent 内部 governed behavior 边界清晰：capability governance、Agent assembly、routing、policy、sandbox、model selection、prompt shaping 只消费 governed descriptor fields 和 typed Skill metadata。
- Extension 存在目的是为上层集成服务提供结构化元数据（如 AICO 后处理配置）。
- 上层集成服务通过 `readSkillMetadata(descriptor).extension` 读取 extension 字段，消费规则由集成服务定义。
- 若未来某个 NextAgent 内部 governance decision 需要消费 extension，必须通过新 OpenSpec change 定义 typed mapping。
- Web skill catalog 查询不暴露 `extension`（由 `add-skill-catalog-source-metadata` change 限定只投影 `sourceMetadata`）。

**消费场景示例：**
- Skill manifest 声明 `metadata.extension.smartcanvas: true` 和 `metadata.extension.logging: false`
- Parser flatten 进 `SkillMetadata.extension = {smartcanvas: true, logging: false}`
- AICO 服务通过 `readSkillMetadata(descriptor).extension.smartcanvas` 读取配置
- 对 Skill 的消息执行后处理

**放弃的备选方案：**
- 方案 A：保留 direct form（`metadata.<name>: {object}`）与 wrapper form 共存。两套同义输入违反同形同策，且 direct form 在 baseline `Unknown metadata Does Not Carry Governed Meaning` 下本就是 invalid official metadata shape。
- 方案 B：允许 NextAgent 内部 governance 路径消费 extension。破坏 governed behavior 边界，增加隐式依赖。
- 方案 C：完全禁止 extension 被消费。破坏上层集成服务消费场景，extension 存在价值有限。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | Extension key/value 禁止 unsafe pattern；total size ≤32KB；fail-closed 校验；不被 NextAgent 内部 governed behavior 路径消费。 | `skill-manifest.test.ts` extension rejected/degraded 测试用例 |
| 性能/容量 | Nesting depth ≤3 levels；total size ≤32KB；解析逻辑线性扫描。 | `skill-manifest.test.ts` extension size/depth 测试用例 |
| 可靠性/恢复 | Parser 对 unsafe extension 发出 degraded diagnostic，不 rejection。现有 manifest 解析流程不变。 | `skill-manifest.test.ts` extension degraded 测试用例 |
| 可维护性 | Extension 与 sourceMetadata 分离；安全校验规则复用现有 pattern；schema change 局限于 SkillMetadata。 | architecture boundary tests、代码审查 |
| 可测试性 | Extension accepted/degraded/rejected 三类测试用例；安全 pattern 测试覆盖。 | `skill-manifest.test.ts` 全覆盖 |
| 审计/可追溯性 | Extension omission 发出 `EXTENSION_OMITTED` diagnostic，保留 safe reason code 和 message。 | `skill-manifest.test.ts` diagnostic 测试用例 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| SkillMetadata.schema 新增 extension 字段 | 1.1 | `npm run build`、contract tests |
| Extension value 允许 primitive 和 Map(JsonObject)，禁止 array 和 unsafe pattern | 1.2 | `skill-manifest.test.ts` accepted/rejected 测试 |
| Extension array value 经 EXTENSION_OMITTED omit（degraded） | 1.2 | `skill-manifest.test.ts` array-extension-value omit 测试 |
| Extension key 长度和 pattern 校验 | 1.2 | `skill-manifest.test.ts` rejected/degraded 测试 |
| Extension nesting depth ≤3 levels | 1.2 | `skill-manifest.test.ts` rejected 测试 |
| Extension total size ≤32KB | 1.2 | `skill-manifest.test.ts` rejected 测试 |
| Extension value 禁止 unsafe pattern（含 primitive string） | 1.2 | `skill-manifest.test.ts` degraded 测试 |
| metadata.extension 包装键 flatten，无 extension.extension.* 双层嵌套 | 1.2 | `skill-manifest.test.ts` wrapper-flatten 测试 |
| metadata.<非 extension 名>: {object} direct form 被 reject | 1.2 | `skill-manifest.test.ts` direct-form-object reject 测试 |
| metadata.extension 非 object 值被 reject | 1.2 | `skill-manifest.test.ts` non-object-wrapper reject 测试 |
| Extension 不进入 governed behavior 路径 | 1.3 | 代码审查、architecture tests |
| Extension omission 发出 EXTENSION_OMITTED diagnostic | 1.2 | `skill-manifest.test.ts` diagnostic 测试 |
| 外部 accessor readSkillMetadata(descriptor).extension 可读取 extension | 1.2 | `skill-manifest.test.ts` external-accessor 测试 |

## 文档承载决策（Documentation Ownership）

- **行为契约**：`openspec/specs/skill-manifest-contract/spec.md` 主承载 Skill metadata extension 的可验证行为契约。
- **架构和跨模块设计**：`openspec/designs/architecture/core-contracts.md` 主承载 `SkillMetadata` interface 定义；`openspec/designs/architecture/skill-manifest-contract.md` 主承载 extension 字段的 Field Policy。
- **模块设计**：`openspec/designs/modules/agent-capability.md` 主承载 Skill manifest parser/mapper 的职责边界和 extension parsing 设计。
- **ADR**：`openspec/designs/adr/skill-extension-metadata-boundary.md` 主承载 extension 与 sourceMetadata 边界、安全校验策略和 governed behavior 分离原则。
- **导航**：`openspec/designs/spec-to-design-map.md` 主承载 `skill-manifest-contract` spec 到 design 文档的导航。

## 风险与取舍（Risks / Trade-offs）

**向后兼容性风险：无**
- Extension是可选字段，现有Skill不受影响
- 新增解析逻辑，不修改现有逻辑
- NextAgent内部governed behavior路径不消费extension，保持原有行为

**[风险 1] Extension metadata 可能包含敏感信息**
-> 缓解：unsafe key/value pattern 校验、fail-closed omission、不进入 governed behavior 路径。

**[风险 2] Extension nesting depth 过大影响解析性能**
-> 缓解：depth ≤3 levels 约束、total size ≤32KB 约束。

**[风险 3] 下游 consumer 可能误消费 extension 推导行为**
-> 缓解：明确声明 extension 不进入 NextAgent 内部 governed behavior 路径；若需消费，必须通过新 OpenSpec change 定义 typed mapping。

**[风险 4] 现有代码可能受 extension 解析逻辑影响**
-> 缓解：新增解析分支，不修改现有解析逻辑；现有测试保持不变；新增测试覆盖extension场景。

**取舍：**
- 选择独立 extension 字段而非扩展 sourceMetadata：牺牲一点 metadata 字段一致性，换取边界清晰和下游 consumer 不受影响。
- 选择 fail-closed 安全校验而非 fail-open：牺牲一点 authoring 灵活性，换取安全边界明确。
- 选择同时支持 primitive 与嵌套 JsonObject、拒绝 JsonArray：覆盖 flag 与结构化配置，同时避免与 source metadata 的 array 语义形成第二套输入。

## 发布约束

Extension 字段保持可选，未声明 `metadata.extension` 的 Skill manifest 行为不变，发布不需要数据转换或额外配置。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约：**
- `openspec/specs/skill-manifest-contract/spec.md`：新增 Requirement "Skill Metadata Extension Supports Nested Object Values"，定义 extension 字段的安全校验和 boundary。

**长期背景：**
- `openspec/overview.md`：补充 Skill manifest 支持结构化 extension 元数据的能力描述。

**设计视图：**
- `openspec/designs/architecture/core-contracts.md`：更新 `SkillMetadata` interface，新增 value 为 JSON primitive 或递归 JsonObject、且不含 array 的可选 `extension` 字段。
- `openspec/designs/architecture/skill-manifest-contract.md`：更新 Field Policy，补充 extension 字段的安全边界和使用场景。
- `openspec/designs/modules/agent-capability.md`：更新 Skill manifest parser/mapper 职责，补充 extension parsing 设计。
- `openspec/designs/adr/skill-extension-metadata-boundary.md`：新增 ADR，承载 extension 与 sourceMetadata 边界、安全校验策略和 governed behavior 分离原则。
- `openspec/designs/spec-to-design-map.md`：更新 `skill-manifest-contract` 到 design 文档的导航。

**验证入口：**
- `packages/agent-capability/tests/skill-manifest.test.ts`：新增 extension accepted/degraded/rejected 测试用例。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.8-发现技能` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/skill-manifest-contract/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
