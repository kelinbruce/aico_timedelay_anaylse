# 统一 SKILL.md 编码处理 — 设计

## 设计范围（Design Scope）

本 change 统一 `agent-capability` 中 discovery（`parseMetadataViewFromFile`）和 invocation（`loadCanonicalBodyViewFromFile`）两条路径的 `SKILL.md` 字节解码行为，并为 inline body 校验新增纵深防御的 `U+FFFD` 检查。它不改变 Skill Tool 接口、adapter 接口或受支持的编码集合（仅 UTF-8）。

## 目标与 Spec 基础（Goals and Spec Basis）

- `skill-tool` spec：discovery 和 invocation MUST 对 leading-frontmatter 检测、canonical body 切片和 source consistency token 使用相同的格式语义；canonical body view MUST 使用与 discovery 相同的格式语义排除 frontmatter；inline body 边界检查 MUST 覆盖预期文本编码。
- `skill-manifest-contract` spec：manifest reader 是可复用的 capability helper；`SkillManifestDiagnostic` reason code 是稳定的 public 集合。新增编码失败 reason code 沿用 `EXTENSION_OMITTED` 的先例（通过专门的 ADDED Requirement 加入）。

## 当前实现（Current Implementation）

- `readSkillFrontmatterSourceFromFile`（`packages/agent-capability/src/skills/skill-manifest.ts`）用 `fs.open()` + 1 字节 buffer + `TextDecoder`（默认 UTF-8）流式读取字节。它会自动剥离 UTF-8 BOM，在第二个 `---` 后停止，并限制在 64 KiB。它返回包含 `---` 分隔符的 frontmatter 块。
- `loadCanonicalBodyViewFromFile` 用 `readFile(file, "utf8")` 读取整个文件，把 UTF-8 BOM 保留为 `documentSource` 开头的 `﻿`。
- `extractLeadingFrontmatter` 和 `sliceCanonicalBody` 都检查 `lines[0] !== "---"`。BOM 会让 `lines[0]` 等于 `"﻿---"`，因此两者都返回 `undefined`，loader 以 `SKILL_MD_MISSING` 拒绝。
- `validateInlineBody`（`packages/agent-capability/src/builtins/skill-tool.ts`）检查空内容、大小、控制字符和宿主路径泄漏。它不检查 `U+FFFD`。
- 三个 Skill source（Builtin、Local、SkillHub）都在 discovery 时调用 `defaultSkillDocumentService.parseMetadataViewFromFile`、在 invocation 时调用 `loadCanonicalBodyViewFromFile`，因此三者都继承这两个方法实现的任何行为。

## GAP 分析（GAP Analysis）

1. **BOM 处理分歧。** Discovery 剥离 BOM；invocation 保留它。同一个文件可以成功注册但加载失败，产生误导性的 `SKILL_SOURCE_CHANGED`。
2. **没有编码校验。** `readFile("utf8")` 静默把非 UTF-8 字节变成 `U+FFFD`。frontmatter 若是 ASCII 仍可解析；body 把 `U+FFFD` 带进模型 hidden context 且没有任何错误。
3. **UTF-16 得到错误 reason code。** 默认 UTF-8 的 `TextDecoder` 把 UTF-16 字节搞乱，frontmatter 分隔符无法识别，文件被当作 `SKILL_MD_MISSING` 拒绝，尽管它存在。
4. **未检查 `U+FFFD`。** `validateInlineBody` 没有编码兜底，因此即使是非文件 body source 或 discovery 到 invocation 的竞态也可能注入乱码内容。
5. **没有专用编码 reason code。** `SkillManifestDiagnostic` reason code 集合没有编码失败的取值，因此它们被错误标记为 `SKILL_MD_MISSING`。

## 修改计划（Modification Plan）

### 共享 decode 原语

在 `skill-manifest.ts` 中新增私有 helper `decodeSkillDocumentBytes(bytes, provider, safeCandidateName)`，它：

