## 1. 共享业务核心和模式壳层

- [x] 1.1 抽出 `AppProviders`，承载 AntD、i18n、theme、runtime config 和全局样式初始化，使不同入口可以复用同一 provider 层。
  验证：新增/更新前端 app entry shell tests，断言 provider 层在 local、immersive、piu entry 中复用；运行 `npm test -- tests/app-entry-shell.test.ts` 或对应前端 Vitest 文件。
  来源：Agent-web supports three host modes with one business core；Design D1。

- [x] 1.2 抽出 `ChatWorkspace`，把当前聊天、会话、stream、输入、请求控制、附件和过程图业务保留在共享组件/控制器内，模式 shell 不复制这些业务逻辑。
  验证：组件测试覆盖 local/immersive/PIU shell 均渲染同一 `ChatWorkspace`；code review 检查点：无 mode-specific session history、stream continuity、request submit/cancel/retry/edit、attachment 或 run-process detail 业务副本。
  来源：Agent-web supports three host modes with one business core；Design D1。

- [x] 1.3 将本地 Sidebar 的 session navigation 与本地设置类动作拆开，使 local/immersive 可复用左侧历史导航，而 immersive 能隐藏本地 settings/help/logout/theme/locale controls。
  验证：Sidebar/shell component tests 断言 local 显示本地 controls、immersive 隐藏本地 controls 且保留 session/history navigation。
  来源：Immersive mode is the formal page entry；Local mode remains a dev and test standalone page；Design D2。

- [x] 1.4 为 composer/controller 增加受控问题注入能力，支持 `sendQuestionToLui` 填入草稿或提交，禁止通过 DOM 查询直接写 textarea。
  验证：composer controller tests 覆盖 `isSend` 缺省只填入、`isSend=true` 提交；code review 检查点：`sendQuestionToLui` 不使用 `document.querySelector` 修改 composer value。
  来源：PIU handlers control theme and question injection；Design D7。

## 2. 本地式和沉浸式页面入口

- [x] 2.1 保持开发默认 `index.html` 为 local entry，使前后端本地联调默认打开 `index.html`，确保本地式不加载 `/febs/v1/assets/prelude-loader`，通过 `/src/entries/local.tsx` 启动，并保留本地登录、主题、语言、帮助、退出登录、完整页面和 browser history route。
  验证：HTML/entry tests 断言源 `index.html` 不包含 prelude script 且加载 `/src/entries/local.tsx`；local dev/test 启动文档或脚本指向默认 `index.html`；local shell tests 断言本地 controls 可见。
  来源：Local mode remains a dev and test standalone page；Design D2。

- [x] 2.2 新增 `immersive.html` 作为沉浸式源入口，固定在 HTML 中加载 `<script src="/febs/v1/assets/prelude-loader"></script>`，通过 `/src/entries/immersive.tsx` 启动，并确保正式构建/装配阶段将其产出为正式 `dist/index.html`。
  验证：HTML/entry tests 断言 `immersive.html` 为 immersive entry、包含精确 script 且加载 `/src/entries/immersive.tsx`；build output test 断言正式 `dist/index.html` 来自沉浸式入口且包含精确 script；`openspec validate add-agent-web-multi-host-modes --strict`。
  来源：Immersive mode is the formal page entry；Formal index is immersive and loads Prel；Design D2。

- [x] 2.3 实现 immersive Prel site adapter：读取 `site.session`、`site.user`、`site.locale`、`site.theme`，隐藏本地身份/偏好 controls，并为 `63.2px` 顶部菜单留出布局空间。
  验证：immersive shell tests 注入 mock site，断言 locale/theme 生效、local login/settings/help/logout/theme/locale controls 隐藏、内容区域避让 63.2px；negative test 断言 immersive 不调用 `Prel.autoLoad({ AIAgentPIU })` 且不触发 `loadAIAgent`。
  来源：Non-local modes trust Prel site context；Prel and PIU lifecycle is explicit per host mode；Immersive mode is the formal page entry；Design D3/D4。

