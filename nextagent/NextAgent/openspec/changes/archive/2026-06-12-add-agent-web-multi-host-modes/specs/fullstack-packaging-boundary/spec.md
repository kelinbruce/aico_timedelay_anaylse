## ADDED Requirements

### Requirement: Frontend artifact 发布多宿主正式资产

`@nextagent/agent-web` 正式 artifact SHALL 只发布供产品消费的正式运行时资产。正式 frontend artifact MUST 包含：

- `index.html`，即由 immersive 源入口 `immersive.html` 生成的正式输出。
- `index.html` 所需的静态资产。
- `piu/AIAgentPIU.js`，即 collaborative PIU 的 JavaScript 资产。
- `piu/AIAgentPIU.css`，即 collaborative PIU 的同名 stylesheet 资产。
- `@nextagent/agent-web/hosting` public export 以及 `with-frontend` 所需的 hosting manifest。

PIU 资产名 MUST 为 `AIAgentPIU`。正式 artifact MUST 提供 `AIAgentPIU.js` 和同名 stylesheet `AIAgentPIU.css`。PIU 运行时标识 MUST 为 `AIAgentPIU`，且 artifact 包版本 MUST 等于仓库根目录 `package.json.version`。

`AIAgentPIU` 正式运行时资产集是封闭的：产品 Prel 加载 MUST 能够仅通过加载 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css` 启动 PIU。`piu/AIAgentPIU.js` MUST NOT 要求任何额外产出的 JavaScript chunk、运行时资产 manifest 或脚本注入的 JavaScript 文件。`piu/AIAgentPIU.css` MUST NOT 要求任何额外产出的 stylesheet。immersive `index.html` 所需的静态资产 MAY 存在，但它们 MUST NOT 是 `AIAgentPIU` 启动所必需的。

#### Scenario: 正式 frontend artifact 已生成
- **WHEN** frontend 正式 artifact 被组装
- **THEN** artifact MUST 包含 `index.html`
- **AND** `index.html` MUST 由 immersive 源入口 `immersive.html` 生成
- **AND** artifact MUST NOT 发布本地源 `index.html`
- **AND** artifact MUST 包含 `piu/AIAgentPIU.js`
- **AND** artifact MUST 包含 `piu/AIAgentPIU.css`
- **AND** artifact 包版本 MUST 等于仓库根目录 `package.json.version`

#### Scenario: 产品通过 Prel 加载 PIU 资产
- **WHEN** 产品运行时通过 Prel 资产加载解析 `AIAgentPIU`
- **THEN** 正式 artifact MUST 提供名为 `AIAgentPIU.js` 的 PIU JavaScript 资产
- **AND** 正式 artifact MUST 提供名为 `AIAgentPIU.css` 的 PIU stylesheet 资产
- **AND** 这些资产 MUST 代表 `AIAgentPIU` 运行时标识

#### Scenario: PIU 运行时资产集是封闭的
- **WHEN** 为 `AIAgentPIU` 运行时需求检查正式 frontend artifact
- **THEN** `piu/AIAgentPIU.js` MUST 是启动 `AIAgentPIU` 所需的唯一 JavaScript 资产
- **AND** `piu/AIAgentPIU.css` MUST 是 `AIAgentPIU` 所需的唯一 stylesheet 资产
- **AND** `piu/AIAgentPIU.js` MUST NOT 通过 dynamic import、脚本注入或运行时资产 manifest 引用额外产出的 JavaScript chunk
- **AND** `piu/AIAgentPIU.css` MUST NOT 要求额外产出的 stylesheet 资产
- **AND** immersive `index.html` 的静态资产 MUST NOT 是 `AIAgentPIU` 启动所必需的

### Requirement: 正式 index 是 immersive 的并加载 Prel

`@nextagent/agent-web` 中的源 `immersive.html` SHALL 是用于 dev/test smoke 的 immersive 入口。正式 artifact `index.html` SHALL 由 `immersive.html` 生成。`immersive.html` 和正式 artifact `index.html` 二者 MUST 都包含 `<script src="/febs/v1/assets/prelude-loader"></script>`，并且 MUST NOT 改动该脚本的 `src`。

源 `index.html` SHALL 保持为前后端本地测试使用的独立本地入口。正式 artifact `index.html` MUST NOT 由该本地源入口产出，且本地独立行为 MUST 保持在正式 artifact 之外。

#### Scenario: 正式 index 被检查
- **WHEN** 正式 `index.html` 被检查
- **THEN** 它 MUST 包含 `<script src="/febs/v1/assets/prelude-loader"></script>`
- **AND** `src` 属性 MUST 精确为 `/febs/v1/assets/prelude-loader`
- **AND** 它 MUST NOT 包含仅限 local 模式的登录、主题、locale、帮助或登出页面 ownership

### Requirement: Dev 与 test host 资产被排除在正式 artifact 之外

本地源 `index.html`、源 `immersive.html`、源 `collaborative.html`、collaborative dev/test host 生成的 JavaScript/CSS/资产，以及轻量 mock Prel loader SHALL 仅为 dev/test 专用源或 test-host 资产。本地源 `index.html` MUST NOT 被复制或用作正式 artifact `index.html`。源 `immersive.html` MUST NOT 以 `immersive.html` 名称包含在正式 artifact 中。源 `collaborative.html` MUST NOT 以 `collaborative.html` 名称包含在正式 artifact 中。仅由 `collaborative.html` dev/test host 拥有的 JavaScript、CSS 或资产文件 MUST NOT 包含在正式 artifact 中。Test host 和 mock Prel 文件 MUST NOT 通过 `@nextagent/agent-web/hosting` 暴露。

Dev/test 工具 MAY 为本地验证提供这些资产，包括带有右侧 PIU 渲染容器的 mock 顶部菜单，但正式产品打包 MUST 将其排除。

#### Scenario: 正式 artifact 排除 dev 与 test host
- **WHEN** 正式 `@nextagent/agent-web` artifact 被检查
- **THEN** 源 `immersive.html` MUST NOT 存在
- **AND** 本地源 `index.html` MUST NOT 被发布为正式 `index.html`
- **AND** 源 `collaborative.html` MUST NOT 存在
- **AND** 仅为 `collaborative.html` dev/test host 生成的 JavaScript、CSS 或资产文件 MUST NOT 存在
- **AND** mock Prel loader MUST NOT 存在

#### Scenario: Dev test host 提供 PIU 容器
- **WHEN** dev/test host 提供 `collaborative.html` 服务
- **THEN** 该 host MAY 渲染一个 mock 的产品顶部菜单
- **AND** 顶部菜单 MAY 包含一个由 `loadAIAgent` 使用的右侧容器
- **AND** 这些 test-host 容器 MUST 保持在正式 artifact 之外

### Requirement: 多宿主构建是一次正式构建输出

正式 frontend build SHALL 在一个受控构建流程中产出所有正式模式资产。它 MUST 将 `immersive.html` 构建为正式 artifact 文件 `index.html`，并 MUST 在同一正式流程中产出 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css`，使产品运行时可以选择加载哪个资产。如果任何正式资产缺失，或 `AIAgentPIU` 要求封闭 PIU 资产集之外的任何运行时资产，构建流程 MUST fail closed。

