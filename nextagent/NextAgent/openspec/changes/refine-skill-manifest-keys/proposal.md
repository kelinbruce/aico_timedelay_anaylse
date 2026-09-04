# Skill manifest 声明键简化

## 背景与问题（Why）

Skill manifest 的受治理声明键存在三类问题：

1. **model hint 声明入口过多**。model hint 有四个入口：顶层 `model`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 和 compatibility alias `metadata.model`。其中 `nextagent.*` 命名空间是历史引入的 NextAgent 专属扩展写法，与顶层 `model`、`metadata.model` 表达同一事实却多出两个入口，加重了白名单、解析和冲突归一逻辑；Skill 作者也需要在多种等价写法中做选择。
2. **tool 约束声明位置不对称**。`allowed-tools` 是顶层键，而语义对称的 denied tool 约束却只能通过 `metadata.denied-tools` 声明，同为 tool 约束事实的两个键在 manifest 中的位置和形态不一致（违反同形同策）。
3. **未知键 fail closed 过严**。frontmatter 中出现白名单之外的顶层键（如生态字段、编写工具生成的元数据）会导致整个 Skill 被拒绝；metadata 下的不安全或形态不符条目会产生 degraded 诊断甚至拒绝 manifest。系统的安全边界由"只加载约定字段、未知字段不获得语义"保证，逐键拒绝和不安全条目诊断没有必要。

本次调整收敛声明键并放宽顶层键校验：model 声明入口收敛为顶层 `model`（仅模型名字符串）+ `metadata.modelOptions`；denied tool 约束迁移为顶层 `disallowed-tools`，与 `allowed-tools` 配置方式完全一致（空格分隔字符串或字符串数组，同一解析路径），`metadata.denied-tools` 移除；未知顶层键改为忽略而不拒绝。

## 变更范围（What Changes）

- **BREAKING**：移除受治理 metadata 键 `metadata.nextagent.model`、`metadata.nextagent.modelOptions` 和 `metadata.denied-tools`。这些键不再获得任何治理语义：安全字符串值作为 string source metadata 保留进 `SkillMetadata.sourceMetadata`（模型 hint 需迁移到顶层 `model`/`metadata.modelOptions`，denied tool 约束需迁移到顶层 `disallowed-tools`，否则相关声明静默不生效）。
- **BREAKING**：`metadata.model` 不再作为 model 声明入口；它回归为普通 string source metadata，保存在 `SkillMetadata.sourceMetadata`，不携带 model 治理语义。
- **BREAKING**：顶层 `model` 只接受安全模型名字符串；原 JSON 对象形态（含 `model`/`modelOptions`）不再被接受，以 `UNSAFE_MODEL_DECLARATION` 拒绝。
- 新增受治理 metadata 键 `metadata.modelOptions`：必须为安全 JSON 字符串对象，解析后经 `ModelInferenceOptionsSchema` 与安全键值校验，映射为 `SkillMetadata.modelOptions`。
- 支持的 model 声明入口收敛为两个：顶层 `model`（仅模型名字符串）和 `metadata.modelOptions`（JSON 字符串对象）。每个 fact 只有一个声明入口，跨入口 model/modelOptions 冲突在结构上不再可能；`CONFLICTING_MODEL_DECLARATION` reason code 在契约中保留但当前不可触发。
- **BREAKING**：新增顶层键 `disallowed-tools`，配置方式与 `allowed-tools` 完全一致（空格分隔字符串或 YAML/inline 字符串数组，同名解析、同 pattern、去重保序），映射为 `SkillMetadata.deniedTools`。
- **BREAKING（放宽）**：未知顶层键不再以 `INVALID_OFFICIAL_FIELD` 拒绝。系统仅加载约定的受治理顶层字段集，白名单之外的顶层键被静默忽略——不产生治理语义、不进入 Skill metadata/sourceMetadata，也不产生诊断。manifest 携带生态或编写工具生成的额外字段时仍可加载。
- **BREAKING（放宽）**：metadata 下未知/不安全条目同样静默忽略，与顶层键策略对齐。不安全键值（命中 unsafe pattern）、保留句柄（`sourceIdentity`/`frontmatterHash`）、`extension` wrapper 之外的直填对象、不受支持键上的数组值和不受支持的值形态不再触发 `SOURCE_METADATA_OMITTED`/`EXTENSION_OMITTED` degraded 诊断，也不再因直填对象拒绝 manifest——直接静默省略，安全兄弟条目正常保留。安全 string metadata 和 `exclusiveWith`/`compatibleWith`/`tags` 安全数组仍保留进 `sourceMetadata`。
- **BREAKING**：manifest 解析路径不再产生 `degraded` outcome（解析结果只有 accepted/rejected）；`SOURCE_METADATA_OMITTED`/`EXTENSION_OMITTED` reason code 在公共契约中保留但当前不可触发。
- **BREAKING（放宽）**：`description` 长度上限按文种区分：含 Han script（中文）字符时（含中英混排）上限 1024 字符不变；不含中文字符的纯英文 description 上限放宽到 4096 字符。CJK 字符信息密度更高，等量信息所需字符数更少，纯英文作者需要更长的描述表达同等信息。
- `SkillMetadata` typed shape（含 `allowedTools`/`deniedTools`/`sourceMetadata`/`extension`）和下游治理消费方式不变。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-5.8 发现技能`：修改其主规格 `skill-manifest-contract` 中 model 声明入口、tool 约束声明位置和 metadata 分类相关 Requirement，新增 reason code 保留 Requirement。

## Feature 影响

- 无 Feature delta。用户价值和 Function 组成不变；本次仅简化 Skill 作者声明 model hint 和 tool 约束的入口。

## 影响范围（Impact）

- `agent-capability`：`packages/agent-capability/src/skills/skill-manifest.ts` 调整顶层键解析、`supportedMetadataKeys`、`parseModelDeclarations` 与 tool 约束解析。
- `agent-contracts`：无 schema 变化（`SkillMetadata` 字段保持不变）。
- 开发者文档 `docs/developer/04-skill-tool-development.md` 与用户指导文档中 `metadata.nextagent.*`、`metadata.denied-tools` 写法需同步更新（长期基线文档在归档时更新）。
- 已有 Skill 资产若声明被移除的键，升级后相关声明会静默不生效（保留为 source metadata，不报错）；存量资产需按迁移说明排查更新。

## 迁移说明

- `metadata.nextagent.model: <model-id>` → 顶层 `model: <model-id>`。
- `metadata.nextagent.modelOptions: '<json>'` → `metadata.modelOptions: '<json>'`。
- `metadata.model: <model-id 或 json>` → 模型名迁移到顶层 `model: <model-id>`，推理参数迁移到 `metadata.modelOptions`。
- 顶层 `model: '{"model":…,"modelOptions":…}'` → 模型名改为顶层 `model: <model-id>` 字符串，推理参数迁移到 `metadata.modelOptions`。
- `metadata.denied-tools: <tools>` → 顶层 `disallowed-tools: <tools>`（值形态不变：空格分隔字符串或字符串数组）。

## 非目标（Non-Goals）

- 不改变 `SkillMetadata.model` / `SkillMetadata.modelOptions` / `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools` 的 typed shape 与下游治理消费。
- 不改变 model hint 的非权威性约束和 model/profile governance 所有权。
- 不改变 `allowed-tools`/`tools` 既有语义与互斥规则。
- 不新增其他 metadata 治理键。
