## 背景和现状（Context）

当前架构基线把仓库根目录定义为 TS 后端 workspace，并显式排除 `browser UI source` 和 `static asset build behavior`。现在已经明确的新目标是：前端与后端同仓库协作，前端源码位于 `frontend/agent-web`，前端对后端发布的是构建后的 npm 包产物，`agent-app` 负责在同一个 server 中托管前端静态资源并继续提供后端 API/stream 服务。

这不是单纯的“多带一个静态目录”问题，而是同时改变：

- 仓库边界；
- 后端允许依赖的前端产物边界；
- 单 server 交付形态；
- `backend-only` / `with-frontend` 两种 package profile；
- 前后端产品版本一致性；
- Node.js / TypeScript / shared dependency 的一致性治理。

因此，本 change 需要同时刷新架构边界和运行包实施边界，但仍然坚持一个原则：前端 UI 不拥有后端执行事实，后端也不直接消费前端源码。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义同仓库 `frontend/agent-web` 前端源码与后端 workspace 的协作边界。
- 定义前端构建后 npm 包产物 contract，以及 `agent-app` 对该产物的消费边界。
- 定义 `backend-only` / `with-frontend` 两种明确 package/build profile 和可信 profile 选择方式。
- 定义 `agent-app` 的静态资源 route registration ownership，确保同一 server 提供前后端服务且不破坏 API/stream ownership。
- 定义前后端产品版本同步边界，使后端运行包、前端 artifact 和候选 evidence 使用同一产品版本。
- 定义前后端 Node.js、TypeScript 和共同依赖的公共组件版本锁步约束。

**非目标：**

- 不定义前端页面行为、前端状态管理、前端路由设计或 UI 交互细节。
- 不定义统一的 release/build/package orchestration、monorepo task runner 方案或发布流水线编排；这些后置。dev-only `npm run dev:fullstack` bootstrap 属于当前 change 范围。
- 不让后端直接依赖前端源码、frontend-private path 或前端构建工具私有布局。
- 不改变 `agent-channel-web` 的 transport ownership、runtime lifecycle ownership 或 canonical facts 来源。

## 设计决策（Decisions）

### D1. 同仓库允许前端源码存在，但后端只消费前端构建产物

仓库允许存在 `frontend/agent-web` 前端源码目录，但这只表示源码共仓边界成立，不表示后端运行时可以依赖前端源码。后端 `agent-app` 只能消费前端发布出来的构建后 npm 包产物及其 public exports。

这样做的原因是：既接受产品形态从“纯后端仓库”升级为“同仓 fullstack”，又保持后端实现边界不被前端源码和构建器私有布局污染。

### D2. 前端 npm 包 contract 固定为 `@nextagent/agent-web`

前端源码固定在 `frontend/agent-web`，构建后对后端暴露的 npm 包固定为 `@nextagent/agent-web`。后端允许消费的唯一前端托管 contract 是 `@nextagent/agent-web/hosting` public export。该 export 必须固定暴露 `resolveFrontendHostingManifest()`，并返回前端托管 manifest，至少固定以下信息：

- 静态资源目录定位；
- `index.html` 入口定位；
- route base path；
- SPA fallback 是否启用。

`agent-app` 不得 import `frontend/agent-web` 源码、前端私有路径或构建器临时目录。这样可以保证候选运行包、release evidence 和 route registration 都围绕稳定产物，而不是围绕源码工作区状态。

### D3. package/build profile 决定是否挂载前端

系统至少支持两种明确 profile：

- `backend-only`
- `with-frontend`

profile 选择必须来自可信构建参数或打包参数，而不是运行时扫描目录自动发现。`backend-only` 形态下，`agent-app` 不依赖前端包存在，也不注册前端路由；`with-frontend` 形态下，前端包是必需输入，并注册静态资源和前端 route fallback。

这样可以保持 release candidate 形态可审计、可验证，也与现有 `local-runtime-package` 的 backend-only 语义一致。

### D4. 两个产品入口形成唯一实现路径

系统采用两个明确的产品入口：

- `packages/agent-app/src/entrypoints/backend-only.ts`
- `packages/agent-app/src/entrypoints/with-frontend.ts`

