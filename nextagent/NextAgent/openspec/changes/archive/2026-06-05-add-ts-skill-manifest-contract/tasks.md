## 1. 规格与契约冻结

- [x] 1.1 刷新 `skill-manifest-contract` delta spec，定义 `SKILL.md` 权威输入、Skill descriptor input、typed `SkillMetadata` 和 safe diagnostics。
- [x] 1.1a Define `CapabilityDescriptor.description`, `SkillMetadata`, `SkillManifestDiagnostic`, and their runtime schemas, with `agent-contracts/capability` as the public schema/type owner and `agent-capability` as the parser, mapping, typed accessor, and diagnostic production implementation owner.
- [x] 1.2 在 design 中固化 `SkillFrontmatter` 作为 parser 内部过程数据、`SkillMetadata` 作为 `CapabilityDescriptor.metadata` typed contract 的目标策略，并说明 source、capability governance、Agent assembly、context disclosure 和 execution changes 的消费边界。
- [x] 1.2a 定义 reusable frontmatter parser 和 descriptor mapper 的最小输入输出：parser 只消费 leading frontmatter block 或 extracted frontmatter source，以及 source 可提供的 safe candidate name；mapper 消费 validated frontmatter facts + `CapabilityProvider` 并产出 Skill `CapabilityDescriptor` + typed `SkillMetadata`。
- [x] 1.2b 将 `CapabilityDescriptor.safeDescription` contract refinement 为 `CapabilityDescriptor.description`，并说明安全描述约束保持不变。
- [x] 1.2c 在 design 中列出现有代码基线和唯一最小 delta：`CapabilityDescriptor.safeDescription`、read descriptor、context-engine tool projection、StaticCapabilityCatalog、缺失 Skill parser/mapper/schema/accessor。
- [x] 1.3 完成与 `establish-ts-backend-architecture`、`establish-ts-core-contracts`、`add-ts-capability-core-governance`、`add-ts-agent-package-assembly` 的一致性审视，并记录 `CapabilityDescriptor.description`、`SkillMetadata`、`SkillManifestDiagnostic` public contract refinements 需要群内确认。

## 2. Manifest 字段与扩展口径

- [x] 2.1 定义标准 `SKILL.md` frontmatter 字段和 markdown body 的安全边界。
- [x] 2.1a Define official Agent Skills field validation for required `name`, required `description`, optional `license`, optional string `compatibility`, optional string-to-string `metadata`, and optional space-separated string `allowed-tools`, including official name/description/compatibility length and format limits, and `name` matching the safe source candidate name when available.
- [x] 2.2 定义顶层 `context` 扩展，仅允许 `inline` 和 `fork`，并明确缺省值和非执行语义。
- [x] 2.2a 定义顶层 `user-invocable` 扩展，明确缺省值、boolean 校验和 capability governance / auth 仍然生效的边界。
- [x] 2.2b 定义顶层 `model-invocable` 扩展，明确缺省值、boolean 校验和模型/编排触发 Skill 时的 eligibility 语义。
- [x] 2.2c 定义顶层 `agent` 扩展，明确其必须校验为现有 Agent assembly contract 使用的 canonical `AgentId`，且只表达 fork Agent selection hint；`agent` 缺省 `context` 时归一为 `fork`，与 `context:inline` 同时出现时 rejected。
- [x] 2.3 定义 `metadata.version` 到 `CapabilityDescriptor.version` 的映射，定义 `metadata.denied-tools`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 三个受支持 metadata 扩展，并保留 `metadata.model` 兼容别名；明确模型声明作为非权威模型 hint，其他 string source metadata 进入 safe source metadata 或 safe diagnostic 路径。
- [x] 2.3a Define metadata extension parsing from Agent Skills compatible metadata values into typed `SkillMetadata.deniedTools`, `SkillMetadata.model`, and `SkillMetadata.modelOptions`; reject invalid JSON, unsafe provider config, credentials, endpoints, unsupported shapes, and conflicting model declaration sources.
- [x] 2.4 定义 `allowed-tools` 与 `metadata.denied-tools` 映射为 `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools`，授权仍由 capability governance、Agent assembly、owner scope 和 policy 决定。

## 3. Validation Outcome 与安全诊断

- [x] 3.1 定义 accepted、rejected、degraded 三类 manifest validation outcome，并增加决策表：safe unknown metadata retained 是 accepted；optional unsafe source metadata omitted 是 degraded；invalid official fields 或 governed extensions 是 rejected。
- [x] 3.2 定义缺失/非法 `name`、`name` 与 safe source candidate name 不一致、缺失/非法 `description`、非法 official field shape、非法 `context`、非法 `agent`、`agent` + `context:inline`、非 boolean `user-invocable`、非 boolean `model-invocable`、非法工具约束、不安全模型声明和冲突模型声明的 rejected 条件。
- [x] 3.3 定义未支持 metadata 字段的 source metadata 或 degraded 处理规则，并明确治理决策输入只消费 governed descriptor fields 和 typed `SkillMetadata`。
- [x] 3.3a Define the single unknown metadata path: safe unknown metadata is preserved only as `sourceMetadata`; unsafe or unparsable unknown metadata is omitted and reported through degraded safe diagnostics.
- [x] 3.4 定义 `SkillManifestDiagnostic` 的安全限制和稳定 public reason code 集，diagnostic 只输出 reason code、severity (`INFO` / `WARNING` / `ERROR`)、validation outcome、sanitized message、optional safe providerId 和 optional safe skillName。

