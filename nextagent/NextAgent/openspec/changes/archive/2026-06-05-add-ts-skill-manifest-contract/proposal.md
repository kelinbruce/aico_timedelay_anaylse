## 背景与问题（Why）

Skill source、Agent package assembly 和 capability governance 都需要消费同一种 Skill manifest 事实。如果 manifest 字段、扩展命名空间和校验结果没有统一规格，不同 source 可能会用不同规则解释 `SKILL.md`，导致同一个 Skill 在 builtin、local、agent-scoped 或 SkillHub source 中出现不同 descriptor、availability 或安全约束。

本 change 定义 TS 目标态的 Skill manifest contract：所有 Skill source 都必须以标准 `SKILL.md` 为权威 manifest 输入，解析并映射为 governed Skill `CapabilityDescriptor` 和 typed `SkillMetadata`，再交给 capability governance 和 Agent assembly 消费。

## 变更范围（What Changes）

- 定义 Skill manifest 的权威输入、frontmatter 字段、正文边界、扩展命名空间和校验语义。
- 固化与 Agent Skills `SKILL.md` 兼容的字段口径，并限制 TS 首版支持的扩展字段。
- 定义 `SKILL.md` frontmatter 如何映射为 capability descriptor 输入和 `CapabilityDescriptor.metadata` 中的 typed `SkillMetadata`，并把 source discovery、catalog registration 和 invocation 交给对应后续 changes。
- 定义可复用 frontmatter parser 和 descriptor mapper 的最小输入输出契约。
- 将 `CapabilityDescriptor.safeDescription` 收敛为 `CapabilityDescriptor.description`，避免后续 Tool/Skill/Agent descriptor 继续扩散旧字段名。
- 明确跨模块暴露的 `SkillMetadata` 和 `SkillManifestDiagnostic` 归属 capability contract surface；`SkillFrontmatter`、parser validation intermediates 和 mapping 实现留在 `agent-capability`。
- 固定 `SkillManifestDiagnostic` 的稳定 public reason code 集，用于 manifest rejected/degraded 的 readiness、audit、structured log 和用户可见安全诊断。
- 定义非法、未知、缺失和不受支持字段的 safe validation outcome，避免 source 私自兜底或静默吞错。

## 当前核心实现策略（Strategy To Freeze）

本 change 固定以下黑盒策略，不对实现语言、类级结构或私有解析组件施加约束：

1. 每个 Skill 的权威 manifest 输入是该 Skill 根目录下的 `SKILL.md`。
2. Manifest parser 使用 implementation-owned `SkillFrontmatter` / validation intermediates 作为过程数据；跨 module boundary 暴露的是 Skill `CapabilityDescriptor`、typed `SkillMetadata` 和 safe diagnostics。
3. TS 首版支持 Agent Skills 官方 frontmatter 字段规则：required `name`、required `description`、optional `license`、optional string `compatibility`、optional string-to-string `metadata`、optional space-separated string `allowed-tools`。
4. TS 首版仅支持顶层 `context`、`agent`、`user-invocable`、`model-invocable`、`model` 扩展，通用 `metadata.version`，以及 `metadata.denied-tools`、`metadata.nextagent.model`、`metadata.nextagent.modelOptions` 三个受支持 metadata 扩展；`metadata.model` 作为兼容别名保留。
5. `allowed-tools` 表达允许工具集合，`metadata.denied-tools` 表达拒绝工具集合；两者使用 Agent Skills compatible space-separated tool-name string，并映射为 `SkillMetadata.allowedTools` / `SkillMetadata.deniedTools`，作为 capability governance 的 tool constraints。
6. Skill `name` maps to `CapabilityDescriptor.capabilityId` and the model-visible invocation name; `metadata.version` maps to `CapabilityDescriptor.version`; provider-qualified identity stays in `CapabilityDescriptor.provider` and catalog governance.
7. Top-level `agent` maps to `SkillMetadata.agent` after validating as the canonical `AgentId` used by Agent assembly; it is not a display name or versioned selector. When `agent` is present and `context` is omitted, normalized `context` becomes `fork`; `agent` with `context:inline` is rejected.
8. `CapabilityDescriptor.description` is the public model-visible safe description field; `safeDescription` is removed from the public descriptor contract.
9. The reusable parser consumes only the leading frontmatter block or an already extracted frontmatter source; the reusable mapper consumes validated frontmatter facts and a `CapabilityProvider` and returns a Skill `CapabilityDescriptor` with typed `SkillMetadata`.
10. manifest validation 必须产生明确 accepted/rejected/degraded 结果：safe unknown metadata retained is accepted; optional unsafe source metadata omitted is degraded; invalid official fields or governed extensions are rejected with `SkillManifestDiagnostic`.
11. Supported metadata extensions parse into typed metadata: `metadata.denied-tools` becomes `SkillMetadata.deniedTools`, supported top-level / metadata model declarations become non-authoritative `SkillMetadata.model` and optional `SkillMetadata.modelOptions`, and `model-invocable` becomes `SkillMetadata.modelInvocable`.
12. `SkillMetadata` uses one public shape across source, capability governance, Agent assembly, context disclosure, and later execution changes; `CapabilityDescriptor.metadata` is converted to `SkillMetadata` through a typed accessor/schema validation path.
13. Unknown metadata and markdown body content have explicit ownership paths: safe string unknown metadata may be preserved as `sourceMetadata`, unsafe source metadata becomes a degraded diagnostic, and later Skill invocation/context changes own body loading.

## 需要群内确认的契约变更（Contract Refinement）

本 change 修改已冻结的 `agent-contracts/capability` public surface，实施前需要群内确认以下唯一范围：

- `CapabilityDescriptor.safeDescription` refinement 为 `CapabilityDescriptor.description`，并同步 Tool、Skill、Agent descriptor 的模型可见安全描述字段。
- 新增 `SkillMetadata` public schema/type，作为 Skill `CapabilityDescriptor.metadata` 的 typed metadata contract。
- 新增 `SkillManifestDiagnostic` public schema/type 和稳定 reason code 集，作为 manifest validation 的安全诊断 contract。

Parser-only `SkillFrontmatter`、validation intermediates、source scan state、body loading、catalog registration、invocation lifecycle 和 provider-private configuration 不进入 `agent-contracts`。

## 影响范围（Impact）

- Skill source changes：统一使用 `SKILL.md` parser/mapping 产出 Skill descriptor input 和 typed `SkillMetadata`。
- Capability governance：消费 manifest-derived Skill descriptor input、typed metadata、tool constraints 和 availability 输入。
- Agent package assembly：只消费受治理 Skill source 输出，不重新解析 manifest。
- Context assembly：可消费已治理 Skill descriptor 的 validated description 和 safe diagnostics；raw manifest 内容由 source/invocation owner 管理。
- `agent-contracts/capability`：承载 `CapabilityDescriptor.description` refinement、跨模块可见的 `SkillMetadata` 和 `SkillManifestDiagnostic` schema/type；parser 实现、source scan、diagnostic production 和 invocation 行为由对应 owner 管理。

## 相邻能力归属（Adjacent Ownership）

- Skill 的执行方式、工具调用过程、fork/inline runtime 语义和 sandbox 行为归 execution/sandbox changes。
- builtin/local/agent-scoped/SkillHub source 的 discovery 流程归 source discovery changes。
- SkillHub 远端协议、安装流程和 checksum/trust 规则归 SkillHub source changes。
- prompt template、model profile 和 Agent routing 继续由对应 context/model/core changes 管理。
