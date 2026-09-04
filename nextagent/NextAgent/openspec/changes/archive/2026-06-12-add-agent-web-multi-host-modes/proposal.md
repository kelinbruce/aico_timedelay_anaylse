## 背景与问题（Why）

`frontend/agent-web` 当前已经实现为独立页面应用：前端自己拥有登录、主题、语言、帮助、退出登录、完整页面布局和 history 路由。目标产品集成不只需要这种本地开发形态，还需要被产品框架承载的沉浸式页面，以及通过 Prel/PIU 集成到产品页面内的协作式浮层。

如果继续把这些差异直接堆到当前 `App` 和 `Sidebar` 内，会导致同一套聊天、会话历史、stream 恢复、输入和过程图业务逻辑被不同入口复制或分叉。该问题会扩大后续维护和测试成本，也会让产品集成时无法稳定区分正式产物、测试宿主和本地开发入口。

本 change 的必要性在于：先定义 `agent-web` 的多宿主运行模式、正式构建产物、dev/test-only Prel 测试框架、PIU 事件契约和共享业务核心边界，再进入实现。这样后续实现可以在不改变 Web API、stream event、runtime lifecycle 或 gateway persistence 的前提下，把同一套前端业务代码交付为多个可选择加载的宿主入口。

## 变更范围（What Changes）

- 新增 `agent-web-multi-host-modes` capability，定义 `agent-web` 的本地式、沉浸式和协作式三种 host mode。
- **BREAKING**：正式 `@nextagent/agent-web` artifact 的发布文件名 `index.html` SHALL 由沉浸式源入口 `immersive.html` 构建/装配得到，并固定加载 `<script src="/febs/v1/assets/prelude-loader"></script>`；开发默认 `index.html` SHALL 保持本地式入口，且本地式 `index.html` MUST NOT 进入正式 artifact。
- 正式构建 SHALL 一次产出所有正式可选运行资产：由 `immersive.html` 产出的沉浸式 `index.html`、静态 assets、`piu/AIAgentPIU.js` 和同名样式 `piu/AIAgentPIU.css`。产品运行态按场景选择加载沉浸式页面或 PIU asset。
- 协作式 SHALL 使用一个 PIU 逻辑资产：`AIAgentPIU.js` 及其同名 CSS sidecar `AIAgentPIU.css`。PIU 名称固定为 `AIAgentPIU`，版本来自仓库根 `package.json.version`。`AIAgentPIU` 启动所需资产 SHALL 限定为 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`，不得要求产品额外加载 PIU JS chunk、runtime asset manifest、script-injected JS 或额外 stylesheet。
- 协作式 SHALL 由外部通过 Prel/PIU 事件启动：`window.Prel.autoLoad({ AIAgentPIU: version })` 加载后，由宿主 `piu.emit("loadAIAgent", { containerId })` 指定入口渲染容器。`loadAIAgent` 不再接收 `mode`。
- `AIAgentPIU` SHALL 在 `loadAIAgent` 传入的 `containerId` 内渲染入口 logo；点击 logo 后通过 PIU 内部统一 display state 打开避让顶部菜单的 fixed 浮层。
- 协作式 SHALL 暴露并支持 `loadAIAgent`、`displayAIAgent`、`switchTheme` 和 `sendQuestionToLui` 事件 handler。
- 协作式 panel SHALL 内部支持 docked、floating 和 maximized 三种 layout state。开始拖动 docked panel 后进入 floating；在 `1920px * 1080px` viewport 下 floating 尺寸为 `484px * 756px`，最小 `406px * 636px`，最大宽度 `1112px`；其他分辨率下按可用空间 clamp，不得覆盖 `63.2px` 顶部菜单。
- 非本地模式 SHALL 完全信任 Prel 注入的 `site.session`、`site.user`、`site.locale` 和 `site.theme`；后端 auth challenge 统一跳转固定 `/login-url`。
- 主题枚举统一为 `lightday | evening`，语言枚举统一为 `zh-cn | en-us`。本地式由前端本地设置控制；沉浸式和协作式以 Prel site 和 PIU handler 为准。前端内部 SHALL 将 `lightday` 映射为 AntD light 主题，将 `evening` 映射为 AntD dark 主题。
- 新增 dev/test-only 轻量 Prel 测试框架和协作式测试宿主 `collaborative.html`；本地前后端联调 SHALL 默认打开本地式 `index.html`；沉浸式 dev/test smoke SHALL 打开 `immersive.html`；协作式 dev/test smoke SHALL 打开 `collaborative.html`；这些测试宿主、mock prelude 和本地式 HTML MUST NOT 进入正式 artifact。
- `npm run dev:watch` SHALL continue to be the single source watch command and SHALL expose local, immersive, and collaborative dev entries through one Vite dev server. Development entry URLs SHALL be `/`, `/immersive/`, and `/collaborative/`, and the Vite dev server SHALL serve the mock Prel loader from `/febs/v1/assets/prelude-loader`.
- 修改 `fullstack-packaging-boundary` capability，定义正式前端 artifact 的多宿主资产边界，以及测试宿主和 mock prelude 的正式包排除规则。
- 本 change 不修改 Web API、stream event、runtime command、session/history backend contract、runtime lifecycle、terminal commit、gateway persistence 或 owner/agent scope 语义。
- 协作式会话选择 SHALL 不依赖 URL route 或 `MemoryRouter`；`AIAgentPIU` SHALL 通过内部 active session state 和 `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]` 保存/恢复当前会话，本地式和沉浸式继续使用 URL route。

## Capability 影响（Capabilities）

### 新增 Capability

- `agent-web-multi-host-modes`: 定义 `agent-web` 三种宿主模式、共享业务核心、Prel/PIU 事件契约、显示状态、主题/语言/认证信任边界和 dev/test Prel 测试框架行为。

### 修改的 Capability

- `fullstack-packaging-boundary`: 增加正式 `@nextagent/agent-web` artifact 的多宿主资产边界，明确正式发布文件名 `index.html` 来自 `immersive.html`、`piu/AIAgentPIU.js` 与 `piu/AIAgentPIU.css` 为正式 PIU asset，并禁止把本地式源 `index.html` 发布为正式入口，同时排除源 `immersive.html`、`collaborative.html` 和 mock prelude。

## 影响范围（Impact）

- 前端入口：后续实现会拆分本地式、沉浸式和 PIU 入口，当前 `App.tsx` 需要拆成 providers、shell 和共享业务核心。
- 前端构建：后续实现会新增一次构建产出正式多模式资产的构建入口，在正式构建/装配阶段将 `immersive.html` 产出为正式 `index.html`，并区分正式产物和 dev/test-only 测试宿主。
- 前端测试：需要增加 local/immersive/PIU 入口构建测试、Vite dev 多入口 routing 测试、PIU handler 行为测试、display state 归一化测试、主题/语言同步测试和 dev/test artifact 排除测试。
- 产品集成：正式包发布出去的 `index.html` 语义变为沉浸式入口；产品页面通过 Prel asset registry 加载 `AIAgentPIU.js` 和同名 `AIAgentPIU.css`，并通过 `loadAIAgent` 指定容器。
- 安全与身份：非本地模式完全信任 Prel site 注入的 session/user，不再展示本地登录；auth challenge 跳转固定 `/login-url`。
- 后端边界：后端仍只消费 packaged frontend artifact 和 `@nextagent/agent-web/hosting` public export，不直接消费前端源码或 dev/test mock。
- 运维与发布：正式 artifact 不携带 `collaborative.html` 或 mock prelude；测试框架仅用于本地和自动化验证。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-multi-host-modes/spec.md`：新增三种 host mode、PIU 事件、display state、协作式 layout state、主题/语言、认证和 dev/test 框架行为契约。
- `openspec/specs/fullstack-packaging-boundary/spec.md`：新增正式多宿主前端 artifact 资产边界和 dev/test-only 资产排除规则。

