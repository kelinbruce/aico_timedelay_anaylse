## Function

- **所属 Function**：`FN-1.22 展示会话消息正文`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Sanitized Markdown and Mermaid output uses a dedicated parser mount

Agent Web MUST keep the existing Markdown sanitization and Mermaid SVG cleanup boundaries before DOM mounting. The final mount for sanitized block Markdown, inline Markdown, and Mermaid SVG/style output MUST go through one dedicated parser-based mount component. Agent Web production source MUST NOT use `dangerouslySetInnerHTML` or direct `innerHTML` assignment for these outputs. A mount update MUST replace stale child nodes so an older Markdown segment or Mermaid diagram cannot remain visible.

**需求类别**：系统质量属性

**质量属性**：安全、可维护性、可测试性
**适用范围**：该 Function

#### Scenario: 已净化正文通过统一挂载边界进入 DOM

- **WHEN** completed Markdown body 或 Mermaid diagram produces sanitized HTML
- **THEN** Agent Web MUST mount that HTML through the dedicated parser-based mount component
- **AND** MUST preserve the upstream Markdown/Mermaid sanitization boundary

#### Scenario: 更新时清除旧渲染节点

- **WHEN** sanitized Markdown or Mermaid HTML changes
- **THEN** the mount MUST replace its previous child nodes
- **AND** stale nodes from the prior render MUST NOT remain in the DOM

#### Scenario: 生产源码禁止直挂载原始 HTML

- **WHEN** Agent Web production source is inspected
- **THEN** it MUST NOT contain `dangerouslySetInnerHTML` or direct `innerHTML` assignment for Markdown/Mermaid rendering
- **AND** raw executable HTML from assistant content MUST NOT be mounted or executed

## Function 变更汇总

### 规格

- **规格项**：已净化 HTML 挂载方式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：block Markdown、inline Markdown 与 Mermaid 输出先维持既有净化，再经统一 parser mount 挂载；生产源码禁止 `dangerouslySetInnerHTML` / 直接 `innerHTML` 赋值，并更新时清除旧节点
- **依据 Requirements**：`Sanitized Markdown and Mermaid output uses a dedicated parser mount`
