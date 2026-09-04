# refine-local-package-developer-hook-trace-default

## 背景与问题（Why）

本地 `pack:release` 包已经包含 `developer-hook-trace` plugin artifact，但生成的包仍需手工编辑 `nextAgent.system.plugins[]` 和 Agent `hooks[]` 之后本地循环 trace 日志才能工作。对本地 release 包而言，预期的开发者诊断路径应在解包后即可用。

## 变更范围（What Changes）

- 保持 `developer-hook-trace` artifact 暂存在 `config/plugins/developer-hook-trace/` 下。
- 对具备 backend 能力的本地 `pack:release` 候选包，把 `developer-hook-trace` 加入打包的 `config/default-system.yaml` 样例。
- 对具备 backend 能力的本地 `pack:release` 候选包，在打包的 `agents/default-agent/agent.yaml` 中激活 `developer-hook-trace.loop-raw-boundary`。
- 不修改仓库内置默认 Agent 源定义，也不修改非打包的开发启动默认值。
- 不默认启用 `context-monitor`。

## 非目标（Non-Goals）

- 不做运行时 plugin 目录扫描、热加载、marketplace 行为或远程 plugin 加载。
- 不改变 Web API、stream event、audit、metric、trace、timeline 或运营日志 contract。
- 不改变仅前端的 package 行为。

## 验证入口（Validation）

- `npx vitest run --config vitest.config.release.ts tests/fullstack-packaging-boundary.test.ts --maxWorkers=8`
- `openspec validate refine-local-package-developer-hook-trace-default --strict`