- [x] 2.4 实现非本地模式 auth challenge 处理：immersive、collaborative 收到 backend auth challenge 时跳转固定 `/login-url`，不渲染 local login。
  验证：auth challenge tests 覆盖两种非本地 mode；negative test 断言非本地模式不显示 local login page。
  来源：Non-local modes trust Prel site context；Design D3。

## 3. AIAgentPIU 入口和浮层行为

- [x] 3.1 新增 PIU entry，构建产物名固定为 `AIAgentPIU.js` 并输出同名 `AIAgentPIU.css`，运行时在 `Prel.ready` 后调用 `Prel.start("AIAgentPIU", packageVersion, ["session", "user", "locale", "theme"], ...)`，并通过 `piu.attach` 注册 handler。
  验证：PIU entry tests 断言 `Prel.ready -> Prel.start -> piu.attach` 顺序、name、version 来源、deps 和 handler registration；negative test 断言 `Prel.autoLoad` 仅加载资产，不会在 `loadAIAgent` emit 前渲染 logo 或 panel；build test 断言输出 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`。
  来源：Prel and PIU lifecycle is explicit per host mode；AIAgentPIU starts through Prel and loadAIAgent；Frontend artifact publishes multi-host formal assets；Design D4。

- [x] 3.2 实现 `loadAIAgent({ containerId })`：定位容器并渲染入口 logo，layout state 保持在 `AIAgentPIU` 内部，不接受宿主传入 `mode`。
  验证：PIU handler tests 覆盖 valid container、repeated container、different container、container not found failure path；negative test 断言 `mode` 不参与 `loadAIAgent` contract。
  来源：AIAgentPIU starts through Prel and loadAIAgent；Design D4。

- [x] 3.3 实现单 active instance 策略：同一 `containerId` 复用 React root，不同 `containerId` 迁移入口并保持唯一实例。
  验证：PIU lifecycle tests 断言 repeated same container 不重复 mount，different container 后旧容器不再拥有 active entrance。
  来源：AIAgentPIU starts through Prel and loadAIAgent；Design D4。

- [x] 3.4 实现 `displayAIAgent` display state reducer，覆盖四种状态组合，并让 logo click 与 close button 都走同一状态源。
  验证：PIU display state tests 覆盖 `false,false`、`true,false`、`true,true`、`false,true` 归一化；close button 保留当前 `showEntrance`。
  来源：PIU display state has one authority；Design D5。

- [x] 3.5 实现 `switchTheme("lightday" | "evening")`，同步更新 React theme state、AntD theme 和 `document.documentElement[data-theme]`，其中 `lightday` 映射 AntD light tokens，`evening` 映射 AntD dark tokens。
  验证：theme tests 断言三者一起更新，且 `lightday/evening` 分别映射到 AntD light/dark tokens；negative test 断言非 `lightday|evening` 输入不改变当前主题。
  来源：PIU handlers control theme and question injection；Non-local modes trust Prel site context；Design D3。

- [x] 3.6 实现协作式 docked/floating/maximized layout reducer：默认 docked 右侧宽 484px、高 `calc(100vh - 63.2px)`；拖动后进入 floating；最大化在 host 页面内完成并可还原。
  验证：layout tests 和 browser smoke 覆盖 docked 默认位置、resize、drag、maximize/restore、top menu 不覆盖。
  来源：Collaborative panel has docked, floating, and maximized layouts；Design D6。

- [x] 3.7 实现 floating 尺寸规则：`1920px × 1080px` viewport 下拖动后窗口为 `484px × 756px`，最小 `406px × 636px`，最大宽度 `1112px`；其他分辨率按可用空间 clamp。
  验证：layout tests 或 Playwright viewport tests 覆盖 1920×1080 精确尺寸、min resize、max width、short viewport clamp、顶部菜单不覆盖。
  来源：Collaborative panel has docked, floating, and maximized layouts；Design D6。

- [x] 3.8 实现 PIU chrome 图标动作：新建会话、历史 popover、浮动/停靠、最大化/还原、关闭；历史 popover 默认最近 10 条并滚动加载更多。
  验证：PIU chrome component tests 覆盖 icon actions；history popover tests 断言初始 10 条和 scroll load more。
  来源：PIU chrome exposes lightweight actions；Design D6。

- [x] 3.9 实现 `sendQuestionToLui({ question, isSend })`：面板隐藏时自动打开；`isSend` 缺省为 `false` 只填入；`isSend=true` 提交。
  验证：PIU handler + composer tests 覆盖 panel hidden、draft only、submit path、empty/invalid question failure path。
  来源：PIU handlers control theme and question injection；Design D7。

- [x] 3.10 修复左侧停靠拖动进入浮动时的锚点，使左侧停靠进入浮动后保持左侧初始位置，不跳到右侧默认浮窗位置。
  验证：`npm test -- tests/piu-state.test.ts`；浏览器 QA 打开 `/collaborative/?dock=left` 并拖动顶部标题栏，确认面板仍位于左侧附近。
  来源：Collaborative panel has docked, floating, and maximized layouts。

## 4. 构建产物和测试宿主

- [x] 4.1 新增正式多模式构建命令，例如 `npm run build:vite:modes`，由一个编排脚本将 `immersive.html` 构建/装配为正式 `index.html`，同时产出静态 assets、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`，缺失任一正式资产或 `AIAgentPIU` 需要额外运行资产时 fail closed。
  验证：build script tests 断言构建 target 顺序、缺失资产 fail closed、`AIAgentPIU.js` 无额外 chunk/manifest/script injection 运行依赖、`AIAgentPIU.css` 无额外 stylesheet 运行依赖；运行 `npm run build:vite:modes`。
  来源：Multi-host build is one formal build output；Design D8。

