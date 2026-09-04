## 1. 后端配置 schema（语义：公共前缀 P，默认 /）

- [x] 1.1 `packages/agent-app/src/config/component-config.ts` 的 `LocalChannelOptions.routePrefix` 注释更新为公共前缀 P
  验证：`npm run typecheck` 通过
  来源：spec「channel.routePrefix 公共前缀 P」
- [x] 1.2 `packages/agent-app/src/config/validation.ts` 的 `channel.routePrefix` schema pattern 不变（已允许单个 `/`）；`createConfig` 默认 `routePrefix: raw.channel.routePrefix ?? '/'`
  验证：`npm run typecheck` 通过
  来源：spec「默认值 / 无前缀」
- [x] 1.3 `packages/agent-app/config/default-system.yaml` 的 `channel.routePrefix` 改 `/`，加迁移注释
  验证：配置加载默认无前缀
  来源：spec「默认值 + 迁移」

## 2. composition 透传（P）

- [x] 2.1 `packages/agent-app/src/composition/channel-composition.ts` 顶部 `routePrefix = systemConfig.channel.routePrefix ?? '/'`（P），透传给主 Web channel / IR（`apiSubNamespace: 'ir'`）/ auth-local；各 register 默认参数改 `/`
  验证：`npm run typecheck` 通过
  来源：spec「前缀透传 + IR 子命名空间」
- [x] 2.2 `LocalConfiguredAuthChannelContribution.register` 入参 `routePrefix`（P）下传到 `createLocalConfiguredWebAuth`
  验证：`npm run typecheck` 通过
  来源：spec「auth-local 前缀」

## 3. 后端路由拼接改"追加 P + 固定 /api/v1"

- [x] 3.1 `packages/agent-channel-web/src/routes/requests.ts` `route()` 改 `${prefix}/api/v1/${path}`（P=/ 时 `/api/v1/path`）；新增 `apiSubNamespace` option；`WebChannelDependencies.routePrefix` 注释更新
  验证：`agent-channel-web` 既有测试零回归
  来源：spec「route() 追加语义」
- [x] 3.2 `packages/agent-channel-web/src/routes/memory.ts` `BASE = ${prefix}/api/v1/memory/long-term-mem`
  验证：`memory-routes` 测试通过
  来源：spec「memory 跟随」
- [x] 3.3 `packages/agent-channel-web-auth-local/src/index.ts` `routePrefix`（P）默认 `/`；`authLocalPrefix`/`runtimeBootstrapPath` 拼 `/api/v1`；`isProtectedPath` 受保护 API 判定基于 `${prefix}/api/`（SPA 静态资源/页面路由公开判定保持根路径）；`sendChallenge`/`sendAuthFailure` 的 `loginUrl` 改 `${prefix}/login`
  验证：`auth-local` 既有测试零回归
  来源：spec「auth-local 路由/判定/challenge 跟随」

## 4. 前端 API 调用自动加前缀

- [x] 4.1 `frontend/agent-web/src/config/runtimeConfig.ts` `resolvePathPrefix` 读 `import.meta.env.VITE_API_URL_PREFIX`（P，默认空串）；`buildApiUrl` 追加逻辑（仅 path 以 `/api/v1` 开头时前面拼 P，`/rest/` 等非 API 路径不加前缀，P 空时不变）；`loadRuntimeConfig` 用构建期 P 拼 bootstrap；`RUNTIME_BOOTSTRAP_PATH` 不变；非法值始终抛错（不区分 dev/prod）
  验证：`runtime-config` 测试通过（14 个）
  来源：spec「追加语义 + 构建期 VITE_API_URL_PREFIX + 非 /api/v1 不加前缀 + 非法值始终抛错」
- [x] 4.2 `frontend/agent-web/vite.config.ts` 读取 `VITE_BASE` 设置 Vite `base`；删除 `envPrefix: ['VITE_', 'PREFIX_']`（改用 `VITE_` 前缀后不需要额外配置）；`src/vite-env.d.ts` 声明 `VITE_BASE` 和 `VITE_API_URL_PREFIX` 类型
  验证：`import.meta.env.VITE_API_URL_PREFIX` 构建期可读；typecheck 通过
  来源：spec「构建期 VITE_API_URL_PREFIX + VITE_BASE」
- [x] 4.3 `frontend/agent-web/scripts/build-modes.mjs` 新增 `parseBuildArgs` 解析 `--base` 和 `--apiUrlPrefix` CLI 参数；`--base` 透传为 `VITE_BASE`，`--apiUrlPrefix` 透传为 `VITE_API_URL_PREFIX`；两个参数均做前置校验，非法值终止构建；不传参数时退化为默认值
  验证：参数解析 + 校验逻辑测试通过
  来源：spec「CLI 参数 --base --apiUrlPrefix」
- [x] 4.4 21 个 service/hook 文件不改（继续传 `/api/v1/xxx`，经 `buildApiUrl` 单一入口自动加 P）；`/rest/` 路径的 3 个外部接口调用经 `buildApiUrl` 但不加前缀
  验证：`apiClient`/`useStreamConnection`/`SessionActivityConnectionController` 经 buildApiUrl
  来源：spec「单一入口 + 非 /api/v1 不加前缀」

## 5. 测试与验证

- [x] 5.1 `agent-channel-web` 路由测试：配 `routePrefix: '/svcA'` 后 sessions/health 命中 `/svcA/api/v1/...`，`/api/v1/...` 返回 404；IR 命中 `/svcA/api/v1/ir/...`；`P=/` 退化零回归
  验证：`route-prefix.test.ts` + 全套 218 测试通过
  来源：spec「自定义前缀命中」
- [x] 5.2 `agent-channel-web-auth-local` 测试：配 `routePrefix` 后 login/logout 命中 `/svcA/api/v1/auth/local/*`，challenge `loginUrl` 为 `/svcA/login`，受保护 API 判定跟随 P
  验证：`protected-prefix.test.ts` 通过
  来源：spec「auth-local 自定义前缀」
- [x] 5.3 `frontend/agent-web` runtime-config 测试：`VITE_API_URL_PREFIX=/svcA` 时 `buildApiUrl('/api/v1/sessions')` → `/svcA/api/v1/sessions`；`/rest/` 路径不加前缀；空值/`/` 回退无前缀；非法值 dev 和 prod 模式均抛错
  验证：`runtime-config.test.ts` 通过（14 个测试）
  来源：spec「追加行为 + 非 /api/v1 不加前缀 + 非法值始终抛错」
- [x] 5.4 IR 测试适配新 `apiSubNamespace` 语义（`ir-surface-routes.test.ts` 传 `routePrefix:'/'` + `apiSubNamespace:'ir'`）
  验证：IR 测试通过
  来源：spec「IR 子命名空间」
- [x] 5.5 仓库根 `npm run typecheck`、`npx vitest run --maxWorkers=8` 全绿；`agent-channel-web` 全套 218 测试零回归
  验证：三条命令通过
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal 的「归档前更新基线」处理：

- `openspec/specs/app-config-schema/spec.md`：`channel` 组合并 `routePrefix`（公共前缀 P，默认 /）requirement。
- `openspec/specs/web-channel-api-contract/spec.md`：合并 Web API 前缀 P 追加 + 前端 API 调用自动加前缀 requirement。
- `openspec/overview.md`：稳定基线描述补充 P 可配一句。
