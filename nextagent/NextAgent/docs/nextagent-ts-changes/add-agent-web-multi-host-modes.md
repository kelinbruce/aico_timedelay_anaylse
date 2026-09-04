# `add-agent-web-multi-host-modes`

状态：active
类型：implementation
主要 owner：公续平
依赖：
- [`refine-ts-fullstack-packaging-boundary`](refine-ts-fullstack-packaging-boundary.md)

目标：
- 定义 `agent-web` 本地式、沉浸式和协作式三种宿主运行模式，共享业务核心。
- 正式 `@nextagent/agent-web` artifact 的发布文件名 `index.html` 由沉浸式源入口 `immersive.html` 构建/装配得到，并固定加载 `<script src="/febs/v1/assets/prelude-loader"></script>`。
- 开发默认 `index.html` 保持本地式入口，且本地式 `index.html` 不得进入正式 artifact。
- 正式构建一次产出所有正式可选运行资产：由 `immersive.html` 产出的沉浸式 `index.html`、静态 assets、`piu/AIAgentPIU.js` 和同名样式 `piu/AIAgentPIU.css`。
- 协作式使用一个 PIU 逻辑资产 `AIAgentPIU.js` 及其同名 CSS sidecar `AIAgentPIU.css`，由外部通过 Prel/PIU 事件启动。
- 新增 dev/test-only 轻量 Prel 测试框架和协作式测试宿主 `collaborative.html`，这些测试宿主和 mock prelude 不得进入正式 artifact。

规格输入：
- `agent-web-multi-host-modes` capability 定义三种 host mode、共享业务核心、Prel/PIU 事件契约、显示状态、主题/语言/认证信任边界和 dev/test Prel 测试框架行为。
- `fullstack-packaging-boundary` capability 增加正式多宿主前端 artifact 资产边界，明确正式发布文件名 `index.html` 来自 `immersive.html`、`piu/AIAgentPIU.js` 与 `piu/AIAgentPIU.css` 为正式 PIU asset，并禁止把本地式源 `index.html` 发布为正式入口，同时排除源 `immersive.html`、`collaborative.html` 和 mock prelude。

契约输入：
- 本 change 不修改 Web API、stream event、runtime command、session/history backend contract、runtime lifecycle、terminal commit、gateway persistence 或 owner/agent scope 语义。
- 后端仍只消费 packaged frontend artifact 和 `@nextagent/agent-web/hosting` public export，不直接消费前端源码或 dev/test mock。

实现约束：
- 前端入口拆分为本地式、沉浸式和 PIU 入口，当前 `App.tsx` 拆成 providers、shell 和共享业务核心。
- 前端构建新增一次构建产出正式多模式资产的构建入口，在正式构建/装配阶段将 `immersive.html` 产出为正式 `index.html`，并区分正式产物和 dev/test-only 测试宿主。
- 非本地模式完全信任 Prel 注入的 `site.session`、`site.user`、`site.locale` 和 `site.theme`；后端 auth challenge 统一跳转固定 `/login-url`。
- 主题枚举统一为 `lightday | evening`，语言枚举统一为 `zh-cn | en-us`。本地式由前端本地设置控制；沉浸式和协作式以 Prel site 和 PIU handler 为准。
- 协作式会话选择不依赖 URL route 或 `MemoryRouter`；`AIAgentPIU` 通过内部 active session state 和 `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]` 保存/恢复当前会话，本地式和沉浸式继续使用 URL route。
- `npm run dev:watch` 继续作为单一 source watch 命令，通过一个 Vite dev server 暴露 local、immersive 和 collaborative dev 入口，开发入口 URL 为 `/`、`/immersive/` 和 `/collaborative/`，Vite dev server 从 `/febs/v1/assets/prelude-loader` 服务 mock Prel loader。

非目标：
- 不修改后端 Web API、stream event、runtime lifecycle、terminal commit、gateway persistence 或 owner/agent scope。
- 不引入新的后端 contract 或改变现有后端边界。
- 不实现远程 AgentRegistry discovery 或远端 Agent 执行。
- 不实现长期记忆、artifact download 或 bounded parallel execution。

验收要点：
- `openspec validate add-agent-web-multi-host-modes --strict` 通过。
- 前端入口/构建测试验证开发默认 `index.html` 为本地式，`immersive.html` 为沉浸式，`collaborative.html` 为协作式测试宿主，正式 build 含由 `immersive.html` 产出的 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`，且正式 `index.html` 不得来自本地式源入口，正式包不含源 `immersive.html`、`collaborative.html` 和 mock prelude。
- 前端组件/状态测试验证共享业务核心不复制、PIU display state、`loadAIAgent`、`displayAIAgent`、`switchTheme`、`sendQuestionToLui`。
- 前端测试宿主/E2E 验证 `npm run dev:watch` 的一个 Vite dev server 同时暴露 `/`、`/immersive/` 和 `/collaborative/`，验证 dev/test Prel mock 可通过固定 `/febs/v1/assets/prelude-loader` 路径驱动 `collaborative.html`，并覆盖 docked、floating、maximized 交互。
- Packaging boundary regression tests 验证 backend 仍只消费 packaged frontend artifact 和 hosting export。
- `npm run build`、`npm run build:vite:modes`、`npm test`、`npm run lint:architecture` 通过。

并行边界：
- 不得修改 Web API、stream event、runtime command、session/history backend contract、runtime lifecycle、terminal commit、gateway persistence 或 owner/agent scope 语义。
- 不得侵入 `agent-app`、`agent-channel-web`、`agent-runtime`、`agent-core`、`agent-context-engine`、`agent-model`、`agent-capability`、`agent-attachment-runtime`、`agent-memory`、`agent-platform-gateway-local`、`agent-platform-gateway-remote` 或 `agent-observability` 的 public contract 或实现。
- 后端模块不得 import `frontend/agent-web` 源码、测试宿主或 mock prelude。
