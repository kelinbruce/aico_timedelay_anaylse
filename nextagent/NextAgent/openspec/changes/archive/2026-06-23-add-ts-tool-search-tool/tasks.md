## 1. 描述符与 schema

- [x] 1.1 定义 `ToolSearch` 描述符和固定 schema。
- [x] 1.2 定义默认/最大 limit 和安全结果字段。

## 2. 搜索适配器

- [x] 2.1 消费受治理的当前 run tool projection。
- [x] 2.2 只搜索安全元数据，并保留可见性过滤。
- [x] 2.3 返回稳定的有界结果。
- [x] 2.4 仅在配置了可信 ToolSearch 披露时暴露 `ToolSearch`，保持既有 model Tool Calling 条目不变，并在 request 本地激活有界搜索结果。
- [x] 2.5 为 Skill 披露模式新增可信 app 配置，并通过 context 渲染和 ToolSearch runtime 搜索范围接线 `tool-search` 模式。
- [x] 2.6 新增 capability 披露策略元数据、安全搜索提示和 request 本地发现的 Skill context。
- [x] 2.7 在 Skill body 加载前强制 ToolSearch 延迟的 Skill 发现。
- [x] 2.8 使用 `CapabilityDisclosureMode.DEFERRED` 区分 provider 发现的 `SEARCH` 与 ToolSearch 延迟披露，新增显式 `tool-disclosure-mode`，并保持默认披露模式为 `list`。

## 3. 测试

- [x] 3.1 覆盖正常搜索、未授权过滤、未知来源不扫描、limit/截断和安全日志。
- [x] 3.2 覆盖搜索优先的 Tool 披露和 request 本地激活。
- [x] 3.3 覆盖一个 E2E Skill 目录场景：Skill 描述符进入 model context，list 模式下 ToolSearch 不搜索 Skill，选中的 Skill body 延迟加载。
- [x] 3.4 覆盖 Skill 披露模式默认值、`tool-search` prompt 省略、ToolSearch Skill 结果和代表性 Skill `tool-search` 延迟加载。
- [x] 3.5 覆盖 searchHint 匹配、发现的 Skill context 补丁、阻止未发现 Skill 的加载，以及 eager 策略 Skill 旁路。
- [x] 3.6 覆盖 `tool-search` 延迟 Skill ID 披露（不带描述）、ToolSearch 直接 `select:` Skill 发现，以及带延迟 Skill ID 的 E2E Skill 延迟加载。
- [x] 3.7 覆盖显式 ToolSearch 披露开关行为：默认 `list` 模式省略 `ToolSearch`，而 `tool-search` 模式新增 `ToolSearch` 且不修改既有 Tool Calling 条目。

## 4. 验证

- [x] 4.1 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-tool-search-tool --strict`。
- [x] 4.2 在搜索优先披露变更后，重新运行聚焦的 ToolSearch、Context Engine、E2E、构建和 OpenSpec 验证。
- [x] 4.3 在 Skill 延迟加载场景后，运行聚焦的 Skill/ToolSearch e2e 测试和 `npm.cmd run build`。
- [x] 4.4 在新增 Skill 搜索披露模式后，运行 `npm.cmd test -- packages/agent-capability/tests/tool-search-tool.test.ts`、`npm.cmd test -- packages/agent-context-engine/tests/skill-disclosure-render.test.ts`、`npm.cmd test -- tests/agent-kernel/config-assembly.test.ts --testNamePattern "Skill disclosure mode"`、`npm.cmd test -- tests/e2e/skill-scale-product-path.test.ts`、`npm.cmd test -- tests/e2e/tool-search-product-path.test.ts`、`npm.cmd test`、`npm.cmd run build`、`npm.cmd run test:contract`、`npm.cmd run lint:architecture`、`openspec validate add-ts-tool-search-tool --strict` 和 `openspec validate --all --strict`。
- [x] 4.5 在新增发现强制后，运行聚焦的 ToolSearch、Skill、context-engine、e2e、构建、架构、contract 和 OpenSpec 验证。
- [x] 4.6 在把 `tool-search` 模式与延迟 Skill ID 披露对齐后，运行聚焦的 ToolSearch、context-engine、Skill e2e 和 OpenSpec 验证。
- [x] 4.7 在把 `SEARCH` 发现与 `DEFERRED` 披露拆分并新增显式 `tool-disclosure-mode` 开关后，运行聚焦的 config、capability、context-engine、CLIP 延迟 e2e、构建和 OpenSpec 验证。
