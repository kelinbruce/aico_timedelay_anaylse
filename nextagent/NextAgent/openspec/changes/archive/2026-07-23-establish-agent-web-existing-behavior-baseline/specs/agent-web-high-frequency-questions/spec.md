## ADDED Requirements

### Requirement: 欢迎页高频问题点击 SHALL 只回填 Composer

欢迎页 `HighFrequencyQuestions` 的问题点击 SHALL 将完整问题文本写入并聚焦普通 Composer 草稿。该点击 MUST NOT 创建 session、MUST NOT 调用 request submit，并 MUST 等待用户后续显式发送。此行为与消息 turn 内可直接触发提交的 suggested-question action 不同。

#### Scenario: 欢迎页问题回填但不发送
- **GIVEN** 用户位于尚未建立 session 的欢迎页
- **WHEN** 用户点击一个高频问题项
- **THEN** Agent Web SHALL 将完整问题文本填入并聚焦 Composer
- **AND** SHALL NOT 创建 session
- **AND** SHALL NOT 提交 request

#### Scenario: 回填文本成为普通草稿
- **WHEN** 欢迎页问题文本被回填 Composer
- **THEN** 该文本 SHALL 按普通 Composer 草稿语义保存和编辑
- **AND** 只有后续显式提交才 SHALL 创建或发送 request
