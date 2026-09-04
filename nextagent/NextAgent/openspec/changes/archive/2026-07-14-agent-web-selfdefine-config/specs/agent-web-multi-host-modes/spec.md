## MODIFIED Requirements

### Requirement: AIAgentPIU starts through Prel and loadAIAgent

Collaborative mode SHALL be delivered through one PIU logical asset named `AIAgentPIU`, composed of `AIAgentPIU.js` and the same-name stylesheet `AIAgentPIU.css`. The PIU name MUST be `AIAgentPIU`, and its runtime version MUST come from the repository root `package.json.version`.

Products SHALL load the PIU through Prel asset loading and start rendering by emitting `loadAIAgent` with an AICOConfig payload. `loadAIAgent` MUST accept an AICOConfig object as its payload. The AICOConfig object MUST include a `containerId: string` field as the host-selected rendering location, plus optional UI customization fields defined by the `aico-config-contract` capability. `loadAIAgent` MUST NOT accept or require a host-provided `mode`.

`AIAgentPIU` MUST render a small entrance logo into the element identified by `AICOConfig.containerId`. The conversation panel MUST open only through PIU display state, such as logo click or `displayAIAgent`, and MUST render in a fixed floating element owned by `AIAgentPIU`.

When `loadAIAgent` is called again with a different AICOConfig, the new configuration MUST fully replace the previous one (not merge). Any active custom PANEL MUST be unmounted before applying the new configuration.

#### Scenario: Product loads and starts AIAgentPIU with AICOConfig
- **WHEN** a product executes `window.Prel.autoLoad({ AIAgentPIU: version })`
- **AND** the host PIU emits `loadAIAgent` with an AICOConfig containing `{ containerId: "ai-agent-container", name: "网络助手", operators: [...] }`
- **THEN** `AIAgentPIU` MUST locate the host element by `AICOConfig.containerId`
- **AND** it MUST render the entrance logo inside that host element
- **AND** it MUST apply the AICOConfig customization fields (name, operators, etc.)
- **AND** it MUST keep panel layout state internal to `AIAgentPIU`

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