长期背景：
- `openspec/overview.md`：无。该 change 扩展前端交付形态，不改变 NextAgent 电信网络智能体产品范围。

设计视图：
- `openspec/designs/architecture/agent-web-host-modes.md`：归档前新增或更新多宿主前端架构设计，承载 shell/core 分层、Prel/PIU 集成、display state、构建资产和测试框架边界。
- `openspec/designs/architecture/fullstack-packaging-boundary.md`：归档前提炼正式 artifact 由沉浸式发布输出 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css` 组成，以及 dev/test-only 资产排除规则。
- `openspec/designs/modules/agent-app.md`：默认无；除非实现改变 `agent-app` frontend hosting public contract。
- `openspec/designs/modules/agent-channel-web.md`：无。该 change 不改变 channel-web transport 或 stream projection owner。
- `openspec/designs/adr/<id>.md`：无。正式 `index.html` 语义和 PIU JS + 同名 CSS sidecar 取舍可保存在 architecture 设计中，不需要单独 ADR。
- `openspec/designs/spec-to-design-map.md`：归档前补充 `agent-web-multi-host-modes` 到架构设计和验证入口的导航。

验证入口：
- `openspec validate add-agent-web-multi-host-modes --strict`
- 前端入口/构建测试：验证开发默认 `index.html` 为本地式，`immersive.html` 为沉浸式，`collaborative.html` 为协作式测试宿主，正式 build 含由 `immersive.html` 产出的 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`，且正式 `index.html` 不得来自本地式源入口，正式包不含源 `immersive.html`、`collaborative.html` 和 mock prelude。
- 前端组件/状态测试：验证共享业务核心不复制、PIU display state、`loadAIAgent`、`displayAIAgent`、`switchTheme`、`sendQuestionToLui`。
- 前端测试宿主/E2E：验证 `npm run dev:watch` 的一个 Vite dev server 同时暴露 `/`、`/immersive/` 和 `/collaborative/`，验证 dev/test Prel mock 可通过固定 `/febs/v1/assets/prelude-loader` 路径驱动 `collaborative.html`，并覆盖 docked、floating、maximized 交互。
- packaging boundary regression tests：验证 backend 仍只消费 packaged frontend artifact 和 hosting export。
