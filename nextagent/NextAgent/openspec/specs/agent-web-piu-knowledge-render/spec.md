# agent-web-piu-knowledge-render Specification

## Purpose

Define the collaborative-PIU attach handler `renderKnowledge` behavior contract: rendering a knowledge source list into a caller-provided container with independent React root, theme-aware modal detail display, and title resolution fallback. This capability is scoped to the collaborative PIU entry only.

## Function

- **所属 Function**：`FN-10.6 前端定制`
- **spec 角色**：主规格

## Requirements

### Requirement: renderKnowledge capability is scoped to collaborative PIU only

`renderKnowledge` handler SHALL only be registered in `registerAIAgentPIU`（协作式入口）的 `createHandlers` 返回类型中。沉浸式入口（`immersive.tsx`）和本地入口（`local.tsx`）的 `piu.attach` MUST NOT 注册 `renderKnowledge`。`PIU.attach` 类型声明（`prel.ts`）MUST NOT 被修改，`renderKnowledge` 与 `minimizeAIAgent`、`loadAIAgent` 等协作式自定义 handler 同形，只在 `createHandlers` 返回类型声明。

**需求类别**：功能性需求

#### Scenario: Immersive mode does not register renderKnowledge
- **GIVEN** the immersive entry point (`immersive.tsx`) has started
- **WHEN** `piu.attach` is called
- **THEN** the attached handlers MUST NOT include `renderKnowledge`

#### Scenario: Local mode does not register renderKnowledge
- **GIVEN** the local entry point (`local.tsx`) has started
- **WHEN** the mock prel starts
- **THEN** `piu.attach` MUST NOT include `renderKnowledge`

### Requirement: PIU exposes renderKnowledge handler through attach

PIU SHALL register a `renderKnowledge` handler in `piu.attach()` within `registerAIAgentPIU`。The handler SHALL accept a payload `{ containerId: string, data: readonly KnowledgeSourceItem[] }`，其中 `KnowledgeSourceItem = { source: string, title: string, knowledge: string }`。集成方通过 `piu.emit('renderKnowledge', payload)` 调用。

`renderKnowledge` SHALL be independent from `loadAIAgent`。调用 `renderKnowledge` MUST NOT 启动 AIAgent 运行时、修改 `displayAIAgent` 状态或触发 `minimizeAIAgent`。`renderKnowledge` 仅负责在指定容器内渲染知识来源列表。

The `renderKnowledge` handler type SHALL be declared in the `createHandlers` return type, following the same pattern as `loadAIAgent`、`displayAIAgent` 和 `minimizeAIAgent`。`prel.ts` 的 `PIU.attach` 类型 SHALL NOT be modified。

**需求类别**：功能性需求

#### Scenario: renderKnowledge handler is registered
- **GIVEN** PIU has been registered via `registerAIAgentPIU()`
- **WHEN** `prel.start` callback fires and `piu.attach()` is called
- **THEN** the attached handlers MUST include `renderKnowledge`
- **AND** `renderKnowledge` MUST be a function that accepts a payload with `containerId` and `data`

#### Scenario: renderKnowledge requires containerId
- **GIVEN** `renderKnowledge` is called with a payload missing `containerId`
- **WHEN** the handler executes
- **THEN** the handler MUST warn and return without rendering

#### Scenario: renderKnowledge does not affect loadAIAgent state
- **GIVEN** PIU panel is loaded via `loadAIAgent`
- **WHEN** `renderKnowledge` is called with a valid containerId
- **THEN** the AIAgent runtime state MUST remain unchanged
- **AND** no new AIAgent runtime SHALL be started

### Requirement: Knowledge source list item title resolution

列表项标题 SHALL 按以下优先级解析（递降）：
1. `source` 字段按 `|` 分割取第一项，trim 后非空 → 使用该项。
2. 为空 → 取 `title` 字段 trim 后非空 → 使用。
3. 为空 → 取 `knowledge` 字段前 100 个字符作为标题。

**需求类别**：功能性需求

#### Scenario: source field split by pipe takes first segment
- **GIVEN** a `KnowledgeSourceItem` with `source: "kb-a | kb-b | kb-c"` and `title: "doc"`
- **WHEN** the list item title is resolved
- **THEN** the title MUST be `"kb-a"`（trimmed first segment of source split by `|`）

