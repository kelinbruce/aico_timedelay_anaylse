## 背景和现状（Context）

当前 `frontend/agent-web` 是单入口 Vite 应用：`index.html` 挂载 `#root`，`src/main.tsx` 直接渲染 `App`，`App` 内固定组合 `BrowserRouter`、`Sidebar` 和 `ChatPage`。`Sidebar` 同时承载新建会话、历史会话、设置、主题、语言、帮助和退出登录；`ChatPage` 承载会话路由、stream 连接、历史加载、输入、停止、重试、编辑、附件和过程图。

该结构适合本地独立页面，但不适合产品多宿主交付。目标产品需要：

- 本地式：保留当前独立页面能力，但仅作为 dev/test 入口。
- 沉浸式：正式页面入口，由 Prel 加载产品框架顶部菜单，前端隐藏本地设置类动作。
- 协作式：通过 `AIAgentPIU.js` 和同名 `AIAgentPIU.css` 集成到产品页面，默认右侧停靠浮层，支持可调宽度、拖动浮窗和 host-page 最大化。

相关约束：

- 开发默认 `index.html` 必须保持本地式入口，不加载 Prel；沉浸式源入口使用 `immersive.html`；正式 artifact 的 `index.html` 必须由 `immersive.html` 构建/装配得到并加载 `/febs/v1/assets/prelude-loader`。
- 正式包不包含本地式 HTML、`collaborative.html` 或 mock prelude。
- 协作式必须使用一个 PIU 逻辑资产，名称为 `AIAgentPIU`，输出 `AIAgentPIU.js` 和同名 `AIAgentPIU.css`，版本来自根 `package.json.version`。
- API 同源，非本地模式完全信任 Prel 注入的 `session/user/locale/theme`。
- 本 change 不改变后端 Web API、stream、runtime lifecycle、terminal commit、gateway persistence 或 owner/agent scope。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 把当前前端拆成共享业务核心和模式 shell，使三种 host mode 共用同一套聊天、会话、stream 和输入业务代码。
- 定义正式产物：由 `immersive.html` 产出的沉浸式 `index.html`、静态 assets、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`。
- 定义 dev/test-only 产物：本地式源 `index.html`、沉浸式源 `immersive.html`、协作式测试宿主 `collaborative.html`、轻量 Prel mock。
- 定义 `AIAgentPIU` 的 Prel lifecycle、`loadAIAgent` 启动方式、display state、docked/floating/maximized 布局、主题/语言/认证信任边界和对外 handler。
- 定义一次正式构建产出所有正式模式资产的构建边界。
- 保持后端只消费 packaged frontend artifact 和 `@nextagent/agent-web/hosting` public export。

**非目标：**

- 不新增或修改 Web API、stream event、runtime command、session/history backend contract 或 persistence schema。
- 不改变 request lifecycle、stream replay、terminal commit、runtime recovery 或 gateway transaction 语义。
- 不引入新的前端 runtime dependency。
- 不实现完整真实 Prel/febs asset registry；只实现测试所需轻量 mock。
- 不把协作式做成独立业务前端或复制 `ChatPage` 业务逻辑。
- 不支持多个 `AIAgentPIU` 实例同时独立运行；本 change 固定为单 active instance。

## 设计决策（Decisions）

### D1. 前端按 Providers、Shell、ChatWorkspace 三层拆分

唯一实现路径是把当前 `App` 拆成三层：

```text
AppProviders
  -> HostModeShell
      -> ChatWorkspace
