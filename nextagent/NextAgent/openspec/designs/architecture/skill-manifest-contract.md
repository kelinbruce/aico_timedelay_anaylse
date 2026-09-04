# Skill Manifest Contract

本设计承载 Skill manifest 的长期跨模块设计事实。行为性验收要求由 `openspec/specs/skill-manifest-contract/spec.md` 承载；本文件只记录 owner、边界和长期取舍。

## Authority

每个 Skill 的权威 manifest 输入是该 Skill 根目录下的 `SKILL.md`。builtin、system local、Agent-owned local、agent-scoped 和 SkillHub source 发现 Skill candidate 后，必须复用同一 manifest parser 和 descriptor mapper，不得为不同 source 定义平行 manifest DTO、字段解释、工具约束规则、模型 hint 规则或诊断 reason code。

`SKILL.md` markdown body 是 authoring content。manifest validation 只从 leading frontmatter block 或 already extracted frontmatter source 产生 descriptor input、typed metadata、validation outcome 和 safe diagnostics；body loading、body-to-context injection、inline/fork execution 和 sandbox 行为由后续 execution/context changes 负责。

`SKILL.md` 字节解码在 discovery（`parseMetadataViewFromFile`）和 invocation（`loadCanonicalBodyViewFromFile`）两路径共用同一 BOM 感知 decode 助手。接受策略为 UTF-8 only：UTF-8（无 BOM）和 UTF-8 with BOM（BOM 剥离后解析）接受；UTF-16 LE/BE、GBK 和任何无法作为 UTF-8 解码的编码（含二进制 NUL）以 `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝，severity `ERROR`、outcome `rejected`，不误标为 `SKILL_MD_MISSING`。诊断不得暴露 raw byte content、byte prefix、检测到的编码名或文件内容。reader MAY 读取完整文件以校验编码（有限前缀切片无法暴露非 UTF-8 body），但 parser 仍只消费 leading frontmatter block，不要求完整 body 作为输入。两路径对同一文件计算的 frontmatter 一致性 token 必须相等。`readSkillFrontmatterSourceFromFile` 公共导出作为架构边界标记保留，内部经同一 decode 助手返回含 `---` delimiters 的 frontmatter block，保持 64 KiB 上限。

## Ownership

跨模块 public contract 归 `agent-contracts/capability`：

- `CapabilityDescriptor.description` 是 Tool、Skill、Agent descriptor 的模型可见安全描述字段；`safeDescription` 不再是 public descriptor field。
- `SkillMetadata` 是 Skill `CapabilityDescriptor.metadata` 的 typed public metadata contract。
- `SkillManifestDiagnostic` 是 manifest validation 的 safe public diagnostic contract。

实现归 `agent-capability`：

- parser 使用 implementation-owned `SkillFrontmatter` 和 validation intermediates 作为过程数据；
- reusable parser 只消费 leading frontmatter block 或 extracted frontmatter source，以及 source 可提供的 safe candidate name；
- reusable mapper 消费 validated frontmatter facts 和 `CapabilityProvider`，生成 Skill `CapabilityDescriptor`、typed `SkillMetadata`、validation outcome 和 diagnostics；
- typed accessor/validator 将 `CapabilityDescriptor(kind=SKILL).metadata` 转为 `SkillMetadata`，非 Skill descriptor 返回 safe non-match。

`SkillFrontmatter`、filesystem input、source scan state、source-private loading key、raw manifest、raw body、provider-private configuration、catalog registration 和 invocation lifecycle 不进入 `agent-contracts`。

## Field Policy

TS 首版兼容 Agent Skills `SKILL.md` official shape：required `name`、required `description`、optional `license`、optional string `compatibility`、optional string `metadata` values、optional space-separated string `allowed-tools`。`description` 可使用普通 scalar 或 YAML literal/folded block scalar 表达，但 parser 输出和 descriptor 仍是经过长度约束的安全字符串。

支持的 NextAgent 扩展固定为：

- top-level `context`：`inline` 或 `fork`，缺省 `inline`；
- top-level `agent`：canonical `AgentId` fork selection hint，缺省 `context` 时归一为 `fork`，与 explicit `context:inline` 冲突时 rejected；
- top-level `user-invocable`：boolean，缺省 `false`；
- top-level `model-invocable`：boolean，缺省 `true`；
- top-level `model`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 和 compatibility alias `metadata.model`：非权威 model hints；
- `metadata.version`：映射为 `CapabilityDescriptor.version`；
- `allowed-tools` 和 `metadata.denied-tools`：映射为 `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools`，只作为 capability governance 输入。

受治理的 source metadata 数组 key 固定为 `exclusiveWith`、`compatibleWith` 和 `tags`。这些 key 可使用 YAML block list 或 inline list，数组必须非空且元素必须是安全非空字符串。它们只保存在 `SkillMetadata.sourceMetadata`，不新增互斥、兼容性过滤、标签检索、routing、availability 或 Agent assembly 治理语义。其他 metadata key 仍只接受 string value；数组或对象形态必须 fail closed。

Skill `name` 映射为 `CapabilityDescriptor.capabilityId` 和模型可见 invocation name；provider-qualified identity 保留在 `CapabilityDescriptor.provider`、Agent binding、catalog governance 和 diagnostics，不替代模型可见 Skill name。

Official `license` 和 `compatibility` 在本 contract 中只是 descriptive source metadata，不映射为 `CapabilityDescriptor.compatibility`，除非后续 capability governance change 定义 typed compatibility mapping。

## Validation Outcome

manifest validation outcome 只有三类：

- `accepted`：required official fields 和 supported extensions 全部有效；safe unknown metadata 可作为 `SkillMetadata.sourceMetadata` 保留。
- `degraded`：descriptor 和 typed metadata 仍有效，仅 optional source metadata 因不安全、过大或不可保留被省略，并产生 safe diagnostic。
- `rejected`：缺失或非法 required fields、official shape、supported extension、tool constraint、model declaration、agent/context 组合，或无法生成 descriptor input。

Public diagnostics 只输出 stable `SkillManifestDiagnostic.reasonCode`、severity、outcome、sanitized message、optional safe `providerId` 和 optional safe `skillName`。不得包含 raw manifest content、raw body、raw path、endpoint、credential、provider response、user input、model input/output 或 unsafe metadata。

Public reason code 集固定为：

- `SKILL_MD_MISSING`
- `INVALID_NAME`
- `NAME_MISMATCH`
- `INVALID_DESCRIPTION`
- `INVALID_OFFICIAL_FIELD`
- `INVALID_CONTEXT`
- `INVALID_AGENT`
- `AGENT_REQUIRES_FORK_CONTEXT`
- `INVALID_INVOCABILITY`
- `INVALID_TOOL_CONSTRAINTS`
- `UNSAFE_MODEL_DECLARATION`
- `CONFLICTING_MODEL_DECLARATION`
- `SOURCE_METADATA_OMITTED`
- `DESCRIPTOR_MAPPING_FAILED`
- `SKILL_MD_UNSUPPORTED_ENCODING`

## Downstream Boundaries

Capability governance、Agent assembly、context disclosure 和后续 execution changes 只能消费 governed descriptor fields、typed `SkillMetadata`、safe diagnostics，以及 catalog/assembly 自身治理事实。它们不得重新解析 raw `SKILL.md`，不得从 unknown source metadata 或 source metadata arrays 推导权限、routing、model selection、prompt shaping、sandbox、owner scope、compatibility filtering、conflict exclusion、tag filtering 或 availability。

最终可见性、binding、availability、conflict resolution、tool authorization、owner scope、Agent scope、model/profile governance 和 invocation authorization 仍由 capability governance、Agent assembly、context/model governance、runtime/core 和后续 execution changes 决定；manifest 字段只是受治理输入，不直接授权执行。

System local Skill source 和 Agent-owned local Skill source 只负责提供 `SKILL.md` candidate 输入和 source-owned loading facts。它们不得改变 manifest contract，也不得把 raw local path、Agent package internal layout、full Skill body、loading key 或 content loading authority 放入 descriptor、metadata、diagnostic、model context、stream、安全错误或 Web/API response。

## Deferred Scope

本设计不实现 SkillHub protocol、inline/fork runtime、Skill body loading、Skill invocation lifecycle、sandbox execution、routing policy、remote cache/refresh 或 provider-specific configuration。Builtin 和 local Skill source discovery 已作为 manifest contract 的消费方存在；后续 source 或 execution change 仍必须复用本 manifest contract 和 `agent-contracts/capability` public metadata/diagnostic surface。
