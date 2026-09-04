## 1. Spec 和设计收敛

- [x] 1.1 补强架构与 packaging 规格，明确同仓库允许 `frontend/agent-web` 存在，前端构建后的 npm 包固定为 `@nextagent/agent-web`，且后端 `agent-app` 只能消费 `@nextagent/agent-web/hosting` 中的 `resolveFrontendHostingManifest()` 和静态资源产物，不得依赖前端源码或 private path。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：Requirement: Backend consumes only packaged frontend artifacts
- [x] 1.2 定义 `backend-only` / `with-frontend` 两种明确 package/build profile，并要求 profile 选择来自可信构建参数或打包参数，而不是运行时目录探测。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：Requirement: Fullstack serving profile is selected by trusted packaging input
- [x] 1.3 将唯一实现路径固定为 `packages/agent-app/src/entrypoints/backend-only.ts`、`packages/agent-app/src/entrypoints/with-frontend.ts` 两个产品入口 + `packages/agent-app-frontend-hosting` 中独立 package 提供的 Fastify 前端托管插件，并明确 `backend-only` 产物必须裁剪掉前端能力。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：design decisions D4 / D6 / D8
- [x] 1.4 固定两种候选运行包的依赖权威为 `packages/agent-app/manifests/backend-only.package.json` 和 `packages/agent-app/manifests/with-frontend.package.json`，并明确 `packages/agent-app/package.json` 不是运行包依赖权威。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：Requirement: Product runtime dependencies are governed by dedicated product manifests
- [x] 1.5 定义 `agent-app` 拥有静态资源 route registration ownership，`agent-channel-web` 继续只负责 transport 和 stream projection。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：Requirement: Agent-app owns UI asset route registration
- [x] 1.6 将统一的 release/build/package orchestration 明确标记为 deferred/non-goal，不作为本 change 的验收前提；同时明确 dev-only `npm run dev:fullstack` bootstrap 属于当前 change。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：design non-goals
- [x] 1.7 固定 toolchain 与 shared dependency 的权威来源，明确根 `package.json` 是 Node.js、TypeScript 和 `x-nextagent.sharedDependencyLockstep` allowlist 的唯一权威 manifest，并明确 `frontend/agent-web-mock-server` 不在治理范围内。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：design decisions D9 / D10 / D11
- [x] 1.8 定义 fullstack 开发阶段单入口，固定仓库根 `npm run dev:fullstack` 作为 dev-only convenience entry，顺序完成后端依赖准备、前端依赖准备、前端构建、`@nextagent/agent-web` artifact 装配和 `with-frontend` 服务启动；该命令不得作为候选 evidence、正式打包入口或 release verdict 来源。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：Requirement: Fullstack dev bootstrap starts from one command
- [x] 1.9 固定前后端产品版本权威，明确仓库根 `package.json.version` 是 fullstack 产品版本唯一来源；`@nextagent/agent-web` artifact package version 和 `with-frontend.package.json` 中声明的 `@nextagent/agent-web` 精确依赖版本必须与根版本一致，运行时不得自动同步或修正版本。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：Requirement: Fullstack product version is rooted in root package manifest

## 2. Fullstack package boundary 实现

- [x] 2.1 定义并实现 `@nextagent/agent-web` 前端 npm 包产物 contract，并固定 `@nextagent/agent-web/hosting` export 暴露 `resolveFrontendHostingManifest()`。
  验证：frontend package consumption tests 断言 `agent-app` 能消费 `resolveFrontendHostingManifest()`，且无法通过源码路径或 private path 取资源。
  来源：Requirement: Backend consumes only packaged frontend artifacts
- [x] 2.2 实现 `backend-only` / `with-frontend` 两个产品入口和对应的 package/build profile，并把当前 profile 写入候选运行包 evidence。
  验证：package profile contract tests 覆盖 frontend enabled/disabled、缺失前端包时的 negative case，以及 backend-only evidence。
  来源：Requirement: Fullstack serving profile is selected by trusted packaging input
- [x] 2.3 实现 `packages/agent-app/manifests/backend-only.package.json` 和 `packages/agent-app/manifests/with-frontend.package.json`，并验证 backend-only manifest 不声明前端依赖、with-frontend manifest 显式声明 `@nextagent/agent-app-frontend-hosting`，且以标准 npm package dependency 形式精确依赖 `@nextagent/agent-web`。
  验证：product manifest tests 覆盖两种 manifest 的 dependency set。
  来源：Requirement: Product runtime dependencies are governed by dedicated product manifests
