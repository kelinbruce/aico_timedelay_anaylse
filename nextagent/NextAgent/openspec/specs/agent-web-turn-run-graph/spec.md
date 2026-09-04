# agent-web-turn-run-graph Specification

## Purpose
定义可追踪 process turn 的 Run Graph 入口、canonical display-order 投影、turn 锚定、响应式与可访问交互、安全详情边界及图形渲染失败时的文本回退。
## Requirements
### Requirement: Turn Run Graph SHALL be offered only for traceable process turns

Agent Web SHALL treat a turn as eligible for the user-facing complete-process entry only when it has process timeline content including thinking or Capability activity. A history-loaded event SHALL qualify only when it carries a non-empty backend `timelineEventRef`; a conversation-only historical Capability summary SHALL NOT manufacture a graph entry. Whether the eligible entry is enabled by display configuration is owned outside this capability.

#### Scenario: Live process turn offers the graph
- **GIVEN** a turn contains process timeline entries with thinking or Capability activity
- **WHEN** the turn is rendered and the current display configuration enables the graph entry
- **THEN** Agent Web SHALL offer its complete-process graph entry

#### Scenario: Unreferenced history summary does not offer the graph
- **GIVEN** historical Capability content exists only as conversation projection without `timelineEventRef`
- **WHEN** the turn is rendered
- **THEN** Agent Web SHALL NOT offer a Turn Run Graph for that content

### Requirement: Run Graph projection SHALL preserve canonical event order and correlation

Agent Web MUST order graph input by backend sequence, then timestamp, then event id. It SHALL project request, model, Capability, user-input, degradation, LLM text answer, and terminal nodes. If stream activity exists without an explicit `REQUEST_ACCEPTED`, Agent Web MAY add an inferred stream-start node but SHALL NOT assign it a fabricated backend event reference. Capability events SHALL be correlated by the available tool-call, invocation, metadata invocation, or Capability identifier. For `LLM_CONTENT_DELTA` answer events, graph answer content SHALL follow the same accumulated and compacted-event merge semantics used by the turn text projection. This capability does not claim Run Graph answer-node coverage for `TOOL_STRUCTURED_DELTA` answer content; that projection remains owned by the Stable `tool-structured-delta` and `agent-web-structured-message-rendering` capabilities.

#### Scenario: Tied event positions use deterministic order
- **GIVEN** graph events with missing or equal sequence positions
- **WHEN** Agent Web builds the graph
- **THEN** it SHALL fall back to timestamp and then event id for deterministic order

#### Scenario: Missing accepted event produces only an inferred start
- **GIVEN** stream events exist without an explicit `REQUEST_ACCEPTED`
- **WHEN** Agent Web builds the graph
- **THEN** it MAY add an inferred stream-start node
- **AND** that node SHALL NOT claim a backend event reference

#### Scenario: Capability lifecycle events converge on one logical node
- **GIVEN** Capability start, result, and completion events share an available correlation identifier
- **WHEN** Agent Web builds the graph
- **THEN** it SHALL associate them with the same logical Capability execution

### Requirement: Run Graph edges SHALL represent display order rather than causality

Graph edges SHALL connect adjacent nodes in the projected display order. Agent Web MUST NOT describe these edges as authoritative causal calls, stages, iterations, or loop structure. On a terminal request state, remaining running or waiting nodes SHALL converge to the corresponding completed, failed, canceled, or superseded presentation.

#### Scenario: Adjacent edge is not presented as a causal proof
- **WHEN** two projected nodes are adjacent in display order
- **THEN** Agent Web MAY draw an edge between them
- **AND** the UI and documentation SHALL treat it as ordered presentation rather than backend causality

#### Scenario: Terminal state closes active visual states
- **WHEN** the request reaches a terminal state
- **THEN** graph nodes still shown as running or waiting SHALL converge to the applicable terminal presentation

### Requirement: Selected Run Graph SHALL remain turn-anchored across live updates

Opening a Run Graph SHALL anchor it to the selected turn's root message id. New events for that same turn SHALL update the graph and its LLM text answer projection without changing the selected turn. Switching session or removing the anchored turn SHALL close the graph. Coordination with Expand Panel and structured-answer projection remains owned by the Stable `agent-web-expand-panel` and `agent-web-structured-message-rendering` capabilities and is not defined here.

#### Scenario: Live events update the anchored turn
- **GIVEN** the graph is open for a turn
- **WHEN** additional events arrive for the same root message id
- **THEN** Agent Web SHALL update that graph without moving selection to another turn

#### Scenario: Session switch closes the graph
- **WHEN** the user switches to another session
- **THEN** Agent Web SHALL close the prior session's Run Graph

### Requirement: Run Graph SHALL provide responsive, keyboard-accessible, text-equivalent interaction

In sufficient width Agent Web SHALL render the graph in a resizable side region; when space is insufficient it SHALL use a right-side drawer. Resizers SHALL support pointer and keyboard arrow, Home, and End interactions. Opening the graph SHALL focus its close control, and closing it SHALL restore focus to the invoking control when that control still exists. The graph SHALL support fit, reset, bounded pan and zoom, and node selection. The canvas SHALL be hidden from the accessibility tree while a focusable textual summary exposes the same projected facts. Motion SHALL respect `prefers-reduced-motion`.

#### Scenario: Narrow layout uses a drawer
- **GIVEN** available width is insufficient for the side region
- **WHEN** the graph is opened
- **THEN** Agent Web SHALL render the same graph details in a right-side drawer

#### Scenario: Closing restores the opener focus
- **GIVEN** the graph was opened from a turn control that remains mounted
- **WHEN** the user closes the graph
- **THEN** Agent Web SHALL restore focus to that control

#### Scenario: Canvas is not the only information carrier
- **WHEN** the graph is rendered
- **THEN** its canvas SHALL be excluded from the accessibility tree
- **AND** an operable text summary SHALL expose the projected node facts

### Requirement: Run Graph detail SHALL avoid raw chain-of-thought and raw event JSON

The user-facing graph SHALL represent thinking as progress metadata rather than raw chain-of-thought. It SHALL suppress complete object- or array-shaped JSON from Capability detail and SHALL prefer a parsed safe terminal error code when available. It SHALL NOT bind the graph canvas directly to retained raw event objects. This requirement does not classify arbitrary plain-text event detail as fully redacted or production-safe.

#### Scenario: Thinking is represented without raw content
- **WHEN** thinking delta events contribute to a model node
- **THEN** the graph SHALL expose progress such as update count
- **AND** SHALL NOT expose the raw chain-of-thought text

#### Scenario: Object-shaped Capability detail is suppressed
- **WHEN** a Capability result is a complete JSON object or array string
- **THEN** Agent Web SHALL NOT render that raw JSON as graph detail

### Requirement: Graph renderer failure SHALL retain the textual process summary

If the graph library fails to load or initialize, Agent Web SHALL show a generic error in the canvas region and SHALL preserve the textual process summary. The failure UI SHALL NOT replace the entire process-detail surface.

#### Scenario: Canvas initialization fails
- **WHEN** the graph renderer cannot load or initialize
- **THEN** Agent Web SHALL display a generic canvas-region failure
- **AND** the textual summary SHALL remain available
