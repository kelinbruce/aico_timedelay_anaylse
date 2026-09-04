# 设计说明：Skill manifest 声明键简化

## 设计范围

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-5.8 发现技能` | 收敛 model 声明入口，tool 约束迁移为顶层 `disallowed-tools` | `skill-manifest-contract` | `FN-5.8 manifest 声明键收敛` |

## FN-5.8 manifest 声明键收敛

### 目标与规范依据

Skill manifest 的受治理声明键做两类收敛：

1. model hint 声明入口从四个（顶层 `model`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions`、alias `metadata.model`）收敛为两个（顶层 `model` 仅模型名字符串、`metadata.modelOptions`）。
2. denied tool 约束从 `metadata.denied-tools` 迁移为顶层 `disallowed-tools`，与 `allowed-tools` 同位、同形态、同解析路径。

本 Function 的目标 Requirements：

- `MODIFIED Skill Manifest Supports Standard And Supported Extension Frontmatter Fields`
- `MODIFIED Model Declarations Are Governed Model Hints`
- `MODIFIED allowed-tools And disallowed-tools Are Tool Constraint Facts`（原 `allowed-tools And metadata.denied-tools Are Tool Constraint Facts`）
- `MODIFIED Metadata Field Parsing Distinguishes String Source Metadata, Reserved Extension Wrapper, and Invalid Direct-Form Object`
- `MODIFIED Unknown metadata Does Not Carry Governed Meaning`
- `MODIFIED Manifest Validation Outcome Is Explicit`
- `MODIFIED Skill Manifest Diagnostic Includes Extension Reason Code`
- `MODIFIED Skill Metadata Extension Supports Nested Object Values`
- `MODIFIED Skill Manifest Denied Tool Constraints SHALL Accept List Forms`（入口从 `metadata.denied-tools` 迁移为顶层 `disallowed-tools`）
- `ADDED Skill Manifest Diagnostic Reason Code Set Covers Removed Model Conflict Path`

唯一 canonical spec：`skill-manifest-contract`。

### 关键决策

1. **`metadata.modelOptions` 为受治理 metadata 键，只承载推理参数**。它是 JSON 字符串对象，解析后走 `ModelInferenceOptionsSchema` 与 `isSafeJsonObject` 校验。`model` 标识符只能通过顶层 `model` 声明，`metadata.modelOptions` 中出现 `model` 键按 `UNSAFE_MODEL_DECLARATION` 拒绝，避免形成第三个 model id 入口。

2. **`metadata.model` 回归 string source metadata**，不再解析为 model 声明。安全字符串值保存进 `SkillMetadata.sourceMetadata`，不携带治理语义。与"未知 metadata 不携带治理含义"的既有原则一致（同形同策：非治理键统一按 source metadata 处理）。

3. **移除键与未知键同策略（统一静默降级）**。`metadata.nextagent.model` / `metadata.nextagent.modelOptions` / `metadata.denied-tools` / `metadata.model` 从 `supportedMetadataKeys` 白名单移除后，与其他未知 metadata 一样按 source metadata 处理：安全字符串值保留进 `SkillMetadata.sourceMetadata`，不携带治理语义，不拒绝、不诊断。理由（同形同策）："未知 metadata 不携带治理含义"是既有原则，安全边界由"治理行为只消费 governed 字段"保证，而不是由"拒绝旧键"保证；对旧键单独 fail closed 会形成与未知键策略不一致的特例。代价是存量资产的旧声明会静默不生效，需要通过文档迁移说明和资产排查覆盖（见 proposal 迁移说明），不构成安全问题——治理行为从不读取这些键，新旧写法不会同时生效产生歧义。

4. **每个 fact 唯一入口，冲突路径结构性消失**。model id 只能通过顶层 `model` 字符串声明，modelOptions 只能通过 `metadata.modelOptions` 声明，跨入口冲突不再可能；`parseModelDeclarations` 相应简化为单值解析。`CONFLICTING_MODEL_DECLARATION` reason code 在公共契约中保留（避免 enum 破坏性收缩），但当前不可触发，通过 ADDED Requirement 明确其保留语义。

5. **顶层 `model` 移除 JSON 对象形态**。顶层 `model` 只接受安全模型名字符串，非字符串或 JSON 对象形态以 `UNSAFE_MODEL_DECLARATION` 拒绝；推理参数统一由 `metadata.modelOptions` 承载。由此 `parseModelDeclarationValue` helper 删除，冲突归一使用的 `stableStringify`/`sortJson` 成为 dead code 一并清理。

6. **`disallowed-tools` 与 `allowed-tools` 完全同形同策**。两者都是顶层键，都走同一个 `parseOptionalToolConstraint`（空格分隔字符串或字符串数组、同一工具名 pattern、首现去重），分别映射为 `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools`。原 `metadata.denied-tools` 在 metadata 侧的形态特判（string/数组双重容错）随入口移除一并删除，`deniedTools` 的 typed shape 与下游 `CapabilityContextPatch` 消费不变。

