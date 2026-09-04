## 1. 配置和 CLIP discovery wiring

- [x] 1.1 在 `agent-app` 配置中新增 `clipcDisclosureMode: "list" | "tool-search"`，YAML 字段为 `adnclaw.system.capability-disclosure.clipc-disclosure-mode`，默认 `list`。
  验证：`npx vitest run tests/agent-kernel/config-assembly.test.ts -t "parses trusted capability disclosure modes" --reporter=verbose`
- [x] 1.2 将 CLIP disclosure mode 从 app composition 传入 `createCapabilitySubsystem` 和 `ClipBackedToolDiscovery`。
  验证：`npx vitest run packages/agent-capability/tests/clip-tool-source.test.ts`
- [x] 1.3 `tool-search` 模式中 CLIP-backed Tool descriptor 标记为 `disclosurePolicy.mode="DEFERRED"`，并保留普通 Tool schema、executor registry 和 private routing 隔离。
  验证：`npx vitest run packages/agent-capability/tests/clip-tool-source.test.ts`
- [x] 1.4 将 disclosure mode 与 provider discovery mode 拆开：`CapabilityDiscoveryMode.SEARCH` 只表示 provider/catalog discovery，CLIP lazy disclosure 使用 `CapabilityDisclosureMode.DEFERRED`。
  验证：`npx vitest run packages/agent-capability/tests/clip-tool-source.test.ts`

## 2. Context Engine prompt 和工具披露

- [x] 2.1 在 system prompt 中为 ToolSearch-deferred CLIP Tool 渲染 `<available-deferred-clipc>`，只列 `capabilityId`，不列描述和 schema。
  验证：`npx vitest run packages/agent-context-engine/tests/skill-disclosure-render.test.ts`
- [x] 2.2 模型工具列表默认不输出 ToolSearch-deferred CLIP Tool，`allowedTools` 命中后输出具体普通 Tool descriptor/inputSchema。
  验证：`npx vitest run packages/agent-context-engine/tests/skill-disclosure-render.test.ts`
- [x] 2.3 negative case：ToolSearch 未激活的 CLIP Tool 不应因为出现在 `<available-deferred-clipc>` 而进入模型工具列表。
  验证：`npx vitest run packages/agent-context-engine/tests/skill-disclosure-render.test.ts`

## 3. ToolSearch CLIP result projection

- [x] 3.1 ToolSearch 命中 CLIP-backed Tool 时生成 `<available-clipc>` 元消息，并继续把命中 Tool 写入 `contextPatch.allowedTools`。
  验证：`npx vitest run packages/agent-capability/tests/tool-search-tool.test.ts`
- [x] 3.2 negative case：ToolSearch 未命中 CLIP Tool 时不生成 `<available-clipc>`，不加入 CLIP `allowedTools`。
  验证：`npx vitest run packages/agent-capability/tests/tool-search-tool.test.ts`
- [x] 3.3 ToolSearch/CLIP 元消息不得暴露 provider-private CLIP id、primitive 或泛化 dispatch Tool。
  验证：`npx vitest run packages/agent-capability/tests/tool-search-tool.test.ts`
- [x] 3.4 将 CLIP 命中投影规则归属到 `tool-search-tool` spec delta，明确 `<available-clipc>` 和 `contextPatch.allowedTools` 是 ToolSearch result projection 职责。
  验证：`openspec validate --all --strict`

## 4. 代表性 CLIP 验证场景

- [x] 4.1 为测试应用增加可注入 capability provider configs 和 fake `ClipCommandRunner` 的入口，不绑定真实 CLIP daemon 或绝对路径。
  验证：`npx vitest run tests/e2e/clipc-tool-search-lazy-context.test.ts`
- [x] 4.2 新增 e2e：构造代表性 CLIP API 集合，验证初始 prompt 有 `<available-deferred-clipc>`、初始 tools 无未命中 CLIP schema、ToolSearch 命中后下一轮只激活选中 CLIP Tool。
  验证：`npx vitest run tests/e2e/clipc-tool-search-lazy-context.test.ts`

## 5. 验证和收口

- [x] 5.1 运行 OpenSpec strict 验证。
  验证：`openspec validate --all --strict`
- [x] 5.2 运行相关单元与 e2e 测试。
  验证：
  - `npx vitest run packages/agent-capability/tests/clip-tool-source.test.ts packages/agent-capability/tests/tool-search-tool.test.ts packages/agent-context-engine/tests/skill-disclosure-render.test.ts tests/e2e/clipc-tool-search-lazy-context.test.ts`
  - `npx vitest run tests/agent-kernel/config-assembly.test.ts -t "parses trusted capability disclosure modes" --reporter=verbose`
  - `npx vitest run tests/agent-kernel/config-assembly.test.ts -t "registers clip_server" --reporter=verbose`
  备注：完整 `tests/agent-kernel/config-assembly.test.ts` 在 Windows 上遇到既有 SQLite `EBUSY` 清理失败；本变更相关配置断言已单独通过。
- [x] 5.3 清理本次实现产生的未使用代码、临时 fixture 和无关 diff。
  验证：`npx tsc --noEmit`、`git diff --check`
- [x] 5.4 在 `tool-search` 配置值和 `DEFERRED` disclosure 语义拆分后，重跑相关单元/e2e、build 和 OpenSpec strict 验证。
  验证：`npm run build`、`npx tsc --noEmit`、focused Vitest、`npm run lint:architecture`、`openspec validate --all --strict`

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/api-backed-tool-source/spec.md`。
- 按需更新 `openspec/designs/architecture/capability-spi.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
- 按需更新 `openspec/designs/modules/agent-context-engine.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