```

- `AppProviders` 承载 AntD `ConfigProvider`、i18n、theme state、runtime bootstrap 和全局样式。
- `HostModeShell` 按模式分为 `LocalShell`、`ImmersiveShell`、`PiuShell`。
- `ChatWorkspace` 承载当前 `ChatPage` 中与会话、历史、stream、输入、请求控制、附件和过程图相关的业务行为。

`Sidebar` 的本地 page chrome 行为不再直接等同于所有模式的导航。会话历史能力下沉为可复用 session navigation model，`LocalShell` 和 `ImmersiveShell` 可以用左侧导航呈现，`PiuShell` 用右上角 history popover 呈现。

拒绝方案：

- 在当前 `App.tsx` 内用大量 `if mode` 分支控制所有差异。拒绝原因：模式差异会污染业务主体，难以验证业务核心未复制。
- 为 PIU 入口复制一套 `ChatPage`。拒绝原因：stream continuity、session history、request controls 任何修复都必须多处同步，违反共用业务核心约束。

### D2. 开发默认 index.html 保持本地式，immersive.html 构建为正式 index.html

开发态和发布态必须分开命名语义：

- 开发默认入口 `index.html` 保持本地式。它不加载 Prel，继续拥有本地登录、主题、语言、帮助、退出登录、完整页面布局和 browser history route。
- 沉浸式源入口使用 `immersive.html`，用于沉浸式 dev/test smoke。
- 正式构建/装配阶段必须将 `immersive.html` 产出为正式 artifact 中的 `index.html`，正式 artifact 不得把本地式源 `index.html` 复制为正式入口，也不得发布源 `immersive.html`。
- `immersive.html` 以及由它产出的正式 `index.html` 必须包含固定脚本：

```html
<script src="/febs/v1/assets/prelude-loader"></script>
```

沉浸式入口使用 Prel site context，隐藏本地 settings/help/logout/theme/locale control，保留左侧会话历史导航，但不在前端页面内为产品顶部菜单渲染占位或额外 spacing。

真实 Prel 顶部菜单是 `position: fixed` 覆盖在浏览器顶部，并由产品框架拥有布局策略。因此沉浸式不得在 HTML 中静态渲染菜单，也不得在 Prel 成功或不可用时永久压缩页面高度。唯一实现路径是：`immersive.html` 只加载固定 prelude script 和页面 bundle；`#root` 和沉浸式业务 shell 保持完整视口挂载容器；`window.Prel` 不存在或 startup 抛错时渲染完整视口 fallback，不展示 local login。

沉浸式会话滚动必须保持在现有 `right-pane-scroll-viewport`。外层 `body/#root/ImmersiveShell/main` 只负责固定高度链和 `overflow: hidden`，不得把滚动迁移到 `window`、`body` 或新的滚动容器。这样长会话的滚动条范围从业务区开始，不包含 fixed 顶部菜单，同时保留底部追随、用户回滚后新消息不追底、历史消息加载后的阅读锚点补偿。

拒绝方案：

- 开发默认 `index.html` 同时承担沉浸式。拒绝原因：会破坏当前前后端本地联调体验，并让默认 dev root 依赖 Prel。
- 正式包直接发布 `immersive.html`。拒绝原因：产品托管和发布约定要求正式页面文件名为 `index.html`。

### D3. 非本地模式使用 Prel site context 作为身份和偏好权威

非本地模式只接受 Prel 注入的 host context：

```ts
type HostTheme = "lightday" | "evening";
type HostLocale = "zh-cn" | "en-us";
```

`site.session` 和 `site.user` 被视为可信产品身份。本地登录页只属于 local mode。非本地模式收到后端 auth challenge 后统一跳转固定 `/login-url`。

`switchTheme("lightday" | "evening")` 必须同步更新 React theme state、AntD theme 和 `document.documentElement[data-theme]`。主题适配层固定将 `lightday` 映射为 AntD light algorithm/tokens，将 `evening` 映射为 AntD dark algorithm/tokens；`document.documentElement[data-theme]` 保留 host 原始主题值 `lightday` 或 `evening`。沉浸式初始 theme/locale 来自 Prel site；PIU 初始 theme/locale 也来自 Prel site，后续可由 PIU handler 更新。

拒绝方案：

- 非本地模式继续展示 local login 或 local theme/locale controls。拒绝原因：产品框架已经拥有这些能力，会造成双 owner。
- 为 PIU 增加 `backendBaseUrl`。拒绝原因：已确认 API 同源，新增配置会扩大集成和测试矩阵。

### D4. AIAgentPIU 由 Prel.start 注册，由 loadAIAgent 渲染入口

Prel/PIU 机制按 `workspaces/piu.md` 的模型进入本 change 的正式设计约束：

