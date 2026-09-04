# add-piu-submit-to-conversation

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：product interaction contract candidate
主要 owner：`frontend/agent-web` structured PIU / composer integration
认领人：不可认领
依赖：已完成的 `refine-piu-message-emit-payload` 与现有 shared composer/request lifecycle；`useChatComposerController.injectQuestion` 只作为当前内部能力证据，不冻结为 public contract

当前状态：
- `PiuMessage` 可加载嵌套 ToolMessageType PIU，并向 `piu.emit()` 提供 Expand Panel 控制字段，但没有 submit/save callback。
- `sendQuestionToLui` 面向协作式 AIAgent PIU host；它不是嵌套 PIU 向当前会话反馈用户结果的路径。

目标：
- 让 Expand Panel 内的嵌套 PIU 在用户明确提交后，通过 typed `onPiuSubmit` operation 把受控结构化结果反馈到当前会话，由 Agent 决定后续动作。

进入 `ready` 前必须确认：
- `onPiuSubmit` 是只注入 composer 草稿，还是立即创建新请求；首版只能选择一种行为。
- 结构化值如何序列化为会话输入、最大字节数和最大嵌套深度是多少。
- PIU identity、当前 session identity 和提交动作由哪个可信 state 提供；内容数据不得覆盖这些字段。
- credential/token、不可序列化值、循环引用和超限数据如何拒绝并呈现 safe failure。
- 重复点击、提交进行中、提交失败和 retry 的唯一 UI 状态机。

实现约束：
- 唯一路径必须是 `nested PIU -> typed callback -> existing composer/request path`，不得改造成 collaborative host business callback。
- local、immersive、collaborative 三种宿主复用同一聊天 workspace 语义；宿主布局差异不得改变提交语义。
- 历史恢复、PIU render、Expand Panel open/close 和取消不得触发 submit side effect。
- PIU 不直接调用后端业务 API，不直接修改网管配置，不广播任意 `CustomEvent`。

非目标：
- 不定义宿主业务 API，不修改 request lifecycle、identity、Agent Scope 或 Owner Scope。
- 不替代 `sendQuestionToLui`，不为 ACTION/OPERATOR 创建第二套 dispatch registry。

转为 `ready` 后的验收出口：
- frontend contract tests 覆盖唯一选定的草稿或立即发送路径、单次提交、重复点击、非法/超限 payload、失败重试和 history 无副作用。
- multi-host tests 证明三种宿主复用同一 submit 语义。
- frontend build、相关 tests 和 `build:vite:modes` 通过。

并行边界：
- clarify 状态不可实施。
- 不修改 `agent-channel-web`、`agent-runtime`、session persistence、pending input 或宿主业务协议。
