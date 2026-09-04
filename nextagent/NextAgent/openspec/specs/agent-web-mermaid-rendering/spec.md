# agent-web-mermaid-rendering Specification

## Purpose
定义完整 standalone Mermaid fence 的识别、惰性异步渲染、陈旧结果隔离、通用失败降级和视口尺寸通知边界；不承诺完整 SVG sanitization、任意 URL/style 安全或精确视觉样式。
## Requirements
### Requirement: Markdown SHALL execute only complete standalone triple-backtick Mermaid fences

Agent Web SHALL recognize Mermaid only from a case-insensitive standalone opening line made of exactly three backticks followed by `mermaid`, apart from surrounding whitespace, and a standalone closing line made of exactly three backticks. Tilde fences and four-or-more-backtick fences SHALL remain ordinary Markdown/code content. An incomplete Mermaid fence SHALL remain ordinary text code and SHALL NOT execute during streaming.

#### Scenario: Complete Mermaid fence is recognized
- **WHEN** Markdown contains a complete standalone triple-backtick block labelled `mermaid` in any letter case
- **THEN** Agent Web SHALL route that block to Mermaid rendering

#### Scenario: Other fence markers are not Mermaid execution entries
- **WHEN** Markdown uses a tilde fence or a four-or-more-backtick fence labelled `mermaid`
- **THEN** Agent Web SHALL NOT route that block to Mermaid rendering

#### Scenario: Incomplete Mermaid fence remains code
- **WHEN** a streamed Mermaid fence has no closing fence
- **THEN** Agent Web SHALL render it as ordinary text code
- **AND** SHALL NOT invoke Mermaid for the incomplete source

### Requirement: Mermaid rendering SHALL be lazy and stale-result safe

Agent Web SHALL defer Mermaid rendering until the diagram is near the viewport. Rendering SHALL occur on the browser main thread with a loading indicator. If the source changes while an earlier asynchronous render is pending, completion or failure from the older render SHALL NOT overwrite the newer source state.

#### Scenario: Offscreen diagram is deferred
- **GIVEN** a Mermaid block is outside the near-viewport observation area
- **WHEN** the Markdown turn is rendered
- **THEN** Agent Web SHALL defer invoking Mermaid until the block approaches the viewport

#### Scenario: Older render result is ignored
- **GIVEN** one Mermaid render is pending and the source changes
- **WHEN** the older render later succeeds or fails
- **THEN** its result SHALL NOT replace the state for the newer source

### Requirement: Mermaid failure SHALL be generic and shall clear stale SVG

While rendering, Agent Web SHALL show a loading indicator. If Mermaid rendering fails, it SHALL clear any prior SVG for that block and show the current generic failure message in the UI. This capability does not claim that the hard-coded message is localized. A failed diagram SHALL NOT leave a previous diagram visible as if it matched the current source.

#### Scenario: Current render fails after a previous success
- **GIVEN** a Mermaid block previously rendered successfully
- **WHEN** rendering its current source fails
- **THEN** Agent Web SHALL clear the previous SVG
- **AND** SHALL show the generic Mermaid failure state

### Requirement: Mermaid size changes SHALL notify the chat viewport owner

After a Mermaid diagram renders, and when its rendered size later changes, Agent Web SHALL notify the owning chat viewport so existing follow-output or reading-position behavior can react. During rendering, document overflow suppression SHALL be restored after the last overlapping render completes.

#### Scenario: Diagram render notifies its parent
- **WHEN** Mermaid rendering completes or the diagram size changes
- **THEN** Agent Web SHALL notify the parent chat layout

#### Scenario: Overlapping renders restore overflow once
- **GIVEN** multiple Mermaid renders overlap
- **WHEN** all active render promises settle
- **THEN** Agent Web SHALL restore the prior document overflow state
