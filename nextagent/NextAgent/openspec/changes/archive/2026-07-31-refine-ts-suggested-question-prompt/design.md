## 背景和现状（Context）

`SuggestedQuestionService` 已在成功 terminal commit 后读取当前 request messages 和 timeline Skill evidence，通过 `ModelInvocationService.complete()` 生成最多三条推荐问题。当前 system message 同时承载指令和所有上下文，user message 为空；空的用户特征字段和未提供的数据来源描述会增加模型拒绝生成或空生成的概率。现有 parser 已覆盖空行、单换行、序号、Markdown 和 think 标签，无需引入第二套输出协议。

## 目标和非目标（Goals / Non-Goals）

**目标：**让模型收到与真实输入一致、简短且确定的推荐任务；在上下文较少或 Skill 缺失时仍生成安全的澄清型或推进型问题；通过测试锁定消息角色、条件上下文和禁止的矛盾措辞。

**非目标：**不引入重试、缓存策略变更、结构化输出 schema、新模型配置、完整 session history、高频问题数据、用户画像、个性化排序或前端变化。

## 设计决策（Decisions）

1. system message 只定义任务、问题选择顺序和三行纯文本输出格式，不包含动态业务内容。
2. user message 承载明确的本轮生成请求，以及服务端可信的当前用户问题、最终回答和可选 Skill 上下文，确保 provider 收到有实际语义的非空任务输入并保持指令与数据分层。用户问题或最终回答缺失时使用显式“未提供”占位，不发送空字段值。
3. Skill 上下文为空时省略整个段落，不发送空标签；不再发送当前固定为空的用户特征字段。
4. 推荐选择顺序固定为：优先推进当前任务，其次验证答案或补充关键条件，最后在上下文不足时提出具体澄清问题。输出语言优先跟随用户问题；用户问题缺失时跟随最终回答；两者都缺失时使用中文。所有问题保持同一主题和单一意图。
5. 删除“完整会话”“高频追问”“可靠知识出处”和“确保准确无误”等与实际输入或生成任务冲突的承诺。模型不得编造回答中不存在的事实，但可询问缺失事实。
6. 保留现有三行 parser 协议。模型异常、safe error 或真实空输出继续按既有行为降级为空列表；本 change 不用额外模型调用掩盖 provider 失败。
7. Web route 读取的 request messages 已按消息顺序返回；当其中存在多个 runId 时，选择最后一条带 runId 消息所引用的 run。`SuggestedQuestionService` 继续负责校验该 run 必须 `COMPLETED + COMMITTED`，不把 lifecycle truth 转移到 channel。

## 验证映射（Verification Map）

| 约束 | 验证入口 |
|---|---|
| system 指令简短且无虚假数据承诺 | prompt contract unit test |
| user message 非空并包含 query/final answer | model request unit test |
| Skill 非空时包含、为空时省略 | positive/negative prompt unit tests |
| 上下文不足时要求生成澄清型问题 | prompt contract unit test |
| 三行纯文本、无序号和无附加说明 | prompt contract unit test |
| 多 run request 选择最新 runId | suggested-questions route test |
| port、route、模型参数和 parser 不变 | existing suggested-question tests |

## 风险与取舍（Risks / Trade-offs）

- [Prompt 改写可能改变推荐风格] → 用任务推进、验证、澄清的固定优先级保持结果可预测。
- [不增加重试无法覆盖 provider 真实空响应] → 本 change 只修复 prompt 引起的空生成，provider failure 保持既有安全降级。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.6-向用户提问` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/question-recommendation/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
