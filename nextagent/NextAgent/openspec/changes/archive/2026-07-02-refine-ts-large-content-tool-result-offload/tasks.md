## 1. 阈值常量与轻量 policy 类型

- [ ] 1.1 修改 `packages/agent-context-engine/src/large-content/thresholds.ts`：`LARGE_CONTENT_THRESHOLDS` 默认值改为 `inlineMaxBytes: 50000`、`aggregateMaxBytes: 200000`、`previewMaxChars: 2048`；新增轻量数据类型 `LargeContentPolicy = { inlineMaxBytes; aggregateMaxChars; previewMaxChars; infinity }` 与 `DEFAULT_LARGE_CONTENT_POLICY`（`infinity=false`、阈值取自常量）；更新文件顶部注释。
  验证：新增 `thresholds.test.ts` 断言三个常量值与 `DEFAULT_LARGE_CONTENT_POLICY` 字段。
  来源：spec §"Large-content thresholds and configuration are fixed" 默认值；design 决策 1。

- [ ] 1.2 在 `packages/agent-context-engine/src/large-content/index.ts` 导出 `LargeContentPolicy` 与 `DEFAULT_LARGE_CONTENT_POLICY`。
  验证：`npx tsc -p packages/agent-context-engine/tsconfig.json --noEmit`。
  来源：design 决策 1。

## 2. classifier policy 入参

- [ ] 2.1 修改 `classifier.ts`：`classifyReplacement` 增加可选 `policy: LargeContentPolicy` 参数（默认 `DEFAULT_LARGE_CONTENT_POLICY`）；`policy.infinity === true` 时返回 INLINE；size 判定用 `policy.inlineMaxBytes`。图片/二进制分流保持基线（`isBinaryContentType` 仍读 `image/*` → `SPECIALIZED_REF`）。
  验证：`classifier.test.ts`：`image/*` → SPECIALIZED_REF；50000 INLINE / 50001 PERSISTED_PREVIEW；`infinity=true` 超阈值仍 INLINE。
  来源：spec §"Large-content thresholds and configuration are fixed" Infinity Scenario；design 决策 2。

## 3. aggregate-offloader largest-first 与冻结复用

- [ ] 3.1 修改 `aggregate-offloader.ts`：`planAggregateOffload` 增加可选 `policy: LargeContentPolicy` 参数；用 `policy.aggregateMaxChars` 取代直读 `aggregateMaxBytes`；聚合 largest-first 始终启用（无开关）；`previouslyFrozen` entry 固定 frozen 形态（`reason=frozen-from-prior-decision`），不重复外置。**不新增字段**。
  验证：`aggregate-offloader.test.ts`：`previouslyFrozen` entry 原样保留；200001 chars → 从最大块依次外置至 ≤200000。
  来源：spec §"Large-content thresholds and configuration are fixed" aggregate Scenario 与冻结 Scenario；design 决策 3。

- [ ] 3.2 negative verification：断言 `previouslyFrozen` entry 的 `shouldOffload` 与首次决策一致、`reason=frozen-from-prior-decision`。
  验证：`aggregate-offloader.test.ts` 断言该失败路径用例。
  来源：spec 冻结 Scenario；design 决策 3。

## 4. externalizer 接线：infinityToolNames 与 effective policy

- [ ] 4.1 修改 `large-content-externalizer.ts`：删除 `readToolName(draft) === "Read"` 硬编码比较；依赖新增 `infinityToolNames: ReadonlySet<string>`（默认 `new Set(["Read"])`）与 `policy: LargeContentPolicy`（由 composition 注入，默认 `DEFAULT_LARGE_CONTENT_POLICY`）；`shouldExternalizeDraft` 与 `classifyReplacement` 改用注入 policy；`policy.infinity` 时原样返回 draft。
  验证：`large-content-externalizer.test.ts`：`infinityToolNames` 含 `Read` 时超阈值 Read 结果原样返回（不写 workspace 文件、不带 replacement metadata）；非 Infinity 工具 50001 chars 仍外置。
  来源：spec §"Large-content thresholds and configuration are fixed" Infinity Scenario；design 决策 2、4。

- [ ] 4.2 `agent-app` composition（`create-app.ts` / externalizer 工厂）注入 `infinityToolNames`（默认含 `Read`）；阈值用固定默认值，无覆盖入口。
  验证：externalizer 单元测试：`infinityToolNames` 含 `Read` 时超阈值 Read 结果原样返回。
  来源：spec Infinity Scenario；design 决策 2。

## 5. 架构与既有测试对齐

- [ ] 5.1 更新 `tests/architecture/large-content-cross-baseline.test.ts`：断言 externalizer 无硬编码工具名字符串比较（`=== "Read"`）。
  验证：`npx vitest run tests/architecture/large-content-cross-baseline.test.ts`。
  来源：design 决策 2；质量属性可维护性。

- [ ] 5.2 更新受影响既有测试中引用旧阈值 8192/16384/1024 的断言：`large-content-render.test.ts`、`large-content-classifier.test.ts`、`packages/agent-app/tests/large-content-externalizer.test.ts`。
  验证：`npx vitest run packages/agent-context-engine/tests/large-content-*.test.ts packages/agent-app/tests/large-content-externalizer.test.ts`。
  来源：spec 阈值变更；design 决策 1。

## 6. 验证和收尾

- [ ] 6.1 运行 large-content 相关全量测试与 strict 校验。
  验证：`npx vitest run packages/agent-context-engine packages/agent-app`；`npx openspec validate refine-ts-large-content-tool-result-offload --strict`。
  来源：design 验证映射；spec 全部 Scenario。

- [ ] 6.2 运行受影响包的类型检查。
  验证：`npx tsc -p packages/agent-context-engine/tsconfig.json --noEmit`；`npx tsc -p packages/agent-app/tsconfig.json --noEmit`。
  来源：design 模块边界。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/large-content-references/spec.md`：新阈值默认值（50000/200000/2048）、Infinity 工具、冻结重放 Scenario。
- 更新 `openspec/designs/modules/agent-context-engine.md`：`LargeContentPolicy` 参数化、`infinityToolNames`、externalizer effective policy 注入。
- 新增 `openspec/designs/adr/large-content-threshold-tuning.md`：阈值上调、Infinity 工具取舍。
- 更新 `openspec/designs/spec-to-design-map.md`：`large-content-references` → ADR / 模块设计导航。
- 更新 `openspec/overview.md`：阈值上调对缓存命中与单轮 token 成本的影响。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
