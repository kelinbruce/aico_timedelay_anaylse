# agent-web-bi-report-generation Specification Delta

## MODIFIED Requirements

### Requirement: 报告 DSL 渲染与 StreamDSLContext

报告 DSL 卡片 SHALL 由独立组件 `ReportAnswerCard` 渲染。`ReportAnswerCard` MUST 直接使用 `DSLEngine` 渲染 DSL 卡片，不再自行包裹 `StreamDSLContext`。`StreamDSLContext` 由 `TurnBlock` 答案区外层提供，覆盖 `ReportAnswerCard` 和 `AnswerSegments` 两条渲染路径。

`StreamDSLContext` 的 props 在 `TurnBlock` 中组装，只传递 `local`、`theme`、`conversationId`（即 `sessionId`）。`expandPanelId` 和 `handleExpandPanel` 不再通过 `StreamDSLContext` props 传递，而是通过 `init` 方法全局注册。

`ReportAnswerCard` MUST NOT import `StreamDSLContext`、`useAppHostContext`、`getCurrentLocale`、`supportedLocaleToHostLocale`、`EXPAND_PANEL_DIV_ID` 或 `expandPanelStore`。这些职责已移至 `TurnBlock` 和 `renderRoot`。

`ReportAnswerCard` 的 `import` 来源 MUST 从 `@cloudsop/dsl-engine-web/generateui` 迁移到 `@cloudsop/dsl-engine-web/genui-components`（如果仍需要 `StreamDSLContext`），或完全移除（如果 `StreamDSLContext` 包裹已移至外层）。

#### Scenario: ReportAnswerCard 不再包裹 StreamDSLContext

- **WHEN** `ReportAnswerCard` 渲染 BI 报告 DSL 卡片
- **THEN** `ReportAnswerCard` MUST NOT 包裹 `StreamDSLContext`
- **AND** MUST 直接渲染 `<DSLEngine data={[content]} />`

#### Scenario: TurnBlock 答案区外层提供 StreamDSLContext

- **WHEN** `TurnBlock` 渲染答案区（BI 报告路径或常规答案路径）
- **THEN** 答案区 MUST 被 `<StreamDSLContext local={...} theme={...} conversationId={sessionId}>` 包裹
- **AND** `StreamDSLContext` MUST 覆盖 `ReportAnswerCard` 和 `AnswerSegments` 两条渲染路径

#### Scenario: StreamDSLContext 只传 local theme conversationId

- **WHEN** `StreamDSLContext` 在 `TurnBlock` 中渲染
- **THEN** props MUST 只包含 `local`、`theme`、`conversationId`
- **AND** MUST NOT 包含 `expandPanelId` 或 `handleExpandPanel`

#### Scenario: 不再从 generateui 导入 StreamDSLContext

- **WHEN** 前端代码引用 `StreamDSLContext`
- **THEN** import 来源 MUST 为 `@cloudsop/dsl-engine-web/genui-components`
- **AND** MUST NOT 从 `@cloudsop/dsl-engine-web/generateui` 导入