7. **未知顶层键改为忽略（fail-open load, fail-closed semantics）**。移除 `supportedTopLevelKeys` 白名单的逐键拒绝。安全边界不依赖"拒绝未知键"，而依赖"只从约定字段集读取"——未知顶层键不会被解析、不会进入 `SkillMetadata`/`sourceMetadata`、不产生治理语义，因此无法通过额外字段注入任何行为。这与 metadata 侧"未知 metadata 作为 source metadata 保留"策略不同：顶层键没有 source-metadata 保留语义，静默忽略即可（manifest 的作者可见信息主要在 metadata 和 body 中）。已知的错误值校验（如非法 `name`、非布尔 `user-invocable`）全部保留，字段值错误仍 fail closed。

8. **metadata 下未知/不安全条目同样静默忽略（同形同策）**。与顶层键策略对齐：不安全键值、保留句柄、直填对象、不支持数组键、不支持值形态一律静默省略，不再产生 `SOURCE_METADATA_OMITTED`/`EXTENSION_OMITTED` degraded 诊断，也不再因直填对象拒绝。理由：(a) 未知 metadata 不携带治理语义，省略不改变任何行为；(b) 不安全条目本来就不进入 metadata，degraded 诊断只传达"有东西被省略"却不可披露细节，对治理决策没有输入价值；(c) 与顶层键宽容策略不一致会让 Skill 作者对两处行为产生不同预期。安全 string metadata 与 `exclusiveWith`/`compatibleWith`/`tags` 安全数组的保留行为不变（`zh-name`/`en-name` 展示名等既有消费方依赖此路径）。由此 manifest 解析不再产生 `degraded` outcome；`parseMetadataWithExtension` 简化为无诊断返回，dead code `parseSourceMetadata` 一并删除。`SOURCE_METADATA_OMITTED`/`EXTENSION_OMITTED` reason code 在公共契约中保留（避免 enum 破坏性收缩），当前不可触发。

9. **`description` 长度上限按文种区分**。含 Han script 字符（含中英混排）时上限 1024，不含中文时上限 4096。判定用 Unicode `\p{Script=Han}` 正则（覆盖简繁中文汉字，不含假名/谚文），`String.length` 计数（UTF-16 code unit，BMP 内汉字为 1）。理由：CJK 信息密度高，同等语义所需字符少；纯英文 1024 上限对充分描述 Skill 触发条件不够用。descriptor schema（`agent-contracts` capability）的 `description` 只有 `minLength: 1` 无 maxLength，放宽不触碰 frozen contract。

10. **`SkillMetadata` schema 不变**。`model`、`modelOptions`、`allowedTools`、`deniedTools`、`sourceMetadata`、`extension` 字段保持原样，下游 governance 消费不需要调整。

### 实现要点

- `packages/agent-capability/src/skills/skill-manifest.ts`：
  - 删除 `supportedTopLevelKeys` 白名单及其未知顶层键 `INVALID_OFFICIAL_FIELD` 拒绝逻辑；解析只从约定顶层字段读取。
  - `supportedMetadataKeys`：移除 `nextagent.model`、`nextagent.modelOptions`、`denied-tools`、`model`，新增 `modelOptions`。
  - 未知 metadata 处理处：对 `nextagent.model`、`nextagent.modelOptions`、`denied-tools` 三个精确键名增加 `INVALID_OFFICIAL_FIELD` 拒绝。
  - `disallowed-tools` 直接复用 `parseOptionalToolConstraint`（与 `allowed-tools` 同一路径），删除 `metadata.denied-tools` 的形态特判。
  - `parseModelDeclarations`：重写为单值解析——顶层 `model` 仅接受模型名字符串（非字符串或 JSON 对象拒绝），`metadata.modelOptions` 为唯一推理参数入口且拒绝其中出现 `model` 键；删除 `parseModelDeclarationValue` helper 与冲突归一逻辑（含 dead code `stableStringify`/`sortJson` 清理）。
- `packages/agent-capability/tests/skill-manifest.test.ts`：更新 nextagent/denied-tools 用例为新入口，新增移除键拒绝、`metadata.model` 回归 sourceMetadata、`metadata.modelOptions` 含 `model` 键拒绝、顶层 `model` JSON 对象拒绝、非法 `disallowed-tools` 拒绝等用例。
- 文档：`docs/developer/04-skill-tool-development.md` 的 model 声明与 tool 约束写法改为新入口；`docs/用户配置和使用指导.md` 同步修正。

### 验证策略

- Focused tests：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts`。
- 仓库门禁：`npm test`（agent-capability 范围）、`openspec validate --all --strict`。
- Negative cases 必须实际触发：移除键拒绝（含 `metadata.denied-tools`）、`metadata.modelOptions` 含 `model` 键拒绝、顶层 `model` JSON 对象拒绝、非法 `disallowed-tools` 拒绝。
