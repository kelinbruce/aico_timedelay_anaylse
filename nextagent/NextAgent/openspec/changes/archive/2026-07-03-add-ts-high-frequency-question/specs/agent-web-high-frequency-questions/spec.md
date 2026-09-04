## MODIFIED Requirements

### Requirement: 高频问题独立组件

高频问题推荐区域 SHALL 作为独立 React 组件 `HighFrequencyQuestions` 实现，位于 `frontend/agent-web/src/features/high-frequency-questions/components/`。组件 SHALL 接收 `onQuestionClick?: (question: string) => void` prop。组件 SHALL 通过 `GET /api/v1/frequent-questions` 获取动态排序的问题列表。当 API 返回空列表或请求失败时，组件 SHALL fallback 到 i18n 硬编码的 4 个默认问题。`WelcomeState` SHALL 通过 `GuideArea` 容器渲染该组件。

#### Scenario: 独立组件渲染
- **WHEN** 渲染 Welcome 块
- **THEN** `HighFrequencyQuestions` 组件 MUST 通过 `GuideArea` 容器被渲染
- **AND** `WelcomeState` 中 MUST 不再包含 `welcome-suggestion-grid`、`welcome-suggestion-button`、`welcome-suggestion-label` 相关 DOM

#### Scenario: 问题点击回调
- **WHEN** 用户点击高频问题项
- **THEN** `onQuestionClick` 回调 MUST 被调用，参数为问题文本

#### Scenario: 动态数据获取
- **WHEN** 组件挂载
- **THEN** 组件 MUST 调用 `GET /api/v1/frequent-questions` 获取问题列表
- **AND** 返回非空列表时 MUST 渲染返回的问题

#### Scenario: 空列表 fallback
- **WHEN** API 返回 `questions: []`
- **THEN** 组件 MUST fallback 到 i18n 硬编码 4 个默认问题

#### Scenario: API 失败 fallback
- **WHEN** API 请求失败
- **THEN** 组件 MUST fallback 到 i18n 硬编码 4 个默认问题
- **AND** MUST NOT 向用户显示错误