- [x] 2.4 实现 `@nextagent/agent-app-frontend-hosting` 独立 package 的前端托管 Fastify 插件 `frontendHostingPlugin`，并由 `agent-app` 负责注册；只有 `with-frontend` 产品入口才依赖并挂载前端静态资源和 route fallback。
  验证：startup/profile integration tests 覆盖 backend-only 不注册前端路由、with-frontend 注册前端路由；architecture tests 断言 backend-only 入口不依赖前端托管插件 package。
  来源：Requirement: Agent-app owns UI asset route registration
- [x] 2.5 固定 `with-frontend` 配置解析路径：只从 profile 选择结果和 `@nextagent/agent-web/hosting` 中 `resolveFrontendHostingManifest()` 返回值读取 asset root、`index.html`、base path 和 SPA fallback。
  验证：with-frontend config tests 覆盖 manifest 缺失、manifest 非法和 second-source override negative cases。
  来源：Requirement: With-frontend hosting configuration has one authority path
- [x] 2.6 为 `resolveFrontendHostingManifest()` 实现固定 runtime schema、路径约束和 fail-closed 行为。
  验证：frontend hosting manifest validation tests 覆盖缺失字段、路径穿越、绝对路径、缺失文件和 fail-closed。
  来源：Requirement: Frontend hosting manifest is schema-validated and path-bounded
- [x] 2.7 实现仓库根 `npm run dev:fullstack`，顺序完成后端依赖准备、`frontend/agent-web` 依赖准备、前端构建、生成最小 `@nextagent/agent-web` artifact package、通过固定 bootstrap 脚本按标准 npm package install 语义安装该前端包，然后启动 `with-frontend` 产品入口并在同一个 server 中提供后端 API/stream/control routes 和前端静态资源/route fallback。
  验证：fullstack dev bootstrap command tests 覆盖命令启动后 API route、真实静态资源和 SPA fallback 均可访问，并断言该命令不生成 release verdict 或 candidate qualification。
  来源：Requirement: Fullstack dev bootstrap starts from one command
- [x] 2.8 实现 route precedence，确保 API、SSE、WebSocket 和 control routes 不被静态资源 fallback 吞掉。
  验证：route precedence integration tests 覆盖 `/api/**`、SSE、WebSocket、control path、真实静态资源和 SPA fallback。
  来源：Requirement: UI asset fallback never takes ownership of backend routes
- [x] 2.9 在构建阶段实现 `backend-only` 产物裁剪，验证最终交付物中完全没有前端托管注册逻辑和前端静态产物。
  验证：artifact exclusion tests 对 backend-only 产物断言无前端注册逻辑、无前端静态产物；对 with-frontend 产物断言前端能力存在。
  来源：design decision D8
- [x] 2.10 实现前后端 Node.js 与 TypeScript 版本锁步校验，权威来源固定为根 `package.json` 的 `engines.node` 和根 `devDependencies.typescript`。
  验证：toolchain version consistency checks 在版本不一致时失败。
  来源：Requirement: Frontend and backend toolchain versions are lockstep-governed
- [x] 2.11 实现共同依赖的公共组件/共享库版本锁步校验，校验范围固定为根 `package.json` 的 `x-nextagent.sharedDependencyLockstep` allowlist 中列出且被 `frontend/agent-web`、`agent-app` 或 `@nextagent/agent-app-frontend-hosting` 直接声明的依赖，并排除 `frontend/agent-web-mock-server`。
  验证：shared dependency lockstep checks 对版本漂移 fixture 断言失败。
  来源：Requirement: Shared dependencies remain version-aligned across frontend and backend
- [x] 2.12 实现产品版本一致性校验：前端 artifact package 的 `package.json.version` 从根 `package.json.version` 写入，`with-frontend.package.json` 中声明的 `@nextagent/agent-web` 精确依赖版本以及 dev bootstrap 安装后的前端包版本必须与根版本一致，dev bootstrap / packaging validation 在版本漂移时失败。
  验证：product version consistency checks 覆盖根版本、前端 artifact version、`with-frontend.package.json` 中声明的前端依赖版本和 dev bootstrap 安装后的前端包版本的一致性。
  来源：Requirement: Fullstack product version is rooted in root package manifest