- HTML 通过固定 `<script src="/febs/v1/assets/prelude-loader"></script>` 获取 `window.Prel`。本地式源 `index.html` 不加载该脚本；沉浸式源 `immersive.html` 和协作式测试宿主 `collaborative.html` 必须加载该脚本。
- `Prel.ready(callback)` 是使用 Prel 能力前的准备边界。沉浸式页面、测试宿主和 `AIAgentPIU.js` 内部入口都必须在 ready 后调用 `Prel.start` 或 `Prel.autoLoad`。
- `Prel.start(name, version, deps, callback)` 负责启动当前页面/PIU 并注入 `piu` 与 `site`。非本地模式只从 `site.session`、`site.user`、`site.locale`、`site.theme` 获取可信 host context。
- `Prel.autoLoad({ AIAgentPIU: packageVersion })` 只负责加载 `AIAgentPIU.js` 及其同名 `AIAgentPIU.css` 资产，不负责渲染 UI。
- `piu.attach(piu, handlers)` 是 `AIAgentPIU.js` 注册事件 handler 的唯一入口。
- `piu.emit(key, state)` 是宿主触发 PIU handler 的方式。协作式必须由宿主 PIU 或测试宿主调用 `emit("loadAIAgent", { containerId })` 后才开始渲染入口。

沉浸式和协作式的 Prel/PIU 加载职责必须区分：

| 模式 | HTML 加载 | 谁调用 `autoLoad` | 谁调用 `emit("loadAIAgent")` | PIU 内部入口 |
|---|---|---|---|---|
| 沉浸式 | `immersive.html` 加载 prelude 和页面 bundle，正式包中输出为 `index.html`。 | 不调用 `autoLoad({ AIAgentPIU })`。 | 不调用 `loadAIAgent`。 | 页面自己的 immersive entry 通过 `Prel.start("AIAgentPIU", ...)` 获取 site，然后渲染 `ImmersiveShell -> ChatWorkspace`。 |
| 协作式 | 产品页面或 `collaborative.html` 加载 prelude，并提供 `containerId` 对应容器。 | 产品宿主或测试宿主调用。 | 产品宿主或测试宿主的 `piu.emit` 调用，payload 只有 `containerId`。 | `AIAgentPIU.js` 内部 `Prel.start("AIAgentPIU", ...)` 后 attach 的 `loadAIAgent`。 |

沉浸式页面也使用 `AIAgentPIU` 作为产品 identity 调用 `Prel.start("AIAgentPIU", packageVersion, ["session", "user", "locale", "theme"], ...)`，以便与产品框架的站点身份保持一致。该调用只用于沉浸式页面获取 `site` 并渲染页面 shell，不通过 `Prel.autoLoad` 加载 `AIAgentPIU.js`，也不注册或触发 `loadAIAgent`。

`AIAgentPIU.js` 启动后调用：

```ts
Prel.start("AIAgentPIU", packageVersion, ["session", "user", "locale", "theme"], (piu, site) => {
  piu.attach(piu, handlers);
});
```

`AIAgentPIU` 不在 `Prel.start` callback 中直接渲染完整面板。它注册 handler 后等待宿主通过父 PIU 或测试宿主执行：

```ts
piu.emit("loadAIAgent", { containerId: "id" });
```

`loadAIAgent` 是 PIU 渲染入口，参数为：

```ts
interface LoadAIAgentPayload {
  containerId: string;
}
```

它负责定位容器，在容器中渲染小 logo entrance。点击 logo 或 `displayAIAgent` 才打开 fixed 浮层。协作式的 docked/floating/maximized 布局只由 `AIAgentPIU` 内部 layout reducer 控制，不暴露给宿主 `loadAIAgent`。

实例策略固定为单 active instance：

- 同一 `containerId` 重复调用：复用 React root。
- 不同 `containerId` 调用：卸载或迁移旧入口，新的容器成为唯一 active instance。

拒绝方案：

- 在 `Prel.start` 后自动挂载到固定 DOM id。拒绝原因：产品需要自定义入口位置。
- 支持多个独立 PIU 实例。拒绝原因：session、composer draft、display state 和 stream state 会产生多 owner；本阶段没有明确产品需求。

