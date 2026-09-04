# 统一 discovery 与 invocation 之间的 SKILL.md 编码处理

## 背景（Background）

`SKILL.md` 通过两条不同的文件读取路径读取，编码和 BOM 处理不一致：

- **Discovery**（`parseMetadataViewFromFile` → `readSkillFrontmatterSourceFromFile`）通过 `TextDecoder` 流式读取字节，它会自动剥离 UTF-8 BOM 并在 frontmatter 后停止。
- **Invocation**（`loadCanonicalBodyViewFromFile`）用 `readFile(file, "utf8")` 读取整个文件，把 UTF-8 BOM 保留为开头的 `﻿`。

这种分裂产生三种静默或误导性失败模式：

1. **UTF-8 BOM 文件在 invocation 失败。** Discovery 成功（BOM 被剥离），但 invocation 的 frontmatter 边界检查看到 `"﻿---"` 而不是 `"---"`，以 `SKILL_MD_MISSING` 拒绝，adapter 把它桥接为 `undefined`。Skill Tool 随后呈现误导性的 `SKILL_SOURCE_CHANGED`（"Requested Skill source changed after governance"），尽管 source 从未变化。
2. **非 UTF-8 body 注入替换字符。** GBK 或 Latin-1 body 被 `readFile("utf8")` 解码成 `U+FFFD`；`validateInlineBody` 不检查 `U+FFFD`，因此乱码 body 内容通过 `<skill_content>` 信封注入模型 hidden context。模型无法读取指令、猜测动作，并且 request 在没有任何错误的情况下完成。
3. **UTF-16 文件得到错误 reason code。** Discovery 的默认 UTF-8 `TextDecoder` 把 UTF-16 字节搞乱，frontmatter 分隔符无法识别，文件被当作 `SKILL_MD_MISSING`（"SKILL.md is missing"）拒绝，尽管文件存在且可读。

这些违反 `skill-tool` spec 的 requirement：discovery 和 invocation MUST 对 leading-frontmatter 检测、canonical body 切片和 source consistency token 使用相同格式语义，并且 inline body 边界检查 MUST 覆盖预期文本编码。

## 目标（Goals）

- 把 discovery 读取路径和 invocation 读取路径都路由到单个共享的 BOM 感知 decode 原语，使两条路径应用相同的 BOM 剥离、编码检测和 frontmatter 边界语义。
- 接受带或不带 BOM 的 UTF-8（BOM 剥离）。以新的专用 reason code `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝 UTF-16 LE/BE、GBK 以及任何无法解码为 UTF-8 的编码（包括二进制内容）。
- 为 inline body 校验新增 `U+FFFD` 检测，作为针对非文件 body source 或 discovery 与 invocation 之间编码变化竞态的纵深防御编码兜底。
- 保留既有 `readSkillFrontmatterSourceFromFile` public export 及其"带分隔符的 frontmatter 块"返回形状，因为它是架构边界标记。
- 保持 Skill Tool / adapter 接口不变：编码失败在 discovery 被拒绝（绝不进入 catalog），或在 discovery 到 invocation 竞态中以既有 `SKILL_SOURCE_CHANGED` 呈现。

## 非目标（Non-Goals）

- 不新增 GBK、UTF-16、Latin-1 或任何非 UTF-8 编码的读取支持。接受策略是仅 UTF-8（BOM 可选）；开发者必须把不支持的文件重新保存为 UTF-8。
- 不改变 `SkillSourceDiscovery.loadCanonicalBodyView` adapter 接口形状，也不通过它携带 reason code。
- 不合并三个重复的 `isCanonicalBodyView` guard，也不改变它们的形状。
- 不改变 Skill Tool 输入校验、Skill 参数语义或安全确认面。
- 不在既有安全 diagnostic 形状之外向模型、Web API、stream、timeline、audit 或 SafeError 暴露编码细节。

## Function 影响（Function Impact）

- **Function**：Skill manifest contract（`skill-manifest-contract`）和 Skill Tool（`skill-tool`）。
- **Function 变更类型**：修改。
- **主要规格**：`openspec/specs/skill-manifest-contract/spec.md`、`openspec/specs/skill-tool/spec.md`。
- **边界**：Skill manifest reader 在 discovery 和 invocation 两条路径上通过共享的 BOM 感知 decode helper 解码 `SKILL.md` 字节；接受 UTF-8（BOM 可选），其他编码以 `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝；inline body 校验拒绝 `U+FFFD`。
- **系统质量**：正确性和可诊断性提升（BOM 文件可加载、编码失败获得准确 reason code、乱码 body 不被注入）；安全性和数据最小化保持不变 — 新的 diagnostic 不携带 raw 字节内容。
- **验证**：聚焦的编码 fixture 测试验证 UTF-8 BOM 接受、带正确 reason code 的 UTF-16/GBK 拒绝、discovery/invocation frontmatter hash 一致性、inline body `U+FFFD` 拒绝，以及不支持编码 skill 不进入 catalog 注册。
