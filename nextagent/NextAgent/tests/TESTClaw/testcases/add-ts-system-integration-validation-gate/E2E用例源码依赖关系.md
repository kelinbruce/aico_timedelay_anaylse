# E2E 用例源码依赖关系

## 独立运行边界

本文件中的“源码依赖”只表示需求追踪和维护期漂移来源，不表示 TestClaw 运行时 import。

| TestClaw 范围 | 维护期来源 | 独立运行依赖 |
|---|---|---|
| `001..041` | `tests/e2e/*-gate` inventories/specs | candidate root + TestClaw fixtures |
| `042..090` | `tests/e2e/*.test.ts` 20 个文件 | candidate root + TestClaw fixtures |
| `091..111`、`120..122` | `frontend/agent-web/tests/e2e/*.cjs` 7 个文件 | candidate root frontend + Edge/Playwright |
| `112..114` | active OpenSpec + 外部依赖汇总 | external packages root + loopback/filesystem |
| `115..118` | active OpenSpec | candidate root + external packages root |
| `119` | active OpenSpec + multi-host specs | candidate root frontend/backend + Edge |

## 禁止依赖

- 仓库 `packages/*/src`、`frontend/agent-web/src`；
- private subpath；
- `@nextagent/*/testing`；
- 源码 Vitest/Playwright report；
- 源码 runner 的 pass/fail；
- mock route 或 fake stream 作为目标边界；
- 上次 TestClaw report。

## 允许依赖

- candidate root 的公开可执行入口和构建产物；
- external packages root 的 package exports；
- TestClaw 自有静态 fixtures、deterministic model inputs 和 loopback servers；
- TestClaw 本次创建的临时根、端口、浏览器 context 和 evidence。
