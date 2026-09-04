# 实现任务

## 1. 插件定义与 stage 分发

- [x] 1.1 新增 `packages/agent-plugin-sdk/src/context-monitor.ts`，实现 `createContextMonitorPlugin(options)`：plugin id `context-monitor`，hook id `context-monitor.context-evolution`，`supportedStages = ["BEFORE_MODEL_INVOKE","AFTER_MODEL_RESULT","AFTER_CONTEXT_COMPACT","BEFORE_CONTEXT_COMPACT","BEFORE_AGENT_TERMINAL"]`，`effects: ["OBSERVE"]`，`failureMode: "CONTINUE"`，`execute` 始终返回 `{ outcome: "PASS" }`。来源：spec「SDK provides context-monitor plugin definition」。验证：`packages/agent-plugin-sdk/tests/context-monitor.test.ts` 断言 plugin id、hook id、supportedStages、effects、failureMode。
- [x] 1.2 在 `execute` 内按 `input.stage` 分发到独立处理函数（model-invoke / model-result / compact-after / compact-before / agent-terminal），不支持的 stage 直接 PASS。来源：spec 同上。验证：单测对每个 stage 分别触发并断言分发行为。

## 2. 按 session 内存状态与压缩落盘

- [x] 2.1 实现按 `sessionId` 维护的内存状态 `{ latestMessages, latestAnswer, pendingCompactions: [], compactSeq }`；`BEFORE_MODEL_INVOKE` 覆盖 `latestMessages`，`AFTER_MODEL_RESULT` 覆盖 `latestAnswer`，二者均不调用 sink。来源：spec「Context monitor records per-session context evolution」非压缩轮场景。验证：单测触发普通模型调用后断言 sink 未被调用。
- [x] 2.2 `AFTER_CONTEXT_COMPACT` 时把 `{ pre: deepCopy(latestMessages), summary: boundary.content }` 入 `pendingCompactions` 队列。来源：design 决策 2。验证：单测断言队列被填入、pre 为快照副本。
- [x] 2.3 `BEFORE_MODEL_INVOKE` 时若 `pendingCompactions` 非空，消费队首，调用 sink 写一条 compact 记录 `{ event:"CONTEXT_COMPACT", sessionId, seq, pre, post: boundary.messages, summary }`，`seq` 自增，随后更新 `latestMessages = boundary.messages`。来源：spec 压缩落盘场景。验证：单测模拟「compact-after → 下一次 before-model-invoke」序列，断言 sink 收到含 pre/post/summary 的 compact 记录、`latestMessages` 更新为 post。
- [x] 2.4 `BEFORE_AGENT_TERMINAL` 时调用 sink 覆盖写一条 last 记录 `{ event:"CONTEXT_LAST", sessionId, messages: latestMessages, answer: latestAnswer }`。来源：spec 终态覆盖写场景。验证：单测触发 terminal 后断言 sink 收到 last 记录。
- [x] 2.5 同一 session 多次压缩时 `seq` 递增、文件名 `compact-{sessionId}-{seq}` 不冲突；同一 session 多个 run 的 terminal 覆盖同一 `last-{sessionId}`。来源：spec 文件总数 = 1 + 压缩次数。验证：单测构造 2 次压缩 + 2 次 terminal，断言 compact 记录 2 条（seq 1/2）、last 记录覆盖（最终仅 1 条最新内容）。

## 3. observe-only 与失败隔离

- [x] 3.1 sink 抛错时 `execute` 捕获并仍返回 `{ outcome: "PASS" }`，不向调用方抛出。来源：spec「Context monitor is observe-only」。验证：单测注入抛错 sink，断言 hook 返回 PASS 且不抛出。
- [x] 3.2 negative verification：sink 抛错场景下断言「主流程模拟」继续推进（hook 调用不阻断、boundary 不被改写）。来源：design 可靠性。验证：单测在 sink 抛错后继续触发下一 stage，断言后续 stage 正常分发、`latestMessages` 仍按预期更新。

## 4. caller-owned sink 与 file sink