## 3. 安全和负向验证

- [x] 3.1 增加 source/dependency negative tests，断言后端实现不得 import `frontend/agent-web` 源码或 frontend-private path。
  验证：architecture/source assertion tests 触发非法 import fixture 并断言失败。
  来源：Requirement: Backend consumes only packaged frontend artifacts
- [x] 3.2 增加 profile negative tests，断言 `backend-only` profile 下前端包缺失不阻断启动，而 `with-frontend` profile 下前端包缺失必须失败。
  验证：profile startup negative tests 覆盖两类候选运行包。
  来源：Requirement: Backend-only remains a valid runtime package profile
- [x] 3.3 增加 route fallback negative tests，断言前端静态资源 fallback 不处理 API/stream/control requests。
  验证：route precedence negative tests 覆盖 route overlap fixture。
  来源：Requirement: UI asset fallback never takes ownership of backend routes
- [x] 3.4 增加 backend-only artifact negative tests，断言 backend-only 产物中不存在前端托管插件 package 引用或前端静态资源内容。
  验证：artifact exclusion negative tests 对 backend-only 产物进行检查并断言失败用例。
  来源：design decision D8
- [x] 3.5 增加 with-frontend config negative tests，断言环境变量、配置文件或目录扫描不能覆写 `@nextagent/agent-web/hosting` 中 `resolveFrontendHostingManifest()` 返回的 manifest。
  验证：with-frontend config negative tests 对 second-source override fixture 断言失败。
  来源：Requirement: With-frontend hosting configuration has one authority path
- [x] 3.6 增加 product manifest negative tests，断言 backend-only manifest 一旦声明前端依赖即失败。
  验证：product manifest negative tests 覆盖 backend-only manifest dependency drift。
  来源：Requirement: Product runtime dependencies are governed by dedicated product manifests
- [x] 3.7 增加 fullstack dev bootstrap negative tests，断言 `npm run dev:fullstack` 在依赖准备失败、前端构建失败、artifact 装配失败、manifest 非法、路径越界或 `index.html` 不存在时 fail closed，且不得退回 backend-only、不得目录扫描、不得产生 release verdict。
  验证：fullstack dev bootstrap negative tests 覆盖构建失败、artifact 装配失败和非法 manifest。
  来源：Requirement: Fullstack dev bootstrap starts from one command
- [x] 3.8 增加 product version negative tests，断言根 `package.json.version`、`@nextagent/agent-web` artifact package version、`with-frontend.package.json` 中声明的前端依赖版本或 dev bootstrap 安装后的前端包版本发生漂移时 dev bootstrap / packaging validation fail closed，且后端运行时不得自动改写版本。
  验证：product version negative tests 覆盖前端 artifact version 漂移、manifest dependency version 漂移和 dev bootstrap 安装包版本漂移。
  来源：Requirement: Fullstack product version is rooted in root package manifest

## 4. 收尾验证

- [x] 4.1 运行 OpenSpec 严格校验。
  验证：`openspec validate refine-ts-fullstack-packaging-boundary --strict`
  来源：全部 OpenSpec delta
- [x] 4.2 运行 package profile、product manifest、前端包消费、manifest validation、fullstack dev bootstrap command、product version consistency、route precedence、artifact exclusion、toolchain version 和 shared dependency consistency 测试。
  验证：项目对应 tests / checks 全部通过。
  来源：design verification map
- [x] 4.3 执行代码审查，确认本 change 没有把前端页面行为、统一的 release/build/package orchestration、runtime lifecycle ownership、channel transport ownership 或 canonical facts 来源混入当前边界。
  验证：code review 检查点；这些边界跨多个 owner，无法只靠单一单元测试覆盖。
  来源：design non-goals 和 boundary decisions

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/fullstack-packaging-boundary/spec.md`。
- 按需修改 `openspec/specs/ts-backend-architecture/spec.md`。
- 按需修改 `openspec/specs/local-runtime-package/spec.md`。
- 按需更新 `openspec/overview.md`。
- 新增或更新 `openspec/designs/architecture/fullstack-packaging-boundary.md`。
- 按需更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/modules/agent-channel-web.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义前端页面行为、统一的 release/build/package orchestration、runtime lifecycle、channel transport ownership 或 canonical facts 来源。