两者共享同一后端基础装配，但 `backend-only` 入口只组装后端能力，`with-frontend` 入口在后端能力之外再组装前端托管能力。前端可选化不得通过单一入口中的运行时 `if` 分支实现，而必须通过这两个不同入口和不同依赖图实现。

为了避免 `agent-app/package.json` 把前端依赖带入 `backend-only` 候选运行包，两种交付形态的依赖权威固定为两个专用 product manifest：

- `packages/agent-app/manifests/backend-only.package.json`
- `packages/agent-app/manifests/with-frontend.package.json`

`packages/agent-app/package.json` 只作为 workspace/source manifest，不作为候选运行包依赖权威。`backend-only.package.json` 必须不声明 `@nextagent/agent-app-frontend-hosting` 或 `@nextagent/agent-web`；`with-frontend.package.json` 必须显式声明 `@nextagent/agent-app-frontend-hosting`，并且对 `@nextagent/agent-web` 必须使用标准 npm package dependency 形式和与根版本一致的精确版本。

这样可以保证 `backend-only` 与 `with-frontend` 在产品边界、候选证据和依赖图上都可区分，并为构建阶段裁剪 `backend-only` 产物提供唯一目标路径。

### D5. 静态资源托管 ownership 归 agent-app，不归 agent-channel-web

前端静态资源路由注册由 `agent-app` 负责，因为它是唯一 composition root，负责决定当前 package profile、挂载前端包产物和暴露统一 server。`agent-channel-web` 保持 transport 和 stream projection owner，不接管静态资源托管职责。

这样可以避免 channel adapter 同时拥有 transport 和静态资产托管，导致边界膨胀。

### D6. 前端托管通过 `@nextagent/agent-app-frontend-hosting` 接入

前端静态资源托管和前端 route fallback 都通过独立 package `@nextagent/agent-app-frontend-hosting` 提供的 Fastify 插件接入。该 package 源码位置固定为 `packages/agent-app-frontend-hosting`，并固定暴露 `frontendHostingPlugin`。`agent-app` 只负责在 composition root 中组装该插件。`backend-only` 入口不得依赖或引用该插件 package；`with-frontend` 入口才可依赖、引用并注册该插件。

这样可以把“前端托管能力”稳定收敛为一个可组合、可裁剪、可独立依赖分析的 server 扩展单元，同时保持 `agent-app` 是唯一组装 owner。

### D7. API / stream route precedence 保持稳定

即使启用 `with-frontend`，静态资源 fallback 也不得吞掉：

- `/api/**`
- SSE routes
- WebSocket routes
- control routes

前端 route fallback 只服务非 API 的前端静态资源和前端路由。这样保证同一 server 部署不影响既有后端 contract。

### D8. 构建阶段必须裁剪 backend-only 产物

构建阶段必须以产品入口为边界，对 `backend-only` 产物执行 tree-shaking 或等价的产物裁剪，使其最终交付物中完全不包含：

- 前端托管插件注册逻辑；
- 前端 npm 包产物引用；
- 前端静态资源产物。

`with-frontend` 产物则保留前端托管插件和前端静态资源产物。这里的关键不是运行时“没走到某个分支”，而是 `backend-only` 产物在最终交付物中根本不携带前端托管能力。

### D9. 根 `package.json` 是 toolchain 与 shared dependency 的权威 manifest

仓库根 `package.json` 是前后端 toolchain 与 shared dependency lockstep policy 的唯一权威来源：

- `engines.node` 是前后端共同遵循的 Node.js 版本权威值；
- 根 `devDependencies.typescript` 是前后端共同遵循的 TypeScript 版本权威值；
- 根 manifest 中新增 `x-nextagent.sharedDependencyLockstep` allowlist，用于定义 lockstep 校验范围。

根 `workspaces` 保持只覆盖 `packages/*`。`frontend/agent-web` 通过显式 toolchain/dependency 检查纳入治理，但不是根 workspace 成员；`frontend/agent-web-mock-server` 不在本 change 的 lockstep 治理范围内。

共同依赖锁步不覆盖“仓库里所有重名依赖”，而只覆盖 allowlist 中列出的、且被 `frontend/agent-web`、`agent-app` 或 `@nextagent/agent-app-frontend-hosting` 直接声明的共享依赖。这样可以避免校验范围无限膨胀，同时保持对真正共享依赖的强约束。