#### Scenario: 正式多宿主构建完成
- **WHEN** frontend 正式构建命令成功完成
- **THEN** `index.html` MUST 作为由 `immersive.html` 生成的正式输出存在
- **AND** `piu/AIAgentPIU.js` MUST 作为 PIU 入口存在
- **AND** `piu/AIAgentPIU.css` MUST 作为 PIU 同名 stylesheet 存在
- **AND** 产品打包 MUST NOT 需要第二次 frontend build 来获得任何正式资产

#### Scenario: 正式构建缺少 PIU 资产
- **WHEN** frontend 正式构建命令无法产出 `piu/AIAgentPIU.js` 或 `piu/AIAgentPIU.css`
- **THEN** 构建 MUST fail closed
- **AND** artifact 组装 MUST NOT 静默发布一个仅含 immersive 的 artifact

#### Scenario: PIU 构建产出一个额外必需的运行时资产
- **WHEN** frontend 正式构建命令产出 `AIAgentPIU` 所需的额外 JavaScript chunk、stylesheet、运行时资产 manifest 或脚本注入的 JavaScript 文件
- **THEN** 构建 MUST fail closed
- **AND** artifact 组装 MUST NOT 发布一个要求超出 `piu/AIAgentPIU.js` 和 `piu/AIAgentPIU.css` 之外的 PIU 包