## 4. 下游消费边界

- [x] 4.1 定义 builtin/local/agent-scoped/SkillHub source 必须复用同一 parser/mapping helper，跨模块输出 Skill descriptor input、typed `SkillMetadata` 和 safe diagnostics。
- [x] 4.2 定义 capability descriptor 输入来自 accepted frontmatter mapping result 和 provider/source facts，并明确 Skill `name` 映射为 `CapabilityDescriptor.capabilityId` 和模型可见调用名，frontmatter `description` 映射为 `CapabilityDescriptor.description`，`metadata.version` 映射为 `CapabilityDescriptor.version`。
- [x] 4.3 定义 Agent assembly 和 context disclosure 消费已治理 Skill descriptor、validated description 或 safe diagnostics，raw manifest 由 source/invocation owner 管理。
- [x] 4.4 明确 Skill invocation、fork runtime、SkillHub protocol、routing 和 sandbox 行为归属后续 owner changes。
- [x] 4.5 增加 contract ownership check：builtin/local/agent-scoped/SkillHub source、Agent assembly 或 context disclosure 使用 `SkillMetadata` public schema/type 和 typed accessor，parser-only frontmatter DTO 留在 `agent-capability` implementation boundary。
- [x] 4.6 定义 `CapabilityDescriptor.metadata` -> `SkillMetadata` typed accessor/validator，要求 downstream package 通过 accessor 或 schema validation result 读取 Skill-specific metadata。

## 5. 验收样例与验证

- [x] 5.1 增加正常路径 spec scenario：标准 `SKILL.md` 被接受并生成 Skill descriptor input 和 typed `SkillMetadata`。
- [x] 5.1a 增加 contract ownership scenario：跨 source、capability governance、Agent assembly 和 context disclosure 的 manifest validation result 必须使用 `agent-contracts/capability` public `SkillMetadata` / `SkillManifestDiagnostic` contract。
- [x] 5.1b 增加官方兼容 scenario：`name`、`description`、`compatibility`、`metadata`、`allowed-tools` 按 Agent Skills official shape 校验，且 `name` 与 safe source candidate name 一致。
- [x] 5.2 增加边界路径 spec scenario：`allowed-tools` 与 `metadata.denied-tools` 使用 space-separated tool-name string 并形成治理输入，授权由 capability governance 接受后生效。
- [x] 5.3 增加失败路径 spec scenario：非法 `context`、非法 `agent`、`agent` + `context:inline`、非 boolean `user-invocable`、非 boolean `model-invocable`、非法工具约束、不安全模型声明或冲突模型声明被 rejected。
- [x] 5.4 增加模型治理 scenario：顶层 `model`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 和兼容别名 `metadata.model` 作为 hint，最终模型、profile、provider option 或 runtime model configuration 由 governance 接受后生效。
- [x] 5.5 增加降级路径 spec scenario：未知 metadata 进入 `SkillMetadata.sourceMetadata` 或 degraded diagnostic 路径，治理决策消费 governed descriptor fields 和 typed `SkillMetadata`。
- [x] 5.5a Add markdown body boundary scenario: manifest validation emits frontmatter-derived descriptor input, typed `SkillMetadata`, validation outcome, and safe diagnostics; later Skill invocation/context changes own body loading semantics.
- [x] 5.5b Add typed metadata accessor scenario: `CapabilityDescriptor(kind=SKILL).metadata` validates as `SkillMetadata`; non-Skill descriptors return safe non-match results.
- [x] 5.5c Add descriptor mapping scenario: Skill `name` becomes `CapabilityDescriptor.capabilityId` / model-visible invocation name, `metadata.version` becomes `CapabilityDescriptor.version`, and provider-qualified identity remains outside the model-visible name.
- [x] 5.5d Add parser/mapper scenario: parser does not require full markdown body, and mapper returns a Skill `CapabilityDescriptor` from validated frontmatter facts plus `CapabilityProvider`.
- [x] 5.5e Add descriptor field rename scenario: Tool, Skill, and Agent descriptors expose safe model-visible text through `description`, and context/model disclosure no longer reads `safeDescription`.
- [x] 5.5f Add agent extension scenario: top-level `agent` validates as canonical `AgentId`, normalizes to `SkillMetadata.agent`, implies `context=fork` when context is omitted, and rejects when `context=inline`.
- [x] 5.5g Add diagnostic reason scenario: rejected/degraded manifests emit the stable public `SkillManifestDiagnostic.reasonCode` values defined by this change.
- [x] 5.6 运行 `openspec validate add-ts-skill-manifest-contract --strict`。

## 归档前基线提升检查（非实施任务）

- 同步 `openspec/specs/skill-manifest-contract/spec.md` 或等价长期 skill manifest 基线。
- 按需更新 capability governance、Agent package assembly 和 source discovery 相关长期设计索引。
- 检查长期文档没有重复定义 Skill manifest 字段、扩展含义或 validation outcome。