选择锁步而不是“尽量一致”，是为了避免前后端构建产物和共享组件在同仓场景下出现隐式漂移。

### D10. `with-frontend` 配置由 profile 和 hosting manifest 唯一确定

`with-frontend` 不引入独立 app-local runtime 配置源。前端托管配置只能由以下两部分共同确定：

- 可信 build/package profile 明确选择 `with-frontend`；
- `@nextagent/agent-web/hosting` 中 `resolveFrontendHostingManifest()` 返回的 hosting manifest。

manifest 是 `with-frontend` 唯一允许的前端托管配置来源。它负责告诉 `@nextagent/agent-app-frontend-hosting`：

- 静态资源目录；
- `index.html` 入口；
- base path；
- 是否启用 SPA fallback。

这样可以避免 profile 已启用但 route base path、asset root 或 fallback 行为又从第二套配置源漂移。

### D11. Hosting manifest 必须通过固定 schema 和路径约束验证

`resolveFrontendHostingManifest()` 返回值必须通过固定 runtime schema 校验，最小字段集固定为：

- `assetRoot`
- `indexHtml`
- `routeBase`
- `spaFallback`

其中：

- `assetRoot` 和 `indexHtml` 必须是包根内相对路径；
- 路径不得是绝对路径；
- 路径不得包含 `..` 穿越；
- 解析后不得逃逸前端包根；
- `indexHtml` 必须解析到存在的文件，且位于 `assetRoot` 之内；
- `routeBase` 必须是以 `/` 开头的规范化 route 前缀；
- `spaFallback` 必须是布尔值。

`with-frontend` profile 下，如果 manifest 缺失、schema 非法、路径越界或目标文件不存在，系统必须 fail closed，以安全启动错误失败；不得静默降级为 `backend-only`。

### D12. 开发阶段提供一条 fullstack bootstrap 启动命令

开发验证阶段必须提供仓库根命令：

- `npm run dev:fullstack`

该命令是 dev-only convenience entry。它必须按固定顺序完成：

1. 准备后端依赖；
2. 准备 `frontend/agent-web` 前端依赖；
3. 构建前端静态产物；
4. 生成最小 `@nextagent/agent-web` artifact package；
5. 通过固定 dev bootstrap 脚本按标准 npm package install 语义安装该前端包；
6. 启动 `with-frontend` 产品入口。

启动后，同一个 Fastify server 必须同时提供：

- 后端 API routes；
- SSE/WebSocket/control routes；
- 前端静态资源；
- 前端 route fallback。

该命令只用于开发同学在本地完整验证 fullstack serving 行为。它不得作为候选运行包 evidence、正式打包入口、release qualification 输入或 release verdict 来源；前端包安装必须通过固定 bootstrap 脚本产生与标准 npm 依赖安装一致的结果，不得改写 `with-frontend.package.json` 或引入 backend-private 文件依赖；不得引入 HMR、Vite dev server 代理或长期运行的前端 watch 流程。正式构建打包仍然由 `backend-only` / `with-frontend` product manifest 和后续 packaging flow 负责。

`@nextagent/agent-web` artifact package 必须只包含后端托管所需的静态构建产物和 `@nextagent/agent-web/hosting` public export。浏览器运行所需的 React、AntD、zustand 等前端运行时代码必须已被前端构建纳入 `dist/` 静态资源；后端静态托管不得依赖 frontend `node_modules`、前端源码目录、Vite dev server 或 CDN。

如果依赖准备失败、前端构建失败、前端包安装失败、hosting manifest 缺失、manifest schema 非法、路径越界或 `index.html` 不存在，`npm run dev:fullstack` 必须 fail closed，不得退回 `backend-only`、不得改用目录扫描、不得继续启动半成品 fullstack server。

### D13. 根 `package.json.version` 是 fullstack 产品版本权威

仓库根 `package.json.version` 是后端运行包和前端 artifact 的唯一产品版本权威。前端构建产生最小 `@nextagent/agent-web` artifact package 时，artifact package 的 `package.json.version` 必须由根版本写入；`packages/agent-app/manifests/with-frontend.package.json` 中对 `@nextagent/agent-web` 的依赖必须使用标准 npm package dependency 形式，并且其精确版本必须等于根版本。

