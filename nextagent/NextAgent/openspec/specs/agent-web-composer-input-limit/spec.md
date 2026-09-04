# agent-web-composer-input-limit Specification

## Purpose

定义前端 Composer 输入框的长文本截断与引导行为：当用户输入或粘贴的文本超过 2000 字符阈值时，前端 MUST 自动截断并通过 inline notice 引导用户使用 `.md` 文件作为附件上传大文本，同时提供接近阈值时的字符计数器。该能力确保前端输入边界与后端 markdown 附件强制接受配合，引导用户以附件而非超长文本提交大内容。
## Requirements
### Requirement: Composer 输入框长文本截断与引导

前端 Composer 输入框 MUST 在 textarea 内容超过 `LONG_TEXT_THRESHOLD`（2000 字符）时自动截断至 2000 字符，并显示 inline notice 提示用户内容已截断，引导用户使用 .md 文件作为附件上传大文本。中文字符和英文字符都算 1 个字符。截断 MUST NOT 禁用发送按钮，用户可以正常发送截断后的 2000 字符文本。当 textarea 内容未超过阈值时，MUST NOT 截断且 MUST NOT 显示该提示。

#### Scenario: 输入超过 2000 字符时自动截断并提示
- **WHEN** 用户在 Composer textarea 中输入或粘贴超过 2000 字符的文本
- **THEN** 前端 MUST 自动将 textarea 内容截断至 2000 字符
- **AND** 前端 MUST 在输入框上方显示 warning 类型 inline notice
- **AND** 提示内容 MUST 包含内容已截断的信息
- **AND** 提示内容 MUST 引导用户使用 .md 文件作为附件上传大文本
- **AND** 前端 MUST NOT 禁用发送按钮

#### Scenario: 输入未超过 2000 字符时不截断不提示
- **WHEN** 用户在 Composer textarea 中输入不超过 2000 字符的文本
- **THEN** 前端 MUST NOT 截断 textarea 内容
- **AND** 前端 MUST NOT 显示长文本引导 inline notice

#### Scenario: 截断后用户继续编辑时清除提示
- **WHEN** 用户在截断提示显示后继续编辑 textarea 内容
- **THEN** 前端 MUST 移除长文本引导 inline notice
- **AND** 若编辑后内容仍超过 2000 字符，前端 MUST 再次截断并重新显示提示

#### Scenario: 字符数接近阈值时显示计数器
- **WHEN** Composer textarea 内容超过阈值的 90%（即 1800 字符）且未超过阈值
- **THEN** 前端 MUST 显示字符计数器，格式为当前字符数与阈值的比值
- **AND** 计数器 MUST 使用 warning 视觉样式

#### Scenario: 粘贴和手动输入行为一致
- **WHEN** 用户通过粘贴或手动输入使 textarea 内容超过 2000 字符
- **THEN** 前端 MUST 执行相同的截断和提示行为，不区分输入来源

