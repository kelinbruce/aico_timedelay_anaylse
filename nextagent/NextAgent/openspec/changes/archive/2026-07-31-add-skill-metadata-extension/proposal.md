## 背景与问题（Why）

Skill manifest 的 `metadata` 字段当前只支持 string value 或特定 array key（`exclusiveWith`、`compatibleWith`、`tags`）。这一设计约束来自 Agent Skills 兼容性和安全边界要求：metadata 只承载简单的 source metadata，不携带 governed behavior 语义。

但在电信网络智能体场景中，Skill 作者经常需要声明更复杂的结构化元数据，例如：
- 嵌套的配置参数（如 `{"threshold": 95, "mode": "strict"}`）
- 结构化约束声明（如 `{"network": {"required": true, "timeout": 5000}}`）
- 结构化兼容性声明（如 `{"platforms": {"5G": {"AMF": true, "SMF": true}}}`）

当前设计中，这些复杂元数据只能拆成多个扁平 string key，或被迫放入 Skill body（失去 manifest governance 边界）。这导致：
- Skill 作者无法在 manifest 中声明结构化元数据
- 复杂配置散落在 body 或外部配置文件，破坏 manifest 的权威性
- 下流 governance 无法从 metadata 获得结构化信息

本 change 的目标是新增 `extension` 字段，支持 value 为 JSON primitive 或递归 JsonObject 的结构化扩展元数据，同时保持与现有 `sourceMetadata` 的安全边界和 governed behavior 分离原则。

## 变更范围（What Changes）

**向后兼容性：本change对 extension 输入形状做了收紧——`metadata.<其它名>: {object}` 不再被接受为 extension，必须改写到 `metadata.extension.<名>` 下。由于本 change 尚未归档、extension 路径尚未有线上 Skill 依赖 direct form，该收紧不构成对外破坏性变更。**

1. 在 `SkillMetadata` schema 中新增可选 `extension` 字段，value 仅允许 JSON primitive 或递归 JsonObject；顶层及任意嵌套层均不允许 JsonArray。
2. 在 SKILL.md frontmatter 中以 `metadata.extension` 作为保留包装键承载 extension map；其对象值的每个子键 flatten 进 `SkillMetadata.extension.<名>`，不产生 `extension.extension.*` 双层嵌套。`metadata.<非 extension 名>: {object}` 视为 invalid official metadata shape，按 baseline `Unknown metadata Does Not Carry Governed Meaning` 规则 reject。
3. extension value 必须经过安全校验：
   - Key 长度限制（≤128）和禁止 unsafe key pattern
   - Value 类型允许 primitive（boolean/number/null 和经安全 pattern 校验的 string）以及 Map（JsonObject）；**不支持 array**，array value 经 `EXTENSION_OMITTED` diagnostic 静默 omit（degraded）
   - Value 深度限制（≤3层嵌套）和禁止 unsafe value pattern
   - Map (JsonObject) 内部嵌套 value 同样仅允许 primitive 和 Map，不允许 array
   - 禁止包含 credential、endpoint、secret、raw path、raw provider response
   - string value ≤512 字符，禁止 unsafe value pattern（`https?://`、`sk-` 前缀、`api_key`/`authorization`/`credential`/`password`/`secret`/`token`）
   - Total size 限制（≤32KB）
4. extension 与 `sourceMetadata` 的边界：
   - `sourceMetadata` 保持现有 string/array 约束，用于简单 source metadata
   - `extension` 用于复杂嵌套对象，通过 `CapabilityDescriptor.metadata.extension` 暴露给上层集成服务
5. 消费边界：
   - NextAgent 内部 governed behavior 路径（capability governance、Agent assembly、routing、policy、sandbox、model selection）不从 `extension` 推导行为
   - 上层集成服务可通过 `readSkillMetadata(descriptor).extension`（即 `CapabilityDescriptor.metadata.extension`）读取 extension 字段
   - 上层服务的消费规则由集成服务定义，不在 NextAgent 范围内