### D5. displayAIAgent 是入口和面板开关的唯一状态源

`AIAgentPIU` 内部维护唯一 display state：

```ts
interface AIAgentDisplayState {
  showEntrance: boolean;
  showPanel: boolean;
}
```

`displayAIAgent({ showEntrance, showPanel })`、logo click、close button 都必须通过同一个 reducer 更新该状态。

状态归一化规则：

- `false,false`：完全隐藏。
- `true,false`：只显示 logo。
- `true,true`：显示 logo 和 panel。
- `false,true`：归一化为 `false,false`。

关闭按钮只设置 `showPanel=false`，保留当前 `showEntrance`。这保证宿主隐藏入口后，用户关闭动作不会把入口重新展示出来。

### D6. 协作式 PIU 浮层用 docked、floating、maximized 三种内部布局

协作式是 host 页面内 fixed 浮层，必须避让顶部菜单：

```text
top: 63.2px
```

布局状态只属于 `AIAgentPIU` 内部 reducer，不由 `loadAIAgent` 参数决定：

```ts
type CollaborativePanelLayout =
  | { kind: "docked"; width: number; side: "left" | "right" }
  | { kind: "floating"; x: number; y: number; width: number; height: number }
  | { kind: "maximized"; restore: Exclude<CollaborativePanelLayout, { kind: "maximized" }> };
```

`loadAIAgent` still does not accept a layout mode. The PIU infers the docked side from the host container position: a container on the left half of the viewport opens a left docked panel, and a container on the right half opens the default right docked panel. The resize target is the panel's inner edge: right-docked panels resize from the left edge, and left-docked panels resize from the right edge. The whole edge height is interactive, not only the header.

`docked` 是打开后的默认状态：

- 默认右侧。
- 默认宽度 `484px`。
- 高度 `calc(100vh - 63.2px)`。
- 可手动调整宽度。

`floating` 是拖动后的状态：

- 用户从 docked 标题栏或 drag handle 开始拖动时，layout 变为 `floating`。
- 在 `1920px × 1080px` viewport 下，进入 floating 后窗口尺寸调整为 `484px × 756px`。
- 在 `1920px × 1080px` viewport 下，floating 最小尺寸为 `406px × 484px`。
- 在 `1920px × 1080px` viewport 下，floating 最大宽度为 `1112px`。
- floating 的上、右、下、左四条边分别支持高度或宽度调整；四个角支持宽度和高度同时调整。
- 其他分辨率下，默认尺寸、最小尺寸和最大宽度可以按可用空间 clamp；原则是窗口必须保持可达，且不得覆盖 `63.2px` 顶部菜单。

`maximized` 是 host 页面内最大化状态：

- 最大化固定为 host 页面内浮层最大化，不使用浏览器 fullscreen API。
- 还原时回到最大化前的 `docked` 或 `floating` 几何状态。

PIU chrome 使用图标按钮，新建会话、历史、浮动/停靠、最大化/还原、关闭在右上角呈现。历史入口使用 popover，默认展示最近 10 条并滚动加载更多。

### D7. sendQuestionToLui 只填入为默认行为

`sendQuestionToLui` 的参数固定为：

```ts
interface SendQuestionToLuiPayload {
  question: string;
  isSend?: boolean;
}
```

`isSend` 缺省为 `false`。当面板未打开时，handler 先打开面板，再把 `question` 注入 composer。`isSend=false` 时只保留草稿，不提交；`isSend=true` 时等待 composer ready 后提交。

该行为需要在 composer controller 层提供受控注入入口，避免通过 DOM 查询直接改 textarea。

### D8. 正式构建使用一个产品构建命令，内部拆为页面和 PIU 两个 target

产品视角使用一个正式前端构建命令，例如 `npm run build:vite:modes`。实现路径固定为一个编排脚本顺序运行两个 Vite target：