- [x] 4.2 实现 dev/test-only 轻量 Prel mock，固定通过 Vite dev/test middleware 在 `/febs/v1/assets/prelude-loader` 服务，提供 `ready`、`autoLoad`、`start`、`piu.attach`、`piu.emit` 和 site context；开发态 `Prel.autoLoad({ AIAgentPIU: version })` 必须映射到源码 PIU entry `/src/entries/piu.tsx`，不得读取 `dist/piu/AIAgentPIU.js` 或 `dist/piu/AIAgentPIU.css`。
  验证：Prel mock tests 断言固定路径、API 行为、`autoLoad` 加载源码 PIU entry、`start` 注入 site context、`attach` 注册 handler、host `piu.emit("loadAIAgent", ...)` 能触发 PIU handler；negative test 断言 mock prelude 不来自 `public/` 且不读取正式 PIU dist 产物。
  来源：Prel and PIU lifecycle is explicit per host mode；Dev Prel test framework supports PIU verification only；Source watch exposes all host modes through one Vite server；Design D4/D9/D10。

- [x] 4.3 实现 Vite dev/test routing 和 `dev:watch` 入口输出：一个 Vite dev server 暴露 `/`、`/index.html`、本地 history fallback、`/immersive/`、`/immersive/**`、`/immersive.html`、`/collaborative/`、`/collaborative/**`、`/collaborative.html` 和 `/febs/v1/assets/prelude-loader`；`/api/**`、Vite internal client/HMR、source module 和 static asset 路径不得进入 HTML fallback；设置 `strictPort: true`；`dev:watch` 按有效 host 打印 Local、Immersive、Collaborative 三个 URL；`dev:watch` 不运行 `npm run build:vite:modes`、artifact assembly、artifact install 或 `with-frontend`，也不得创建或更新正式 build outputs。
  验证：Vite routing tests 断言 URL 到 HTML/source mock 的映射、本地 history route fallback 到 `index.html`、`/api/**` 不进入 fallback、Vite internal/source/static asset 路径不进入 fallback；dev-watch plan tests 断言 frontend process 仍为一个 Vite server、URL 输出使用 `VITE_DEV_HOST` 覆盖后的 host、strictPort 配置存在、端口冲突 fail closed、不调用 `build:vite:modes`/artifact assembly/artifact install/`with-frontend`；使用 command spy、mtime 或临时输出目录断言 `dev:watch` 不创建或更新 `dist/index.html`、`dist/piu/AIAgentPIU.js` 或 `dist/piu/AIAgentPIU.css`。
  来源：Source watch exposes all host modes through one Vite server；Design D10。