#### Scenario: empty source falls back to title
- **GIVEN** a `KnowledgeSourceItem` with `source: ""` and `title: "network-doc"`
- **WHEN** the list item title is resolved
- **THEN** the title MUST be `"network-doc"`

#### Scenario: empty source and title fall back to knowledge prefix
- **GIVEN** a `KnowledgeSourceItem` with `source: ""`, `title: ""` and `knowledge` of 250 characters
- **WHEN** the list item title is resolved
- **THEN** the title MUST be the first 100 characters of `knowledge`

#### Scenario: whitespace-only source is treated as empty
- **GIVEN** a `KnowledgeSourceItem` with `source: "   "` and `title: "fallback"`
- **WHEN** the list item title is resolved
- **THEN** the title MUST be `"fallback"`（whitespace-only source treated as empty）

### Requirement: Knowledge source list renders into container with independent React root

`renderKnowledge` SHALL create an independent React root（不与 `loadAIAgent` 共享 root 状态）in the DOM element identified by `containerId`。The root MUST be wrapped with `AppProviders`（与 `loadAIAgentWithConfig` 同模式）to ensure antd ConfigProvider/theme/locale context is complete。

重复调用同一 `containerId`：MUST 复用现有 root 并重新渲染（替换内容）。不同 `containerId`：MUST unmount 旧 root、清空旧容器、在新容器创建新 root。

**需求类别**：功能性需求

#### Scenario: First render creates independent root with AppProviders
- **GIVEN** `renderKnowledge` is called with `containerId: "kb-list"` and a non-empty data array
- **WHEN** the handler executes
- **THEN** a new React root MUST be created in the `#kb-list` element
- **AND** the root MUST be wrapped with `AppProviders`
- **AND** a knowledge source list MUST be rendered

#### Scenario: Repeated call with same containerId reuses root
- **GIVEN** a React root already exists for `containerId: "kb-list"`
- **WHEN** `renderKnowledge` is called again with `containerId: "kb-list"` and new data
- **THEN** the existing root MUST be reused and re-rendered with new data
- **AND** no new root MUST be created

#### Scenario: Call with new containerId unmounts old root
- **GIVEN** a React root exists for `containerId: "kb-list-1"`
- **WHEN** `renderKnowledge` is called with `containerId: "kb-list-2"`
- **THEN** the old root for `kb-list-1` MUST be unmounted
- **AND** the old container MUST be cleared
- **AND** a new root MUST be created in `#kb-list-2`

### Requirement: Knowledge source detail opens in theme-aware modal

点击列表项 SHALL 打开 antd `Modal` 显示对应 `knowledge` 内容，用 `MarkdownContent` 解析。Modal MUST 通过 `AppProviders` 的 antd ConfigProvider 自动跟随当前主题（lightday/evening），无需额外主题处理。同一时间最多一个 Modal 打开；点击新列表项 MUST 替换当前 Modal 内容。

**需求类别**：功能性需求

#### Scenario: Click list item opens modal with markdown knowledge
- **GIVEN** the knowledge source list is rendered
- **WHEN** a list item is clicked
- **THEN** an antd Modal MUST open
- **AND** the Modal MUST display the item's `knowledge` parsed by `MarkdownContent`

#### Scenario: Modal follows current theme
- **GIVEN** the current host theme is `evening`
- **WHEN** a list item is clicked and the modal opens
- **THEN** the Modal and its MarkdownContent MUST render with the evening theme styling
- **AND** no explicit theme wiring beyond AppProviders is required

#### Scenario: Clicking another item replaces modal content
- **GIVEN** a Modal is open showing one item's knowledge
- **WHEN** another list item is clicked
- **THEN** the Modal content MUST be replaced with the new item's knowledge
- **AND** no second Modal MUST be opened

#### Scenario: Empty data array renders empty list
- **GIVEN** `renderKnowledge` is called with `containerId` and `data: []`
- **WHEN** the list renders
- **THEN** an empty list MUST be rendered without errors
- **AND** no Modal MUST be open