1. 页面 target：以 `immersive.html` 生成正式页面，并在正式 artifact 中输出为 `index.html`，同时输出共享静态 assets。
2. PIU library target：生成 `piu/AIAgentPIU.js` 和同名样式 `piu/AIAgentPIU.css`，且 `AIAgentPIU` 启动不得依赖额外 JS chunk、runtime asset manifest、script-injected JS 或额外 stylesheet。

构建后执行 artifact allowlist 检查：

- 必须存在 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`。
- `AIAgentPIU` 启动所需资产必须限定为 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`。
- 不得存在源 `immersive.html`、`collaborative.html`、mock prelude，也不得把本地式源 `index.html` 复制为正式入口。
- 正式输出的 `index.html` 必须包含固定 prelude script，且不得包含本地式登录、主题、语言、帮助或退出登录 owner controls。

选择两个 target 的原因是 HTML 页面入口和 PIU IIFE/UMD asset 的 bundling 目标不同。由一个编排命令统一产出正式资产，既满足“一次构建”，又顺应 PIU 默认的 JS + 同名 CSS sidecar 加载机制。

拒绝方案：

- 三种模式分别独立构建。拒绝原因：容易产生多套产物语义和重复业务代码。
- 一个 Vite HTML target 同时输出 PIU。拒绝原因：难以保证 PIU JS 与同名 CSS sidecar 的产物命名和依赖关系稳定，且 HTML 入口资源拆分规则会影响 PIU 集成。

### D9. 轻量 Prel mock 只用于测试

测试框架位于前端 dev/test 范围内，通过本地测试服务固定响应：

```text
/febs/v1/assets/prelude-loader
```

mock 只实现：

- `window.Prel.ready`
- `window.Prel.autoLoad`
- `window.Prel.start`
- `piu.attach`
- `piu.emit`
- `site.session`
- `site.user`
- `site.locale`
- `site.theme`

`collaborative.html` 加载固定 prelude path，并通过 mock `Prel.autoLoad({ AIAgentPIU: version })` 加载源码 PIU entry。mock 顶部菜单右侧提供固定 `id="ai-agent-container"` 的渲染容器；`collaborative.html` 在 `autoLoad` 完成后自动调用 `piu.emit("loadAIAgent", { containerId: "ai-agent-container" })`。mock 不模拟完整 febs.json、真实资产 registry、版本解析或复杂依赖加载。

开发态 mock 只在协作式测试页渲染可见顶部菜单，并采用文档流占位，用于保留菜单右侧入口材料。沉浸式仍加载同一个固定 prelude path，但 mock 只安装 `window.Prel` 和 site context，不渲染 `prel-mock-menu`，使沉浸式本地 smoke 明确保持“菜单由产品框架负责”的边界。真实产品 Prel 菜单仍按 fixed 覆盖处理；沉浸式成功 `Prel.start` 后也不移动 `#root`，不在业务 shell 内添加 top inset。

### D10. dev:watch 使用一个 Vite server 暴露三种开发入口

`npm run dev:watch` 仍是唯一源码 watch 入口，不为三种模式分别新增 dev server、根脚本或 watch 命令。它继续启动 backend-only watch/restart 和一个 `frontend/agent-web` Vite dev server；模式选择由 URL 入口决定。

开发 URL 固定为：

```text
/api/**                         -> Vite proxy，不进入 HTML fallback
/@vite/**                       -> Vite internal，不进入 HTML fallback
/src/**                         -> source module，不进入 HTML fallback
/assets/**                      -> static asset，不进入 HTML fallback
/febs/v1/assets/prelude-loader  -> dev/test mock prelude JS
/immersive/                     -> immersive.html
/immersive/**                   -> immersive.html
/immersive.html                 -> immersive.html
/collaborative/                 -> collaborative.html
/collaborative/**               -> collaborative.html
/collaborative.html             -> collaborative.html
/                               -> index.html
/index.html                     -> index.html
其他 browser document navigation -> index.html
```

源入口文件名固定为：

```text
index.html         -> /src/entries/local.tsx
immersive.html     -> /src/entries/immersive.tsx
collaborative.html -> /src/entries/collaborative.ts
mock autoLoad      -> /src/entries/piu.tsx
```