- [x] 4.4 新增协作式测试宿主 `collaborative.html`，加载固定 prelude path，通过 `/src/entries/collaborative.ts` 启动，并通过 mock `Prel.autoLoad({ AIAgentPIU: version })` 加载源码 PIU entry；mock 顶部菜单右侧提供固定 `id="ai-agent-container"` 的测试 container，`autoLoad` 完成后自动 `piu.emit("loadAIAgent", { containerId: "ai-agent-container" })`。
  验证：HTML/entry tests 断言 `collaborative.html` 包含固定 prelude script 且加载 `/src/entries/collaborative.ts`；Playwright 或等效 browser smoke 打开 `/collaborative/` 和 `/collaborative.html`，断言测试宿主自动 `Prel.autoLoad({ AIAgentPIU: version })`，再通过 host `piu.emit("loadAIAgent", { containerId: "ai-agent-container" })` 触发 logo 渲染；断言 docked/floating/maximized layout 生效、点击打开浮层、顶部菜单不被覆盖。
  来源：Prel and PIU lifecycle is explicit per host mode；Dev Prel test framework supports PIU verification only；Source watch exposes all host modes through one Vite server；Design D4/D9/D10。

- [x] 4.5 新增正式 artifact allowlist/denylist 检查：正式包必须包含由 `immersive.html` 产出的 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`，不得包含源 `immersive.html`、`collaborative.html`、`collaborative.html` dev/test host 生成的 JS/CSS/assets 或 mock prelude，也不得把本地式源 `index.html` 复制为正式入口；`AIAgentPIU` 启动所需资产必须限定为 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`。
  验证：artifact packaging tests 断言 include/exclude、正式 `index.html` 含 prelude 且不含本地式 controls、`dist/piu/` 中不存在 `AIAgentPIU` 运行必需的第三个资产；negative tests 通过注入 forbidden test asset fixture、`collaborative.html` fixture、collaborative dev/test host generated chunk fixture 和 extra PIU chunk fixture 实际触发失败。
  来源：Frontend artifact publishes multi-host formal assets；Dev and test host assets are excluded from formal artifact；Design D8/D9/D10。

- [x] 4.6 更新 `@nextagent/agent-web/hosting` artifact assembly，使正式 hosting manifest 指向沉浸式 `index.html`，并继续满足现有 manifest schema/path-bound 规则。
  验证：fullstack packaging boundary tests 断言 manifest `indexHtml` 指向正式 `index.html`，路径仍在 asset root 内；现有 manifest validation tests 通过。
  来源：Formal index is immersive and loads Prel；With-frontend hosting configuration has one authority path；Design D11。

## 5. 边界回归和收尾验证

- [x] 5.1 验证后端仍只消费 packaged frontend artifact 和 `@nextagent/agent-web/hosting` public export，不 import `frontend/agent-web` 源码、测试宿主或 mock prelude。
  验证：architecture/dependency tests 或 existing fullstack packaging boundary tests；code review 检查点：`agent-app`、`agent-app-frontend-hosting` 无 frontend source/private path/mock prelude import。
  来源：Backend consumes only packaged frontend artifacts；Design D11。

- [x] 5.2 运行 OpenSpec strict validation。
  验证：`openspec validate add-agent-web-multi-host-modes --strict`。
  来源：OpenSpec delta validity。

- [x] 5.3 运行前端相关单元/组件测试，覆盖 entry shells、固定 entry 文件、Vite dev routing、本地 history fallback、mock prelude、PIU handlers、display state、layout、theme/locale、composer injection、artifact checks。
  验证：`npm test -- <相关前端测试文件>` 或前端 package 对应 Vitest 命令。
  来源：Design Verification Map。

- [x] 5.4 运行构建和架构边界验证，确认多模式构建产物、TypeScript project references 和 packaging boundary 未破坏。
  验证：`npm run build`、`npm run build:vite:modes`、`npm run lint:architecture`。
  来源：AGENTS.md 验证门禁；Design Quality Attributes。