## 影响分析（Impact Analysis）

### 向后兼容性

| 影响对象 | 影响评估 | 详细说明 |
|---------|---------|---------|
| **现有Skill** | ✓ 无影响 | Extension是可选字段，现有Skill没有extension仍正常解析、注册、执行 |
| **现有Parser** | ⚠ 形状收紧 | `metadata.extension` 设为保留包装键并 flatten；`metadata.<非 extension 名>: {object}` 由原 direct-form 接受改为 reject。本 change 未归档、无线上 Skill 依赖 direct form，收紧不对外破坏 |
| **现有Mapper** | ✓ 无影响 | 新增extension字段映射，不影响现有metadata字段映射 |
| **现有Governance** | ✓ 无影响 | NextAgent内部governed behavior路径不消费extension，保持原有行为 |
| **现有测试** | ⚠ 形状收紧 | `skill-manifest.test.ts` 中 direct-form extension 用例改为 wrapper 形状；新增 wrapper-flatten、direct-form-object reject、primitive-in-wrapper accept、array reject/omit 用例 |

### 破坏性变更评估

**结论：无对外破坏性变更；extension 输入形状收紧仅影响本 change 内部**

- Schema新增可选字段：TypeScript类型兼容，不影响现有代码编译
- Parser：`metadata.extension` 包装键 flatten + direct-form object reject；该 direct form 仅存在于本 change 自有测试，未归档未上线，收紧不构成对外破坏
- Mapper新增字段映射：新增字段，不影响现有字段
- Governance行为不变：NextAgent内部路径不消费extension，保持原有governed behavior

### 现有Skill行为对比

**有extension的Skill：**
```yaml
metadata:
  extension:
    smartcanvas: true
    logging: false
```
- 解析结果：正常接受，`SkillMetadata.extension = {smartcanvas: true, logging: false}`
- governed behavior：不受影响，NextAgent内部路径忽略extension
- `metadata.extension` 是保留包装键，其对象值子键 flatten 进 `SkillMetadata.extension`，不产生 `extension.extension.*` 双层嵌套；extension 数据只能写在 `metadata.extension` 下，`metadata.<其它名>: {object}` 视为 invalid official metadata shape 被 reject
- extension value 允许 primitive（boolean/number/null 和经安全 pattern 校验的 string）以及递归 JsonObject；不允许 JsonArray；string 仍受 ≤512 字符和 unsafe pattern 禁止约束

**无extension的Skill：**
```yaml
metadata:
  owner: ran-team
```
- 解析结果：正常接受，`SkillMetadata.extension` 为undefined
- governed behavior：与现有行为完全一致

### 现有代码修改范围

| 文件 | 修改类型 | 影响范围 |
|-----|---------|---------|
| `agent-contracts/capability/index.ts` | 新增字段 | Schema新增可选extension字段，新增EXTENSION_OMITTED reason code |
| `agent-capability/src/skills/skill-manifest.ts` | 新增函数 | 新增parseExtension函数，修改parseSkillFrontmatter增加extension分支 |
| `packages/agent-capability/tests/skill-manifest.test.ts` | 新增测试 | 新增extension测试用例，现有测试保持不变 |

### 发布影响

**发布影响：无需额外操作**

- 现有Skill无需修改：extension是可选字段
- 现有代码无需重构：新增逻辑，不修改现有逻辑
- 现有测试无需修改：新增测试，现有测试保持不变
- 现有部署无需额外配置

### 潜在风险

**风险：无显著风险**

- 向后兼容：现有Skill和代码不受影响
- 安全可控：extension经过严格安全校验
- 性能影响：新增解析逻辑，性能影响可忽略（≤32KB metadata）
- 行为隔离：NextAgent内部governed behavior路径不消费extension

## Capability 影响（Capabilities）

### 新增 Capability

(none)

### 修改的 Capability