Vite dev server 必须设置 `strictPort: true`。默认 host/port 保持 `127.0.0.1:5173`；如果开发者通过 `VITE_DEV_HOST` 覆盖 host，`dev:watch` 打印的入口 URL 必须使用实际 host。端口被占用时 fail closed，不漂移到其他端口。

`dev:watch` 启动时必须输出：

```text
Local:         http://<effective-host>:5173/
Immersive:     http://<effective-host>:5173/immersive/
Collaborative: http://<effective-host>:5173/collaborative/
```

开发态 mock `Prel.autoLoad({ AIAgentPIU: version })` 映射到源码入口 `src/entries/piu.tsx`，不读取 `dist/piu/AIAgentPIU.js` 或 `dist/piu/AIAgentPIU.css`。正式 PIU 单 JS + 同名 CSS 约束只由 `npm run build:vite:modes` 和 artifact checks 验证。

`dev:watch` 不运行 `npm run build:vite:modes`、artifact assembly、artifact package install 或 `with-frontend`，也不得创建或更新正式构建输出，包括 `dist/index.html`、`dist/piu/AIAgentPIU.js` 和 `dist/piu/AIAgentPIU.css`。如果本地已有旧 `dist`，验证应检查 `dev:watch` 无写入副作用，而不是假设这些文件不存在。

### D11. 后端托管边界保持 packaged artifact consumption

`agent-app` 和 `agent-app-frontend-hosting` 的 ownership 不因多宿主模式改变。后端仍只读取 `@nextagent/agent-web/hosting` 的 manifest 和包内静态资产。后端不 import `frontend/agent-web` 源码，不提供 mock prelude，不解释 PIU handler。

正式 `with-frontend` 托管仍只负责静态资源和 SPA fallback。`AIAgentPIU.js` 与 `AIAgentPIU.css` 作为前端 artifact 内的静态资产被托管，Prel asset registry 如何把 `AIAgentPIU` 映射到这组文件属于产品框架侧配置，不由后端运行时推导。

### D12. Collaborative session navigation is internal PIU state, not a route

Local and immersive modes keep the current URL contract:

```text
/                 -> welcome/new session
/session/:id      -> selected session
```

Collaborative mode is embedded into a product page and therefore MUST NOT mutate the host page URL for chat session selection. The shared chat business core receives a small navigation adapter instead of directly owning route primitives:

```ts
interface ChatNavigationAdapter {
  sessionId: string | null;
  openSession(sessionId: string, options?: { replace?: boolean }): void;
  openNewSession(options?: { replace?: boolean }): void;
  onSessionLoadFailure?(sessionId: string): void;
}
```

The local/immersive adapter maps `openSession` and `openNewSession` to the existing React Router navigation. The collaborative adapter maps the same operations to `AIAgentPIU` runtime state and to `sessionStorage["nextagent:AIAgentPIU:activeSessionId"]`.

The PIU runtime initializes its active session id by reading this storage key. History popover selection writes the selected id. New session removes the key. Submitting from the welcome state still creates a backend session through the shared composer controller, and the controller reports the created id through the adapter so collaborative mode stores it without touching the host URL. A restored id that fails conversation loading is cleared by the PIU adapter and returns the core to the welcome state.

Rejected alternatives:

