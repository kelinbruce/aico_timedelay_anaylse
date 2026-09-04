# 任务

- [x] 1. 在 `packages/agent-contracts/src/capability/index.ts` 的 `SkillManifestDiagnosticReasonCode` TypeScript union 和 `SkillManifestDiagnosticSchema` Typebox 字面量 union 中新增 `SKILL_MD_UNSUPPORTED_ENCODING`。
  验证：`npm run typecheck`
  来源：spec `Skill Manifest Diagnostic Includes Unsupported Encoding Reason Code`

- [x] 2. 在 `packages/agent-capability/src/skills/skill-manifest.ts` 中新增共享 `decodeSkillDocumentBytes` helper，通过既有 public `decodeText` 解码字节，接受 UTF-8 和带 BOM 的 UTF-8（BOM 剥离），并以 `SKILL_MD_UNSUPPORTED_ENCODING` 拒绝其他所有编码（以及任何 `decodeText` 抛出）。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest-encoding.test.ts --maxWorkers=1`
  来源：spec `Skill Manifest Reader Validates Text Encoding Through Shared Decode`

- [x] 3. 让 `parseMetadataViewFromFile` 和 `loadCanonicalBodyViewFromFile` 经过 `decodeSkillDocumentBytes`，使 discovery 和 invocation 共享相同的 decode 语义和 frontmatter consistency token。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest-encoding.test.ts --maxWorkers=1`
  来源：spec `Skill Manifest Reader Validates Text Encoding Through Shared Decode`

- [x] 4. 重构 `readSkillFrontmatterSourceFromFile`，经 `decodeSkillDocumentBytes` 解码并通过 `sliceFrontmatterBlockWithDelimiters` 返回带分隔符的 frontmatter 块，保留 public export 名称、返回形状和 64 KiB 上限。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/builtin-skill-source.test.ts --maxWorkers=1`
  来源：design `Preserve readSkillFrontmatterSourceFromFile`

- [x] 5. 在 `packages/agent-capability/src/builtins/skill-tool.ts` 的 `validateInlineBody` 中新增 `U+FFFD` 检测，返回 `category` 为 `VALIDATION` 的 `EXECUTION_FAILED`。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts --maxWorkers=1`
  来源：spec `Skill Inline Body Rejects Replacement Character`

- [x] 6. 用 `try/catch` 包裹 `SkillHubDiscovery.loadCanonicalBodyView`（`packages/agent-capability/src/skillhub/skillhub-source.ts`）中的 `loadCanonicalBodyViewFromFile` 调用，抛出时返回 `undefined`，与 Local 和 Builtin adapter 一致。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts --maxWorkers=1`
  来源：design `SkillHub adapter robustness`

- [x] 7. 新增编码 fixture 测试，覆盖 UTF-8（无 BOM）、带 BOM 的 UTF-8（接受、BOM 剥离、hash 一致）、ASCII frontmatter + GBK body 的 GBK（拒绝）、纯中文 GBK（拒绝）、UTF-16 BE（拒绝）和 UTF-16 LE（拒绝），外加 catalog 不注册测试和 inline body `U+FFFD` 拒绝测试。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest-encoding.test.ts packages/agent-capability/tests/skill-tool.test.ts --maxWorkers=1`
  来源：spec `Skill Manifest Reader Validates Text Encoding Through Shared Decode`、`Skill Inline Body Rejects Replacement Character`

- [x] 8. 验证固定 `readSkillFrontmatterSourceFromFile` 为边界标记的架构边界测试仍然通过。
  验证：`npx vitest run --config vitest.config.architecture.ts tests/architecture/local-skill-source-boundary.test.ts --maxWorkers=1`
  来源：design `Preserve readSkillFrontmatterSourceFromFile`

- [x] 9. Negative 验证：UTF-16 或 GBK 的 `SKILL.md` MUST 在 discovery 和 invocation 两条路径上都以 `SKILL_MD_UNSUPPORTED_ENCODING` 被拒绝，MUST NOT 进入 catalog 或注入乱码 body 内容。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest-encoding.test.ts --maxWorkers=1`
  来源：spec `Skill Manifest Reader Validates Text Encoding Through Shared Decode`