后端不在运行时“同步”前端版本，也不自动拉取或修正前端包。版本同步发生在依赖安装、dev bootstrap、构建和打包装配阶段；`with-frontend` 启动或候选包校验只能读取已安装 `@nextagent/agent-web` 的 package manifest / evidence，并在发现版本不一致时 fail closed。

candidate evidence 必须记录当前 fullstack 产品版本、后端运行包版本、前端 artifact package 版本，以及前端 artifact 的内容 hash 或 build ref。这样 release qualification 可以审计同一候选运行包是否确实由同一版本的前后端产物组成，但不改变 release verdict ownership。

## 关键流程（Key Flow）

1. 在同仓库维护前端源码：前端源码位于 `frontend/agent-web`，但后端不直接消费源码。
2. 构建前端 npm 包：前端发布构建后的 npm 包产物 `@nextagent/agent-web`，artifact package version 由根 `package.json.version` 写入，并提供静态资源和 `resolveFrontendHostingManifest()` public export。
3. 选择可信 package/build profile：构建或打包阶段显式选择 `backend-only` 或 `with-frontend`。
4. 生成运行包：
   - `backend-only`：运行包使用 `packages/agent-app/manifests/backend-only.package.json`，不依赖前端包产物，声明 backend-only evidence；
   - `with-frontend`：运行包使用 `packages/agent-app/manifests/with-frontend.package.json`，以标准 npm package dependency 形式精确依赖 `@nextagent/agent-web`，并要求该依赖版本等于根 `package.json.version`；运行包包含前端包证据，并把前端包产物接入 `agent-app`。
5. 选择对应产品入口：
   - `packages/agent-app/src/entrypoints/backend-only.ts` 只引用后端基础装配；
   - `packages/agent-app/src/entrypoints/with-frontend.ts` 在后端基础装配之外再引用 `@nextagent/agent-app-frontend-hosting` 和 `@nextagent/agent-web/hosting`。
6. 校验前端托管 manifest：
   - `with-frontend` 入口调用 `resolveFrontendHostingManifest()`；
   - 对返回值执行 schema 校验和路径约束校验；
   - manifest 非法或路径越界则 fail closed。
7. 开发 fullstack bootstrap：
   - 当开发同学需要本地验证完整功能时，在仓库根执行 `npm run dev:fullstack`；
   - 该命令按顺序准备后端依赖、准备前端依赖、构建前端、生成版本等于根 `package.json.version` 的 `@nextagent/agent-web` artifact package、通过固定 bootstrap 脚本按标准 npm package install 语义安装该前端包、启动 `with-frontend` 产品入口；
   - 启动前校验前端 artifact version、已安装 `@nextagent/agent-web` 的包版本和根版本一致；
   - 启动后同一个 server 提供后端 API/stream/control routes 和前端静态资源/route fallback；
   - 该命令不生成候选运行包 evidence，不作为正式打包入口或 release qualification 输入。
8. 构建产品产物：
   - `backend-only` 产物对前端托管插件和前端产物完成 tree-shaking 或等价裁剪；
   - `with-frontend` 产物保留前端托管插件和前端产物。
9. `agent-app` 启动：
   - 注册 API/SSE/WebSocket/control routes；
   - 如果产品入口为 `with-frontend`，再注册前端静态资源路由和前端 route fallback。
10. 提供单一 server：
   - 后端服务继续由既有 channel/runtime 路径提供；
   - 前端静态资源由 `agent-app` 托管；
   - route precedence 确保静态 fallback 不吞掉后端 routes。
11. 发布/验收：
   - candidate evidence 声明当前 profile、fullstack 产品版本、后端运行包版本、前端 artifact 版本、前端包证据和 route registration 形态；
   - release qualification 消费这些 evidence，但不改变 verdict ownership。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 后端不消费前端源码或 private path；静态 fallback 不吞掉 API/stream/control routes。 | source assertion、route precedence tests |
