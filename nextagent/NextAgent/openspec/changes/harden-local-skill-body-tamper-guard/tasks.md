## 1. 需求 1：一致性校验令牌携带完整文档哈希

- [x] 1.1 修改 `consistencyToken`（`packages/agent-capability/src/skills/skill-manifest.ts`）：新增 `documentHash`（完整文档 UTF-8 sha256），同步更新 `SkillDocumentConsistency`、`SkillDocumentLoadView`（required）与 `SkillCanonicalBodyView`（optional）类型。
  来源：`skill-manifest-contract` 的 "一致性校验令牌携带完整文档哈希"
  验证：`npm run typecheck` 通过；`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts packages/agent-capability/tests/skill-manifest-encoding.test.ts --maxWorkers=2` 全部通过。

## 2. 需求 2：调用时正文篡改校验 fail-closed

- [x] 2.1 修改 `LocalSkillDiscovery.loadCanonicalBodyView`（`packages/agent-capability/src/local/skill-discovery.ts`）：在 `skillVersion` 校验之后追加 `documentHash` 比对，失败时记录 `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH` 并返回 `undefined`；返回值带上 `documentHash`。
  来源：`local-skill-source` 的 "调用时正文篡改校验 fail-closed" 的 "body 被篡改且可信基准存在时 fail-closed" scenario
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/local-skill-source.test.ts --maxWorkers=2` 通过。

- [x] 2.2 新增 `readTrustedDocumentHash` 私有方法：从 `_APP_SHARE_DIR/cache/skillhub/<skill>/SKILL.md` 读取可信副本，经共享 `decodeText` 解码后计算 sha256；环境变量缺失、文件不存在、读取或解码失败时返回 `undefined`（跳过校验）。
  来源：同上 "无可信基准时跳过校验不误拦" scenario
  验证：同 2.1（测试覆盖 cache 副本删除后正常加载）。

- [x] 2.3 在 `logBodyLoadFailure` 的 payload 类型联合中新增 `LOCAL_SKILL_BODY_DOCUMENT_HASH_MISMATCH` 原因码，复用既有安全日志路径（不含 raw 路径）。
  来源：同上 "篡改失败诊断不泄露敏感事实" scenario
  验证：同 2.1（测试断言日志条目字段且 `JSON.stringify(logs.entries)` 不含 root 路径）。

- [x] 2.4 新增回归测试（`packages/agent-capability/tests/local-skill-source.test.ts` "fails closed on body-only tampering when a trusted Skill Hub cache baseline exists"）：篡改被拦、正版一致正常加载、删除 cache 副本后跳过校验三个断言路径。
  来源：`local-skill-source` delta 的前三个 scenario
  验证：同 2.1。

## 3. 明确不改动项

- [x] 3.1 `builtins/skill-tool.ts` 的 `matchesDescriptor` 维持三段比对不动：local descriptor 运行时不携带 `consistency` 字段，追加哈希比对会误拦全部正版 local Skill；fail-closed 已由 `loadCanonicalBodyView` 返回 `undefined` 实现。
  来源：proposal "不在范围内"
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-capability/tests/builtin-skill-source.test.ts --maxWorkers=2` 全部通过。

## 4. Change 整体验证

- [x] 4.1 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests --maxWorkers=2`：779 通过，17 个失败均为 `origin/main` 干净基线上已存在的环境相关失败（write/grep 路径权限、skillhub governance 等），与本次改动无关（基线同样为 17 失败）。
- [x] 4.2 `npm run typecheck` 通过；改动文件 eslint 与 prettier 检查通过。
- [x] 4.3 `openspec validate --all --strict` 通过。
- [x] 4.4 生产验证：服务器 60.14.50.241（`aicoservice`，27.60.376）实测，agent 目录 body 篡改后调用被拦下，正版调用不受影响。