- [x] 4.1 插件 `options.log` 接收 caller-owned sink `(record) => void | Promise<void>`；SDK 不强制文件形态。来源：spec「Context monitor logging is caller-owned」。验证：单测用内存 sink 收集记录。
- [x] 4.2 实现 `createContextMonitorFileSink({ logDirectory })`，把 compact 记录写到 `compact-{sessionId}-{seq}.json`、last 记录覆盖写到 `last-{sessionId}.json`，并对 sessionId 做 sanitize 防穿越。来源：spec caller-owned + file sink 场景。验证：单测写到临时目录后读回比对内容。
- [x] 4.3 negative verification：file sink 通过 `sanitizeSessionId` + `assertFileStaysUnderDirectory` 阻止 sessionId 含 `..`/路径分隔符导致逃逸。来源：spec 路径穿越场景。验证：单测对 `../../etc/evil` 形 sessionId 断言落盘文件名被 sanitize、不逃逸目录。

## 5. artifact 生成

- [x] 5.1 实现 `createContextMonitorPluginArtifact({ targetDirectory, logDirectory?, overwrite? })`，写 `plugin.json`（plugin id `context-monitor`、`apiVersion: "1.0"`、`main: "./index.js"`、`artifactType: "esm-bundle"`、`hostExternals: []`）与单文件 ESM `index.js`（内联 stage 分发 + 内存状态 + file sink，经 `process.getBuiltinModule("node:fs")` 访问 fs）。来源：spec「SDK can write a formal context-monitor plugin artifact」。验证：单测生成产物后断言两文件存在、`plugin.json` 字段、`index.js` 可被 `import()` 且 default export 暴露 `context-monitor.context-evolution` hook。
- [x] 5.2 artifact hook 支持 activation config `{ enabled, logDirectory }`，`enabled === false` 时直接 PASS 不写盘。来源：spec artifact 场景。验证：单测对 `enabled:false` 断言无写盘。
- [x] 5.3 negative verification：目标已存在且未传 `overwrite` 时 helper 必须 fail closed。来源：spec artifact 场景。验证：单测重复生成断言抛错。

## 6. SDK 导出与打包

- [x] 6.1 在 `packages/agent-plugin-sdk/package.json` 新增 `./context-monitor` subpath export（types + import）。`context-monitor.ts` 使用 `node:fs`，按 SDK 约定作为独立 subpath，不从 root `index.ts` re-export（避免把 fs 拉进根依赖图）。来源：proposal 影响范围 + SDK 模块设计。验证：`npm run build` 通过；architecture test `plugin-composition-boundary` 断言 exports 含 `./context-monitor` 且 root index 不引用 scaffold。
- [x] 6.2 本地运行时打包脚本 `scripts/pack-local-runtime.mjs` 纳入 `config/plugins/context-monitor/`（`plugin.json` + `index.js`），不修改 `default-system.yaml` 的 `nextAgent.system.plugins[]`、不修改默认 Agent `hooks[]`。来源：spec「Local runtime packaging includes context-monitor artifact without default activation」。验证：`tests/fullstack-packaging-boundary.test.ts` 校验两文件存在、`nextAgent.system.plugins` 为 undefined。
- [x] 6.3 negative verification：默认打包产物加载后，未在 config 声明时 hook 不被激活。来源：spec 默认不激活场景。验证：`tests/fullstack-packaging-boundary.test.ts` 断言打包后 `nextAgent?.system?.plugins` 为 undefined。

## 7. loader 加载与端到端

- [x] 7.1 在 `packages/agent-plugin-sdk/tests/context-monitor.test.ts` 中通过动态 `import()` 加载生成的 artifact，断言 hook 被暴露且 activation config 生效。来源：spec「Product path loads generated artifact」。验证：`npx vitest run packages/agent-plugin-sdk/tests/context-monitor.test.ts`（10 passed）。
- [x] 7.2 端到端：`tests/e2e/context-monitor-plugin-product-path.test.ts` 通过 system config 声明 artifact + Agent `hooks[]` 激活，跑一次请求，断言 `last-{sessionId}.json` 落盘且请求正常完成（`REQUEST_COMPLETED`）。来源：spec「Product path loads generated artifact and records context evolution」。验证：`tsc -b` 类型检查通过（e2e 在 release e2e gate 执行，默认 `npm test` 排除 `tests/e2e/**`）。

## 8. 归档前更新基线检查（非实施任务）

- [ ] 8.1 归档前确认 `openspec/specs/context-monitor-logging/spec.md`、`openspec/overview.md`、`openspec/designs/modules/agent-plugin-sdk.md`、`openspec/designs/spec-to-design-map.md` 按 proposal/design 的 Baseline Promotion Plan 提炼稳定事实。