| 可靠性/恢复 | `backend-only` 与 `with-frontend` 都是明确可启动形态；profile 选择不依赖运行时探测；`backend-only` 产物中不携带前端托管能力。 | profile startup tests、candidate evidence tests、artifact exclusion tests |
| 可维护性 | `agent-app` 是唯一静态托管注册 owner；前端托管逻辑位于独立 package；`agent-channel-web` 不膨胀为 fullstack host。 | architecture review、dependency boundary tests |
| 可测试性 | 前端包 contract、profile 选择、route precedence、产品版本一致性、toolchain 版本一致性和产物裁剪都有确定性测试入口。 | contract tests、integration tests、consistency checks、artifact tests |
| 可审计性 | candidate evidence 明确记录当前 profile、产品版本和前端包证据。 | release evidence tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 后端只消费 `@nextagent/agent-web/hosting` 和前端静态产物 | 1.1, 2.1 | frontend package consumption tests |
| `backend-only` / `with-frontend` profile 明确且可信 | 1.2, 2.2 | package profile contract tests |
| 两个产品入口形成唯一实现路径 | 1.2, 1.3, 2.2, 2.3, 2.4 | package profile contract tests / architecture review |
| `agent-app` 拥有静态托管注册 ownership | 1.5, 2.4 | architecture/dependency tests |
| route precedence 稳定 | 2.8 | route precedence integration tests |
| 一条命令完成 fullstack 开发 bootstrap 和启动 | 1.8, 2.7 | fullstack dev bootstrap command tests |
| 前后端产品版本以根 `package.json.version` 为权威 | 1.9, 2.12 | product version consistency checks |
| `backend-only` 产物不携带前端能力 | 1.3, 2.3, 2.9 | artifact exclusion tests |
| Node/TS 版本锁步 | 1.7, 2.10 | toolchain version consistency checks |
| 共同依赖版本锁步 | 1.7, 2.11 | shared dependency lockstep checks |
| 统一的 release/build/package orchestration 后置，dev-only bootstrap 已纳入当前 change | 1.6, 4.3 | spec review / code review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/fullstack-packaging-boundary/spec.md`
- 架构刷新：`openspec/specs/ts-backend-architecture/spec.md`
- 运行包接入：`openspec/specs/local-runtime-package/spec.md`
- 架构设计：`openspec/designs/architecture/fullstack-packaging-boundary.md`
- 模块职责：`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-channel-web.md`
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 同仓库前端源码使后端 workspace 边界失焦。 -> 后端只消费前端构建产物，不消费源码。
- [风险] 静态资源 fallback 误吞 API 或 stream route。 -> route precedence tests 必须覆盖 `/api/**`、SSE、WebSocket 和 control routes。
- [风险] 前端可选依赖被实现成运行时目录探测。 -> profile 选择必须来自可信构建/打包参数。
- [风险] 前后端工具链或共享依赖漂移。 -> Node.js、TypeScript 和共享依赖需要锁步检查。
- [风险] 后端运行包和前端 artifact 产品版本漂移。 -> 根 `package.json.version` 作为唯一产品版本权威，dev bootstrap 和打包装配必须校验一致。
- [风险] 统一的 release/build/package orchestration 争论拖慢边界收敛。 -> 明确后置，不作为本 change 验收前提；但 dev-only `npm run dev:fullstack` 已纳入当前 change。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/fullstack-packaging-boundary/spec.md`：新增行为契约。
- `openspec/specs/ts-backend-architecture/spec.md`：补充同仓库前端源码和后端消费前端构建产物的边界。
- `openspec/specs/local-runtime-package/spec.md`：补充 package profile、前端包证据和静态托管接入。
- `openspec/overview.md`：补充 fullstack package profile 交付形态。
- `openspec/designs/architecture/fullstack-packaging-boundary.md`：新增同仓库 fullstack packaging 设计。
- `openspec/designs/modules/agent-app.md`：补充前端包消费和静态托管注册职责。
- `openspec/designs/modules/agent-channel-web.md`：补充静态托管非职责边界。
- `openspec/designs/spec-to-design-map.md`：新增导航。

## 待确认问题（Open Questions）

无。统一的 release/build/package orchestration 已明确后置，不阻塞本 change；dev-only `npm run dev:fullstack` 已在当前 change 内固定。
