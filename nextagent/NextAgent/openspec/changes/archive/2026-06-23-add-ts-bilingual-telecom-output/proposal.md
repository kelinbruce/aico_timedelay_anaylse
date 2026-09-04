## 背景与问题（Why）

当前对话系统的 System Prompt 仅包含 `Locale/language hint: zh-CN` 这一条语言提示，缺乏对模型输出语言的明确约束。实际使用中存在以下问题：

- **语言不一致**：当用户用中文提问时，模型有时用英文回答，或者混用中英文段落。Locale/language hint 来自前端请求 header，但模型不一定遵从，尤其当 hint 与实际输入语言不一致时（例如前端默认 zh-CN，但用户用英文提问）。
- **电信术语被翻译**：电信领域的专有名词（如 NE 名称、KPI 名称、counter、alarm、接口名、协议名）经常被模型自动翻译为中文，导致运维人员无法对应原始告警、日志或网管界面。
- **缺少明确的规则层级**：没有对"用户实际输入语言"与"声明的 locale hint"之间的优先级做明确规定，导致模型行为不可预测。

此功能的必要性：电信网络运维场景中，中英文混用是常态，运维人员在中文对话中经常插入英文设备名、告警短语和 KPI 表达式。模型必须能够：
1. 根据用户的当前输入语言决定输出语言
2. 在任何语言下保持电信术语原文不译

## 变更范围（What Changes）

- **在 communication-style.md 末尾追加规则**：将两条英文规则指令追加到已有 `communication-style.md` 末尾。不新建 section、不新增 template variable、不修改 pipeline 代码。
- **优先级语义**：规则文本中写明"即使 locale hint 指示了某种语言，也以用户当前消息的实际语言为准"，实现 override 效果。
- **保留 localeHint**：`Locale/language hint` 行继续由 `ModelInputRenderer.renderSystemMessageText()` 追加到 system prompt 末尾，不删除。

## Capability 影响（Capabilities）

### 新增 Capability
- `telecom-bilingual-output`: 定义 System Prompt 中关于模型输出语言跟随和电信术语保留的行为契约。

### 修改的 Capability
- 无。context-engine 的 section 拼装管线、variable resolver、template compiler、ModelInputRenderer 均不修改。

## 影响范围（Impact）

- `agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/communication-style.md`：末尾追加约 150 字符的英文规则文本。
- 测试：新增 rendering test 验证规则文本出现在渲染后的 system message 中。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/telecom-bilingual-output/spec.md`：新增

长期背景：
- 无新增。

设计视图：
- `openspec/designs/modules/agent-context-engine.md`：更新 prompt shaping 子模块职责描述，说明本规则归属。

验证入口：
- spec requirement contract tests（telecom-bilingual-output）
- system prompt rendering test（section contains rules text）
- negative test（localeHint preserved）
- characterization test（model output language follows user input language）
