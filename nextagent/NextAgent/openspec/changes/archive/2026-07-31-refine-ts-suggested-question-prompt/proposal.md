## 背景与问题（Why）

回答后推荐问题当前使用一段较长的 system prompt。该 prompt 声称输入包含完整会话和高频追问，但实现只提供当前 request 的用户问题、最终回答和可选 Skill 上下文；它还要求每个问题具有可靠知识出处并保证准确无误。当上下文较短、Skill 缺失或最终回答不包含足够事实时，模型容易把这些约束理解为不能生成，返回空内容或只返回叙述性文字，最终前端不展示推荐问题。

## 变更范围（What Changes）

- 将推荐 system prompt 收敛为简短、无冲突的角色、选择规则和输出格式约束。
- 将当前 request 的可信上下文放入非空 user message；只在 Skill 上下文非空时包含该段。
- 明确上下文不足时仍应生成与当前主题相关的澄清、验证或下一步行动问题，不得因为缺少用户特征、Skill 或外部知识来源而返回空内容。
- 当同一 request 包含 retry、supersede 等多个 run 的消息时，推荐接口选择消息顺序中的最新 runId，避免使用旧 run 导致空推荐。
- 删除未接入数据源的“完整会话”“高频追问”和空用户特征表述。
- 保留现有模型选择、scope、超时、temperature、输出解析、REST API、前端触发和失败降级行为。
- **BREAKING**：无。`SuggestedQuestionPort`、Web DTO、route 和持久化契约均不变。

## Capability 影响（Capabilities）

### 修改的 Capability

- `question-recommendation`：提高已有动态追问生成的稳定性，减少有效完成请求得到空推荐的概率。

## 影响范围（Impact）

- `agent-session`：修改推荐 prompt 组装。
- `agent-channel-web`：修正推荐接口的 runId 选择。
- `agent-app`、`agent-channel-web` tests：增加模型可见 prompt 和多 run route 契约测试。
- 不修改 `agent-contracts`、runtime lifecycle、gateway、Web API、前端或持久化。
- 验证：suggested-question focused tests、OpenSpec strict validation、语义审查。
