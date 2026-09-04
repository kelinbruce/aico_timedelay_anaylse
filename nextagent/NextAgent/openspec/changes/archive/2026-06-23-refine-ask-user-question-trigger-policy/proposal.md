## 背景与问题（Why）

`AskUserQuestion` 已经能把模型发起的短问题转为 runtime-owned `QUESTION` pending input，但模型是否使用该工具仍主要依赖工具描述本身。实际验证中，模型可能在任务被用户输入阻塞时只用普通文本追问，导致前端不会进入 pending input 交互，用户需要再次发送消息才能继续。

同时，内置 `network-explorer` 是被 `default-agent` 调用的只读网络证据收集子 Agent。若子 Agent 也能直接创建用户 pending input，会模糊“谁在向用户提问、用户回答恢复哪条执行路径”的边界，并扩大 `network-explorer` 的职责。

本变更需要用最小方式收紧触发指导和 Agent 能力边界：让面向用户的主 Agent 在确实被普通用户输入阻塞时使用 `AskUserQuestion`，同时让被调用的只读子 Agent 通过缺失数据说明返回给主 Agent，而不是直接中断用户交互。

## 变更范围（What Changes）

- 在主系统提示词中增加 `AskUserQuestion` 触发规则：当前任务无法安全继续，且缺失的是用户掌握、无法从上下文或工具获得、短且可直接回答的普通信息时，模型 MUST 调用 `AskUserQuestion`，而不是只用普通文本追问。
- 在提示词中明确负向边界：不得把 `AskUserQuestion` 用于凭证、密钥、授权授予、受保护操作审批、高风险确认、人工接管、问卷或长表单。
- 明确模型不得向用户暴露内部工具名；用户只看到自然语言问题。
- 在内置 `network-explorer` 配置中显式禁用 `AskUserQuestion`，保持它作为只读证据收集子 Agent 的边界；缺信息时返回 missing-data gaps，由 `default-agent` 决定是否面向用户提问。
- 不改变 runtime 的 producer routing、pending input lifecycle、schema validation、answer/resume 语义。
- 不新增自然语言启发式路由、意图分类器、policy engine、自动 pending input router 或强制 tool_choice。

## Capability 影响（Capabilities）

### 新增 Capability
- `ask-user-question-trigger-policy`: 定义 `AskUserQuestion` 的模型触发指导和 invoked Agent 可见性边界。

### 修改的 Capability

无。

## 影响范围（Impact）

- 代码配置：`packages/agent-core/src/builtin-agents/network-explorer/agent.yaml`。
- Prompt：`packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/*` 中的系统提示词内容。
- 测试：配置组装、invoked Agent discovery/config、prompt contract 或相关上下文组装测试。
- 运行时：无 runtime 行为变更；现有 `AskUserQuestion` producer branch 和 pending input lifecycle 保持不变。
- Web/API：无接口或传输协议变更。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ask-user-question-trigger-policy/spec.md`：新增 `AskUserQuestion` 触发策略和 invoked Agent 边界。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/agent-capability-boundary.md`：归档前提炼主 Agent 与 invoked Agent 对用户交互能力的边界。
- `openspec/designs/modules/agent-context-engine.md`：归档前提炼系统提示词承载触发指导、不改变 runtime 语义路由的设计。
- `openspec/designs/modules/agent-core.md`：归档前提炼 built-in Agent 配置对 capability 可见性的收敛方式。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：归档前增加 `ask-user-question-trigger-policy` 到相关设计文档的导航。

验证入口：
- `openspec validate --all --strict`
- `npm run test:contract`
- 针对配置组装和 invoked Agent capability 可见性的 Vitest 用例