- `skill-manifest-contract`：新增 `SkillMetadata.extension` 字段定义，以 `metadata.extension` 保留包装键承载 extension map（flatten 进 `SkillMetadata.extension`），更新 validation outcome 规则。

## 影响范围（Impact）

**Contract 变化**：
- `agent-contracts/capability`：`SkillMetadataSchema` 新增 `extension` 字段，value 类型为 JSON primitive 或递归 JsonObject；schema 在顶层及任意嵌套层拒绝 array。
- `agent-contracts/capability`：新增 `SkillManifestDiagnostic.reasonCode` 值 `EXTENSION_OMITTED`（extension value 不安全时使用）。

**Parser 变化**：
- `agent-capability/src/skills/skill-manifest.ts`：`parseFlatFrontmatter` 支持解析嵌套对象 value；`parseMetadataWithExtension` 将 `metadata.extension` 识别为保留包装键，flatten 其对象值子键进 `extensionValue`，并对 `metadata.<非 extension 名>: {object}` direct form 改为 reject（`INVALID_OFFICIAL_FIELD`）。

**Mapper 变化**：
- `agent-capability/src/skills/skill-manifest.ts`：`createSkillMetadata` 新增 `extension` 字段映射；`isSkillMetadata` 校验新增 `extension` 类型守卫。

**Accessor 变化**：
- `agent-capability/src/skills/skill-manifest.ts`：`readSkillMetadata` 保持不变，accessor 只验证 metadataKind 和 governed fields，`extension` 作为可选字段保留；外部上层集成服务通过 `readSkillMetadata(descriptor).extension`（即 `CapabilityDescriptor.metadata.extension`）读取 extension 配置。
- `CapabilityDescriptor.metadata.extension`：上层集成服务可通过此路径读取 extension 字段。

**测试变化**：
- `packages/agent-capability/tests/skill-manifest.test.ts`：direct-form extension 用例改写为 `metadata.extension` wrapper 形状；新增 wrapper-flatten、direct-form-object reject、primitive-in-wrapper accept、array omission、external-accessor 读取 extension 用例。

## 需群内确认

- **已确认（2026-07-28）：**群内已确认 `agent-contracts/capability.SkillMetadataSchema.extension` 允许 primitive 与递归嵌套 object、拒绝 array，并保留 `EXTENSION_OMITTED` 诊断边界。

**文档变化**：
- `openspec/specs/skill-manifest-contract/spec.md`：新增 Requirement 定义 extension 字段行为和安全约束。
- `openspec/designs/architecture/core-contracts.md`：更新 `SkillMetadata` interface 定义。
- `openspec/designs/architecture/skill-manifest-contract.md`：更新 Field Policy 说明 extension 字段边界。

## 归档前更新基线（Baseline Promotion Plan）

**行为契约**：
- `openspec/specs/skill-manifest-contract/spec.md`：新增 Requirement "Skill Metadata Extension Supports Nested Object Values"，定义 extension 字段的安全校验和 boundary。

**长期背景**：
- `openspec/overview.md`：补充 Skill manifest 支持结构化 extension 元数据的能力描述。

**设计视图**：
- `openspec/designs/architecture/core-contracts.md`：更新 `SkillMetadata` interface，新增 value 为 JSON primitive 或递归 JsonObject、且不含 array 的可选 `extension` 字段。
- `openspec/designs/architecture/skill-manifest-contract.md`：更新 Field Policy，补充 extension 字段的安全边界和使用场景。
- `openspec/designs/adr/<id>.md`：新增 ADR "Extension Metadata Boundary"，说明 extension 与 sourceMetadata 的边界、安全校验策略和 governed behavior 分离原则。
- `openspec/designs/spec-to-design-map.md`：更新 `skill-manifest-contract` 到 design 文档的导航。

**验证入口**：
- `packages/agent-capability/tests/skill-manifest.test.ts`：新增 extension accepted/degraded/rejected 测试用例。
- `npm run build`：TypeScript 编译验证。
- `npm run test:contract`：contract 测试验证。
- `npm test`：单元测试验证。