- [x] 5.5 执行实现后 code review 检查：确认无新依赖、无业务逻辑复制、无 mock/test HTML 进入正式 artifact、无后端 API/stream/runtime/gateway contract 改动。
  验证：code review 检查点；必要时使用 `$nextagent-code-review` 作为 push 前语义检视。
  来源：proposal non-goals；Design D1/D8/D9/D10/D11；AGENTS.md push 前检视要求。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/agent-web-multi-host-modes/spec.md`，合入三种 host mode、PIU lifecycle、display state、协作式 layout state、主题/语言、认证和 dev/test mock 行为契约。
- 同步 `openspec/specs/fullstack-packaging-boundary/spec.md`，合入正式多宿主 artifact 资产边界和 dev/test asset 排除规则。
- 新增或更新 `openspec/designs/architecture/agent-web-host-modes.md`，提炼 Shell/Core 分层、入口和构建 target、Prel/PIU lifecycle、display state、浮层布局、dev watch 多入口 routing 和 mock 测试框架。
- 更新 `openspec/designs/architecture/fullstack-packaging-boundary.md`，提炼正式 artifact 从单页面包扩展为沉浸式页面 + PIU asset 的边界。
- 更新 `openspec/designs/spec-to-design-map.md`，补充 `agent-web-multi-host-modes` 到设计和验证入口的导航。
- 默认不更新 `openspec/overview.md`、`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-channel-web.md` 或 ADR；除非实现实际改变相应长期事实。

## 6. Collaborative session navigation state

- [x] 6.1 Split chat navigation from React Router so the shared chat/session business core can receive a host navigation adapter.
  Verification: local and immersive still render `/` and `/session/:sessionId` through URL routing; PIU can render the same core without `MemoryRouter`.
  Source: Collaborative session selection uses PIU state; Design D12.

- [x] 6.2 Persist collaborative active session id in `sessionStorage` using the exact key `nextagent:AIAgentPIU:activeSessionId`.
  Verification: history selection writes the key, new session removes the key, and submitting from the PIU welcome state stores the created session id.
  Source: Collaborative session selection uses PIU state; Design D12.

- [x] 6.3 Restore collaborative active session id from `sessionStorage` after host page reload and clear it when restored conversation loading fails.
  Verification: component/unit tests cover restore and failure clearing without changing the host page URL.
  Source: Collaborative session selection uses PIU state; Design D12.

- [x] 6.4 Run targeted validation and review for the routing boundary.
  Verification: `npm test -- tests/piu-runtime-contract.test.tsx tests/chat-page.route-state.test.tsx`, `openspec validate add-agent-web-multi-host-modes --strict`, and code review confirm local/immersive URL routing is preserved while PIU owns session selection internally.
  Source: Verification Map; Design D12.

## 7. Immersive fixed Prel menu layout refinement

- [x] 7.1 Treat the real immersive Prel menu as product-framework chrome: do not render mock menu chrome, do not add page-owned `margin-top`/`padding-top`, keep the immersive page full-viewport, and keep local controls hidden.
  Verification: entry/layout tests and browser smoke confirm successful immersive startup keeps `#root` full-viewport while Prel-unavailable fallback also remains full-viewport.
  Source: Immersive mode is the formal page entry; Design D2.

- [x] 7.2 Keep conversation scrolling on the existing `right-pane-scroll-viewport` and fix outer height constraints without changing bottom-following, user-scroll-away, new-message, or older-history anchor behavior.
  Verification: `npm test -- tests/chat-page.route-state.test.tsx tests/useChatViewportController.test.tsx tests/right-pane-layout.scroll-shell.test.tsx`.
  Source: Immersive conversation content scrolls below the fixed top menu; Design D2.

- [x] 7.3 Keep the collaborative test host menu material available by making the dev/test mock Prel menu participate in document flow while preserving PIU fixed-panel top-menu avoidance.
  Verification: `npm test -- tests/app-entry-shell.test.ts tests/piu-runtime-contract.test.tsx tests/piu-state.test.ts`.
  Source: Dev Prel test framework supports PIU verification only; Design D9.

- [x] 7.4 Keep the fixed prelude script in immersive dev/test while suppressing visible mock menu chrome and page-owned top spacing; render the mock top menu only for collaborative host-page testing.
  Verification: `npm test -- tests/app-entry-shell.test.ts tests/immersive-entry.test.tsx`, browser smoke for `/immersive/` and `/collaborative/`.
  Source: Dev Prel test framework supports PIU verification only; Design D9.
