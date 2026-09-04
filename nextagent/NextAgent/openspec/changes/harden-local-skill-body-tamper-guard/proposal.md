## 背景与问题（Why）

本地 Skill 调用路径（`LocalSkillDiscovery.loadCanonicalBodyView`）在 invocation 时对 agent 目录 `SKILL.md` 执行两道一致性校验：`frontmatterHash`（frontmatter 块 sha256）和 `skillVersion`。攻击者若只篡改 markdown 正文（body）而保持 frontmatter 与 version 不变，两道校验全部通过，被篡改的正文会被原样注入模型上下文。

生产环境（服务器 60.14.50.241，`aicoservice`）已实测确认该路径可被利用。Skill Hub 同步链路在 cache 目录（`_APP_SHARE_DIR/cache/skillhub/<skill>/SKILL.md`）保留了可信副本，可作为调用时比对基准，但当前调用路径未消费该基准。

## 变更范围（What Changes）

- **新增** 完整文档哈希校验令牌：`skill-manifest-contract` 的一致性校验令牌（`consistencyToken`）在 `frontmatterHash` 之外 MUST 携带 `documentHash`（frontmatter + body 完整文档的 sha256）。
- **新增** 本地 Skill 调用时正文篡改校验：`LocalSkillDiscovery.loadCanonicalBodyView` 在既有 `frontmatterHash`/`skillVersion` 校验之后 MUST 追加第三道 `documentHash` 比对——将 agent 目录加载文件的完整文档哈希与可信 Skill Hub cache 副本的哈希比对；不一致时 fail-closed（返回 `undefined`，Skill Tool 走既有 `SKILL_SOURCE_CHANGED` 失败路径），不注入被篡改正文。
- **新增** 安全失败诊断：校验失败时记录 `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH` 低基数安全日志，不泄露 raw 路径或正文内容。

## 不在范围内（Explicit Non-Goals）

- 不修改 `builtins/skill-tool.ts` 的 `matchesDescriptor` 三段比对（providerId/capabilityId/skillVersion）：local descriptor 运行时不携带 `consistency` 字段，追加 documentHash 比对会让所有正版 local Skill 调用误判失败；fail-closed 已由 `loadCanonicalBodyView` 返回 `undefined` 实现。
- 不修改 SkillHub acquired provider（`skillhub-source.ts`）、builtin Skill source 的加载路径。
- 不修改 Skill Hub 同步链路本身（cache 副本如何写入）。
- 不解决 agent 目录与 cache 副本被一致地同时篡改的同源攻击（需要上游 packageHash 信任链，超出本 change）。
- 不新增 Web API、stream event、runtime command 或 capability contract 字段。
- 不改变 discovery 阶段行为：`documentHash` 校验只发生在 invocation 时正文加载路径。

## Capability 影响（Capabilities）

### 修改 Capability

- `skill-manifest-contract`：一致性校验令牌新增 `documentHash` 字段（完整文档 sha256）。
- `local-skill-source`：调用时正文加载新增可信基准比对与 fail-closed 行为。

## 影响范围（Impact）

- 代码：`packages/agent-capability/src/skills/skill-manifest.ts`（consistencyToken）、`packages/agent-capability/src/local/skill-discovery.ts`（第三道校验、`readTrustedDocumentHash`）。
- 配置：读取部署环境注入的 `_APP_SHARE_DIR` 环境变量定位可信 cache 基准；该变量缺失或 cache 副本不存在时跳过该校验（回退原行为，不误拦 runtime-generated 等无基准 Skill）。
- 测试：`packages/agent-capability/tests/local-skill-source.test.ts` 新增回归测试（篡改被拦、正版通过、无基准跳过）。
- 安全：body-only 篡改从"原样注入"变为"fail-closed 拒绝注入"；安全边界收窄，无新增泄露面。