- Keep `MemoryRouter` inside `AIAgentPIU`. Rejected because it preserves a route-shaped implementation detail in a mode that has no product-visible route semantics, and it cannot restore the selected session after a host page refresh without a second persistence layer.
- Encode the collaborative session in the host page URL query string. Rejected because the product page owns its URL and the PIU is a single embedded capability, not an independent page router.
- Use `localStorage`. Rejected because the selected collaborative session should survive refresh in the current tab but should not leak across unrelated browser tabs.

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 非本地模式信任 Prel session/user，前端不接受请求体或模型输出覆盖身份；auth challenge 固定跳 `/login-url`；mock prelude 不进入正式包；后端不消费前端源码或 test host。 | PIU auth challenge tests、artifact exclusion tests、packaging boundary tests、code review 检查 mock 不被正式导出 |
| 性能/容量 | 三种模式共用业务核心，避免多套 stream/session store；PIU 只维护单 active instance；协作式 docked/floating/maximized layout 按 viewport clamp 到可用区域。 | component tests、layout tests、manual/browser smoke；无需新增后端负载测试，因为 API/stream 后端契约不变 |
| 可靠性/恢复 | stream continuity、session history、request controls 继续由共享业务核心承载；PIU 单实例避免多个浮层同时竞争同一会话状态；构建缺少正式资产时 fail closed。 | existing stream/session tests、PIU single-instance tests、formal build fail-closed tests |
| 可维护性 | Shell/Core 分层让模式差异集中在入口和 host adapter；正式构建由一个命令编排两个 target；dev watch 由一个 Vite server 通过 URL 区分模式；测试 Prel mock 范围受限。 | architecture/code review、entrypoint tests、build script tests、dev-watch plan tests |
| 可测试性 | dev/test Prel mock 提供固定 prelude path、host site context 和 `piu.emit`；`collaborative.html` 提供真实浏览器交互入口但不进入正式 artifact。 | unit/component tests、Playwright smoke for test hosts、artifact allowlist tests |
| 审计/可追溯性 | 本 change 不新增审计事件、日志字段或 backend evidence；正式 artifact 检查记录哪些 host assets 被发布。 | packaging evidence tests、build output assertions、code review 检查不记录 prompt/model output/raw provider error |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 三种模式共用业务核心，不复制 chat/session/stream 逻辑 | 1.1, 1.2, 5.4 | component tests、architecture/code review |
| 开发默认 `index.html` 为本地式，且不得被复制为正式 artifact 入口 | 2.1, 4.5 | entrypoint tests、artifact allowlist tests |
| `immersive.html` 为沉浸式源入口，正式 build 将其产出为 `index.html` 并包含固定 prelude script | 2.2, 4.1 | build output tests、HTML inspection |
| 非本地模式信任 Prel site context，隐藏本地设置类入口 | 2.3, 3.5 | shell component tests |
| `AIAgentPIU.js`/`AIAgentPIU.css` 名称、PIU identity、版本来自根 package version | 3.1, 4.1 | PIU build tests、package version tests |
| `loadAIAgent` 仅接收 `containerId` 并渲染 logo | 3.2 | PIU handler tests |
| PIU 单实例和 display state 归一化 | 3.3, 3.4 | PIU state tests |
| 协作式 docked/floating/maximized 避让 `63.2px` 顶部菜单和尺寸规则 | 3.6 | layout tests、browser smoke |
| history popover 默认 10 条并滚动加载更多 | 3.8 | component tests |
| `switchTheme` 同步 React、AntD、document data-theme，并将 `lightday/evening` 映射到 AntD light/dark tokens | 3.5 | theme tests |
| `sendQuestionToLui` 默认只填入，`isSend=true` 才提交 | 3.9 | composer controller tests |
| dev/test Prel mock 固定路径可驱动 `collaborative.html`，但不进正式包 | 4.2, 4.4, 4.5 | test host smoke、artifact allowlist tests |
| `dev:watch` 用一个 Vite server 暴露 `/`、`/immersive/`、`/collaborative/`，打印三种入口 URL，并通过 `strictPort` fail closed | 4.3 | dev-watch plan tests、Vite routing tests |
| 开发态 `Prel.autoLoad({ AIAgentPIU })` 加载 `src/entries/piu.tsx`，不读取正式 PIU 产物 | 4.2, 4.4 | Prel mock tests、test host smoke |
| 正式构建一次产出 `index.html`、`piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css` | 4.1 | build script tests |
| 后端仍只消费 packaged artifact 和 hosting export | 5.1 | fullstack packaging boundary regression tests |
| OpenSpec delta 合法 | 5.2 | `openspec validate add-agent-web-multi-host-modes --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-multi-host-modes/spec.md` 主承载三种 host mode、PIU handler、display state、协作式 layout state、主题/语言、认证和 dev/test mock 行为；`openspec/specs/fullstack-packaging-boundary/spec.md` 主承载正式 artifact 边界和排除规则。
- 架构和跨模块设计：`openspec/designs/architecture/agent-web-host-modes.md` 主承载 Shell/Core 分层、Prel/PIU lifecycle、display state、PIU layout、构建 target 和测试框架边界。
- 架构补充：`openspec/designs/architecture/fullstack-packaging-boundary.md` 主承载正式 artifact 结构、`immersive.html` 到正式 `index.html` 的输出语义、`piu/AIAgentPIU.js`/`piu/AIAgentPIU.css` 和 dev/test asset 排除规则。
- 模块设计：默认不更新 `agent-app` 或 `agent-channel-web` 模块设计；只有实现改变其 public contract 时才在归档前补充。
- ADR：无。当前取舍属于 host mode architecture，不需要独立长期 ADR。
- 导航：`openspec/designs/spec-to-design-map.md` 归档前新增 `agent-web-multi-host-modes` 到 architecture 和验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] 开发态 `index.html` 和正式 artifact `index.html` 同名但语义不同，会导致联调误加载 Prel 或正式包误携带本地 controls。-> 本 change 固定开发默认 `index.html` 为本地式，`immersive.html` 为沉浸式源入口；正式 build/assembly 必须从 `immersive.html` 产出 `index.html`，并通过 artifact tests 检查正式 `index.html` 含 prelude 且不含本地 controls。
- [风险] PIU handler 与宿主 PIU `emit` 语义混淆。-> 测试 Prel mock 必须模拟父 PIU/宿主 `piu.emit`，`AIAgentPIU` 内部只通过 `piu.attach` 注册 handler。
- [风险] 多个 container 同时加载导致多个 panel 状态。-> 设计固定为单 active instance，第二个 container 迁移入口。
- [风险] 轻量 mock 被误打入正式包。-> 正式 build allowlist/denylist 测试必须检查 mock prelude 和 `collaborative.html` 不存在。
- [风险] PIU composer 注入通过 DOM 操作变脆。-> `sendQuestionToLui` 必须走 composer/controller 的受控注入入口。
- [风险] 沉浸式隐藏本地 controls 后失去帮助/退出入口。-> 这是产品框架职责，Prel top menu 提供这些动作；沉浸式只保留会话导航和业务区。

