# local-skill-source Specification Delta

## ADDED Requirements

### Requirement: 调用时正文篡改校验 fail-closed

本地 Skill 调用时正文加载（`LocalSkillDiscovery.loadCanonicalBodyView`）MUST 在既有 `frontmatterHash` 与 `skillVersion` 校验之后追加 `documentHash` 比对：将 agent 目录加载的 `SKILL.md` 完整文档哈希与可信 Skill Hub cache 副本（由 Skill Hub 同步链路写入）的完整文档哈希比对。两者不一致时系统 MUST fail-closed——正文加载返回不可用结果，Skill Tool 按既有 source-changed 失败路径处理，MUST NOT 把被篡改正文注入模型上下文。

可信基准副本 MUST 只来自 Skill Hub 同步链路写入的可信 cache 目录，MUST NOT 来自客户端请求、模型输出、capability 参数或 Skill manifest metadata。基准不可得时（部署环境未提供共享目录、副本文件不存在、读取或解码失败）系统 MUST 跳过该比对并保持既有加载行为，MUST NOT 因缺少基准而拒绝加载。

篡改校验失败 MUST 记录低基数安全诊断（`LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH`），诊断 MUST NOT 泄露 raw 路径、manifest 内容或 Skill 正文。本校验 MUST NOT 改变 discovery 阶段输出——篡改只影响 invocation 时正文加载，不影响候选可见性。

#### Scenario: body 被篡改且可信基准存在时 fail-closed

- **WHEN** agent 目录下某 Skill 的 `SKILL.md` body 被修改而 frontmatter 与 version 不变
- **AND** 可信 cache 副本仍为正版内容
- **THEN** 调用时正文加载 MUST 返回不可用结果
- **AND** Skill Tool MUST 按既有 source-changed 失败路径返回非成功状态
- **AND** 被篡改正文 MUST NOT 进入模型上下文

#### Scenario: 正版 Skill 与可信基准一致时正常加载

- **WHEN** agent 目录下 `SKILL.md` 与可信 cache 副本内容一致
- **THEN** 调用时正文加载 MUST 正常返回正文
- **AND** 既有 `frontmatterHash` 与 `skillVersion` 校验行为 MUST 保持不变

#### Scenario: 无可信基准时跳过校验不误拦

- **WHEN** 某 Skill 不存在可信 cache 副本（如 runtime-generated 或非 Skill Hub 同步来源）
- **THEN** 系统 MUST 跳过 `documentHash` 比对
- **AND** 正文加载 MUST 按既有校验行为正常执行
- **AND** 系统 MUST NOT 因缺少基准而拒绝该 Skill

#### Scenario: 篡改失败诊断不泄露敏感事实

- **WHEN** `documentHash` 比对失败触发 fail-closed
- **THEN** 系统必须记录 `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH` 安全诊断
- **AND** 诊断不得包含 raw 路径、manifest 内容或 Skill 正文
- **AND** 诊断必须能关联 provider identity 与 Skill identity

#### Scenario: agent 目录与基准被一致篡改时不可检出

- **WHEN** agent 目录 `SKILL.md` 与可信 cache 副本被一致地同时篡改
- **THEN** `documentHash` 比对通过，系统 MUST 保持既有加载行为
- **AND** 该同源攻击场景由上游信任链负责，MUST NOT 由本校验承担
