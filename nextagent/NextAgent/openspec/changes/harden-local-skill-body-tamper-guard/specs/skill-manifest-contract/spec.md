# skill-manifest-contract Specification Delta

## ADDED Requirements

### Requirement: 一致性校验令牌携带完整文档哈希

`consistencyToken` MUST 在 `frontmatterHash`（frontmatter 块 sha256）之外同时携带 `documentHash`——对完整 `SKILL.md` 文档（frontmatter + body）以 UTF-8 编码计算的 sha256 摘要。两个哈希 MUST 基于同一份已解码文档文本计算。

`documentHash` MUST 由加载路径对实际读取的文档实时计算，MUST NOT 来自 frontmatter 声明、manifest metadata 或任何外部输入。`SkillDocumentLoadView` MUST 携带 required `documentHash`；无法为完整文档担保的 source（如非文件系统加载）MAY 在 `SkillCanonicalBodyView` 上省略该字段。

`documentHash` 与 `frontmatterHash` 一致存在于令牌内，供调用时一致性校验检测 body-only 篡改；discovery 阶段 MUST NOT 因 `documentHash` 的存在改变候选输出。

**需求类别**：功能性需求

#### Scenario: 令牌同时包含两个哈希

- **WHEN** 任一文件加载路径对有效 `SKILL.md` 计算 `consistencyToken`
- **THEN** 令牌 MUST 包含基于 frontmatter 块的 `frontmatterHash`
- **AND** 令牌 MUST 包含基于完整文档的 `documentHash`
- **AND** 两个哈希 MUST 由同一份解码后文档文本计算

#### Scenario: body 变化改变 documentHash 但不影响 frontmatterHash

- **WHEN** 同一 `SKILL.md` 的 body 被修改而 frontmatter 块保持不变
- **THEN** 重算的 `documentHash` MUST 与修改前不同
- **AND** 重算的 `frontmatterHash` MUST 与修改前相同

#### Scenario: documentHash 不来自 frontmatter 声明

- **WHEN** frontmatter 或 metadata 中出现自称文档哈希的字段
- **THEN** 加载路径 MUST 忽略该声明并以实时计算值为准
- **AND** discovery 输出 MUST NOT 因此改变