## 迁移计划（Migration Plan）

实施完成后，正式前端 artifact 的入口语义变更为：

- `index.html`：开发态本地式入口；在正式 artifact 中同名文件由 `immersive.html` 产出并代表沉浸式入口。
- `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`：协作式正式 PIU asset。
- `immersive.html`：沉浸式源入口，仅 dev/test/source 阶段存在，不以该文件名进入正式 artifact。
- `collaborative.html`：协作式 dev/test 测试宿主，仅 dev/test/source 阶段存在，不进入正式 artifact。

回滚策略是恢复正式 artifact 的旧单入口构建和 hosting manifest，但该回滚会移除沉浸式与 PIU 正式交付能力。由于本 change 不迁移数据、不改后端 API、不改 persistence schema，回滚不涉及数据库或运行时状态迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-multi-host-modes/spec.md`：合入 host mode、PIU lifecycle、display state、布局、主题/语言、认证、测试框架行为契约。
- `openspec/specs/fullstack-packaging-boundary/spec.md`：合入正式多宿主 artifact 资产边界和 dev/test asset 排除规则。
- `openspec/designs/architecture/agent-web-host-modes.md`：提炼 Shell/Core 分层、入口和构建 target、Prel/PIU lifecycle、display state、浮层布局和 mock 测试框架。
- `openspec/designs/architecture/fullstack-packaging-boundary.md`：提炼正式 artifact 从单页面包扩展为沉浸式页面 + PIU asset 的边界。
- `openspec/designs/spec-to-design-map.md`：补充新 capability 到设计和验证入口的导航。
- `openspec/overview.md`：无。
- `openspec/designs/modules/agent-app.md`：默认无；仅在实现改变 frontend hosting public contract 时更新。
- `openspec/designs/modules/agent-channel-web.md`：无。
- `openspec/designs/adr/<id>.md`：无。

## 待确认问题（Open Questions）

无。