- 调用 `packages/agent-capability/src/builtins/workspace-files/text-encoding.ts` 中既有的 public `decodeText(bytes)`。`decodeText` 嗅探 BOM（UTF-8 `EF BB BF`、UTF-16LE `FF FE`、UTF-16BE `FE FF`），剥离 UTF-8 BOM，尝试 fatal UTF-8，并回退到 GBK。它返回 `encoding ∈ {UTF8, UTF8_BOM, UTF16_LE, UTF16_BE, GBK}`，并在遇到 NUL 字节或 BOM 后跟该编码非法字节时抛出。
- 把整个 `decodeText` 调用包在 `try/catch` 中。任何抛出（NUL `safeFailure`、损坏 BOM payload 引起的 `TypeError`）都按 `SKILL_MD_UNSUPPORTED_ENCODING` 处理。
- 接受 `encoding === "UTF8" || encoding === "UTF8_BOM"` 并返回解码后的文本（BOM 已剥离）。
- 以 `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝其他所有编码（`UTF16_LE`、`UTF16_BE`、`GBK`）。

该 helper 返回 `SkillDocumentDecodeResult`——要么 `{ text }`，要么狭窄的 `{ outcome: "rejected", diagnostics }`——其 rejected 分支与 `SkillFrontmatterParseResult` 和 `SkillDescriptorMappingResult` 的 rejected 分支结构兼容，因此两个基于文件的 API 都可以直接返回它。

### 统一两个基于文件的 API

- `parseMetadataViewFromFile` 读取 `readFile(file)` 字节，经 `decodeSkillDocumentBytes` 解码，拒绝时直接返回 rejected 结果；否则把解码后的文本传给 `parseMetadataView`。
- `loadCanonicalBodyViewFromFile` 做同样处理，并把解码后的文本传给 `loadCanonicalBodyView`。

在此之后，带 UTF-8 BOM 的文件在两条路径上都解码为干净文本，`extractLeadingFrontmatter`/`sliceCanonicalBody` 看到 `"---"`，并且 `consistencyToken` 计算的 frontmatter hash 在两条路径上一致。

### 保留 `readSkillFrontmatterSourceFromFile`

这个 export 是一个架构边界标记（`tests/architecture/local-skill-source-boundary.test.ts` grep 该符号名）。它被内部重构为：通过 `readFile` 读取字节、经 `decodeSkillDocumentBytes` 解码、并通过新的 `sliceFrontmatterBlockWithDelimiters` helper 返回包含分隔符的 frontmatter 块。这里 MUST NOT 使用 `extractLeadingFrontmatter`，因为它会剥离 `---` 分隔符并破坏调用方。64 KiB 上限保留。遇到不支持的编码时 raw reader 抛出（它没有 provider/candidate 上下文来返回结构化 diagnostic）；需要结构化 diagnostic 的调用方使用 `parseMetadataViewFromFile`。

现在 discovery 会读取整个文件来校验编码（有界的头部切片无法发现非 UTF-8 body）。parser 仍只消费 frontmatter，满足 `skill-manifest-contract` 中 parser MUST NOT 要求完整 body 作为输入的 requirement。

### Inline body 兜底

`validateInlineBody` 新增的不是 `body.includes("﻿")` 检查——而是新增 `body.includes("�")`，命中时返回 `EXECUTION_FAILED` 和安全的边界校验消息。这是纵深防御：discovery 和 invocation 现在在上游拒绝非 UTF-8，但该检查为任何非文件 body source 或 discovery 与 invocation 之间编码变化的竞态提供保护。

### SkillHub adapter 健壮性

`SkillHubDiscovery.loadCanonicalBodyView`（`packages/agent-capability/src/skillhub/skillhub-source.ts`）把它的 `loadCanonicalBodyViewFromFile` 调用包在 `try/catch` 中并在抛出时返回 `undefined`，与 Local 和 Builtin adapter 一致。这是一个既有缺口（任何 `readFile` 失败都可能传播）；新的 decode 路径使其值得在同一 change 中修复。

### 契约

`packages/agent-contracts/src/capability/index.ts` 在 `SkillManifestDiagnosticReasonCode` TypeScript union 和 `SkillManifestDiagnosticSchema` Typebox `Type.Union` 字面量列表中都加入 `SKILL_MD_UNSUPPORTED_ENCODING`。

## 编码接受策略（Encoding Acceptance Policy）

| 编码 | 检测 | 结果 |
| --- | --- | --- |
| UTF-8（无 BOM） | fatal UTF-8 成功 | 接受 |
| 带 BOM 的 UTF-8 | `EF BB BF` 前缀，BOM 已剥离 | 接受 |
| UTF-16 LE | `FF FE` 前缀 | 拒绝 `SKILL_MD_UNSUPPORTED_ENCODING` |
| UTF-16 BE | `FE FF` 前缀 | 拒绝 `SKILL_MD_UNSUPPORTED_ENCODING` |
| GBK | fatal UTF-8 失败，GBK 回退成功 | 拒绝 `SKILL_MD_UNSUPPORTED_ENCODING` |
| 二进制 / NUL / 损坏 BOM | `decodeText` 抛出 | 拒绝 `SKILL_MD_UNSUPPORTED_ENCODING` |

`decodeText` 可以解码 GBK，但 Skill 路径有意拒绝它：接受策略是仅 UTF-8，因此开发者必须把不支持的文件重新保存为 UTF-8。这比 Read/Write/Edit tool（接受 GBK）更严格，但可预测，并符合 `skill-tool` spec 要求的 "expected text encoding" 检查。

## 竞态行为（Race Behavior）

如果一个文件在 discovery 时是有效 UTF-8，而在 invocation 前被重新保存为 GBK/UTF-16，invocation 解码会拒绝它，adapter 返回 `undefined`，Skill Tool 呈现 `SKILL_SOURCE_CHANGED`。这在语义上是正确的（source 确实变了），也是任何 discovery 到 invocation source 漂移的既有行为；本修复不改变它。

## 长期基线刷新计划（Long-Term Baseline Refresh Plan）

归档时：

- 把 `specs/skill-manifest-contract/spec.md` 中的两个 ADDED Requirement 提升进 `openspec/specs/skill-manifest-contract/spec.md`。
- 把 `specs/skill-tool/spec.md` 中的 ADDED Requirement 提升进 `openspec/specs/skill-tool/spec.md`。
- 更新 `openspec/specs/skill-manifest-contract/spec.md` 的 "Manifest Validation Outcome Is Explicit" reason code 列表以包含 `SKILL_MD_UNSUPPORTED_ENCODING`（或保留 `EXTENSION_OMITTED` 使用的专门 Requirement 模式）。
- `openspec/designs/spec-to-design-map.md` 已有 `skill-manifest-contract` 行；不需要导航变更。
- 验证：`openspec validate --all --strict`、`npm run build`、`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/`、`npm run lint:architecture`。
