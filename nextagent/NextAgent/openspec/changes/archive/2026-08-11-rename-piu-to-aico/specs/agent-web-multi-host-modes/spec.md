## Function

- **所属 Function**：`FN-3.1 协作式 PIU 宿主集成`
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Prel and PIU lifecycle is explicit per host mode

Non-local HTML entries SHALL use the Prel lifecycle defined for this capability. Any HTML entry that depends on Prel MUST include `<script src="/febs/v1/assets/prelude-loader"></script>` with that exact `src` value before it uses `window.Prel`.

Immersive mode SHALL use `Prel.start("AFWebsitePIU", packageVersion, ["session", "user", "locale", "theme"], callback)` to obtain trusted `site` context for page rendering, but immersive mode MUST NOT load the PIU JavaScript or stylesheet assets through `Prel.autoLoad` and MUST NOT start rendering through `loadAIAgent`. The immersive PIU name `AFWebsitePIU` MUST be distinct from the collaborative PIU name `AICOPIU` so that the two host modes do not collide when served from the same environment.

Collaborative host pages SHALL load the PIU JavaScript and its same-name stylesheet through `Prel.autoLoad({ AICOPIU: version })` or the equivalent two-argument `Prel.autoLoad("AICOPIU", version)` form. `Prel.autoLoad` MUST be treated as asset loading only; UI rendering MUST start only after the host PIU or test host emits `loadAIAgent`.

The PIU JavaScript SHALL call `Prel.start("AICOPIU", packageVersion, ["session", "user", "locale", "theme"], callback)` after `Prel.ready`. Inside that callback it MUST register handlers through `piu.attach(piu, handlers)`. It MUST NOT render the entrance logo or panel until the attached `loadAIAgent` handler is invoked.

#### Scenario: Immersive page uses Prel without loading the PIU
- **WHEN** the immersive source entry `immersive.html` is loaded in dev/test or as the formal artifact `index.html`
- **THEN** the document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the page MUST call `Prel.start` with name `AFWebsitePIU`, the package version, and deps `session`, `user`, `locale`, and `theme`
- **AND** the page MUST obtain `site.session`, `site.user`, `site.locale`, and `site.theme` through Prel startup
- **AND** the page MUST render the immersive shell directly through the page entry
- **AND** it MUST NOT call `Prel.autoLoad` for `AFWebsitePIU`
- **AND** it MUST NOT emit `loadAIAgent`

#### Scenario: Collaborative host loads and triggers the PIU
- **WHEN** a collaborative product page or collaborative test host is loaded
- **THEN** the host document MUST load `/febs/v1/assets/prelude-loader`
- **AND** the host MUST provide an element whose id is passed as `containerId`
- **WHEN** the host calls `Prel.autoLoad({ AICOPIU: version })`
- **THEN** the host MUST load the PIU JavaScript and same-name stylesheet assets
- **WHEN** the host PIU emits `loadAIAgent` with `{ containerId }`
- **THEN** the attached PIU handler MUST render the entrance logo into that container
- **AND** no panel MUST be rendered before logo click or `displayAIAgent`

#### Scenario: PIU registers handlers before rendering
- **WHEN** the PIU JavaScript is loaded by Prel
- **THEN** it MUST call `Prel.start` with name `AICOPIU`, the package version, and deps `session`, `user`, `locale`, and `theme`
- **AND** it MUST call `piu.attach` to register `loadAIAgent`, `displayAIAgent`, `switchTheme`, and `sendQuestionToLui`
- **AND** no entrance logo or panel MUST be rendered before `loadAIAgent` is emitted by the host

### Requirement: PIU starts through Prel and loadAIAgent

Collaborative mode SHALL be delivered through one PIU logical asset named `AICOPIU`. The PIU name MUST be `AICOPIU`, and its runtime version MUST come from the repository root `package.json.version`.

Products SHALL load the PIU through Prel asset loading and start rendering by emitting `loadAIAgent` with an AICOConfig payload. `loadAIAgent` MUST accept an AICOConfig object as its payload. The AICOConfig object MUST include a `containerId: string` field as the host-selected rendering location, plus optional UI customization fields defined by the `aico-config-contract` capability. `loadAIAgent` MUST NOT accept or require a host-provided `mode`.

The PIU MUST render a small entrance logo into the element identified by `AICOConfig.containerId`. The conversation panel MUST open only through PIU display state, such as logo click or `displayAIAgent`, and MUST render in a fixed floating element owned by the PIU.

When `loadAIAgent` is called again with a different AICOConfig, the new configuration MUST fully replace the previous one (not merge). Any active custom PANEL MUST be unmounted before applying the new configuration.

#### Scenario: Product loads and starts the PIU with AICOConfig
- **WHEN** a product executes `window.Prel.autoLoad({ AICOPIU: version })`
- **AND** the host PIU emits `loadAIAgent` with an AICOConfig containing `{ containerId: "ai-agent-container", name: "网络助手", operators: [...] }`
- **THEN** the PIU MUST locate the host element by `AICOConfig.containerId`
- **AND** it MUST render the entrance logo inside that host element
- **AND** it MUST apply the AICOConfig customization fields (name, operators, etc.)
- **AND** it MUST keep panel layout state internal to the PIU

#### Scenario: loadAIAgent is called repeatedly with same containerId
- **WHEN** `loadAIAgent` is called again with the same `containerId`
- **THEN** the existing React root MUST be reused
- **AND** if a new AICOConfig is provided, it MUST fully replace the previous configuration

#### Scenario: loadAIAgent is called with a different containerId
- **WHEN** `loadAIAgent` is called with a different `containerId`
- **THEN** the PIU MUST keep a single active instance and move the entrance root to the new container
- **AND** if a new AICOConfig is provided, it MUST fully replace the previous configuration

#### Scenario: loadAIAgent replaces active custom PANEL
- **GIVEN** a custom PANEL operator is active
- **WHEN** `loadAIAgent` is emitted again with a new AICOConfig
- **THEN** the active custom PANEL MUST be unmounted
- **AND** the new AICOConfig MUST be applied
- **AND** the panel state MUST return to `CONVERSATION_PANEL`

## REMOVED Requirements

### Requirement: AIAgentPIU starts through Prel and loadAIAgent

**Reason**: PIU 名称从 `AIAgentPIU` 更名为 `AICOPIU`，原 requirement 中的名称需要同步更新。

**Migration**: 使用 "PIU starts through Prel and loadAIAgent"；PIU name 从 `AIAgentPIU` 改为 `AICOPIU`。

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：PIU 启动名称从 `AIAgentPIU` 改为 `AICOPIU`。
- **依据 Requirements**：Prel and PIU lifecycle is explicit per host mode、PIU starts through Prel and loadAIAgent

### 结果

- **变更类型**：修改
- **目标内容**：PIU name 为 `AICOPIU`。
- **依据 Requirements**：同上
