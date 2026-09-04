# shrink-agent-app-to-composition-root

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
OpenSpec 归档：[`2026-07-14-shrink-agent-app-to-composition-root`](../../openspec/changes/archive/2026-07-14-shrink-agent-app-to-composition-root)
所属分组：Composition / App Boundary

状态：complete
类型：架构 refinement + owner boundary 收敛
主要 owner：`agent-app`
协作 owner：`agent-capability`、`agent-context-engine`、`agent-memory`、`agent-observability`、`agent-platform-gateway-local`、`agent-runtime`、`agent-session`
依赖：`establish-ts-backend-architecture`、`add-ts-app-config-schema`、`refine-ts-extension-registration`

目标：
- 将 `agent-app` 收缩为严格 composition root，只负责配置加载、依赖注入、服务装配和启动关闭。
- memory、workflow、context、observability、capability、question、health 等业务策略由 owning package public factory 提供。
- 消除 app composition 内的 owner leakage，同时保持 request lifecycle、Agent Scope、Owner Scope 和 public contracts 不变。

规格输入：
- `agent-app` SHALL NOT own request lifecycle、context assembly semantics、memory extraction semantics、capability execution semantics、observability event shaping、gateway persistence semantics 或 session question business logic。
- Owning packages MUST expose narrow public factory/adapter APIs when composition wiring is required.
- `agent-app` MAY own app configuration source loading, frozen config projection, dependency graph construction, server/plugin registration and lifecycle start/close.
- Owner boundary 调整不得复制 config state machine、capability registry、sandbox adapter、health state 或 observability vocabulary。
- Request lifecycle、scheduler、same-session lane、terminal commit、canonical timeline、Agent Scope 和 Owner Scope 语义不得改变。

契约输入：
- 复用 architecture baseline 的 composition root、runtime、context、capability、observability、gateway 和 session owner 边界。
- 复用 `app-config-schema` 的 startup-only validation/freeze 和 downstream narrow projection。
- 新 public factory 只在 owning package 暴露窄依赖对象；不得新增 catch-all app service contract。

实现约束：
- 优先把业务策略归位到 owning package public factory，`agent-app` 只注入冻结配置、ports、registries、logger/clock 和 selected dependencies。
- Owner package 不得反向依赖 `agent-app`。
- 不得引入 DI container、service locator、global mutable registry 或第二套 sandbox/model/capability/config mechanism。
- 每个 owner boundary 调整必须有可重复验证路径；高风险路径先用 characterization/contract/architecture tests 固定外部行为。

非目标：
- 不改变 runtime lifecycle、channel projection、context/model/capability/gateway public contracts。
- 不引入运行时插件热加载或 request-time contribution discovery。
- 不重做 app config schema 或 capability/model registry 主路径。

验收要点：
- Architecture tests 覆盖 `agent-app` 不 private-import owner package internals 或 provider/gateway private implementation。
- Unit/contract tests 覆盖归位后的 owner package factories。
- Characterization tests 覆盖 startup composition、health/readiness、model selection、capability availability、memory tool availability 和 safe diagnostics。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate --all --strict` 通过。

并行边界：
- 可与 `refine-ts-extension-registration` 并行，但只消费其 frozen registry/snapshot，不重新定义 extension registration。
- 不与 runtime lifecycle、session persistence、Agent Scope、Owner Scope 或 stream projection change 共享主 owner。
