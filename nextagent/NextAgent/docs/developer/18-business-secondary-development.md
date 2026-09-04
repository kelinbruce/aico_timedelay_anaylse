# 业务二次开发指南

这一篇不是讲框架全貌，而是讲业务团队如何在 NextAgent 上做二次开发并稳定交付。

适合的读者：

- 需要基于现有 NextAgent 框架做一个新业务 Agent
- 需要接入企业知识、内部接口、诊断流程或报告流程
- 希望知道“最少改哪里”“先做什么”“做到什么算交付完成”

不适合的场景：

- 你要改 runtime 状态机、terminal commit、stream 语义、gateway 持久化模型
- 你要绕过 sandbox / capability governance / owner scope / agent scope
- 你要在未定义 OpenSpec 的情况下直接改公共契约

## 先说结论

业务二开优先走这四层，从低风险到高风险：

1. Agent 配置
2. Prompt 模板
3. Tool / Skill / Agent capability
4. Lifecycle Hook

如果以上四层都表达不了，再考虑 Kernel / Composition Root 级改动；这时必须先补 OpenSpec change。

## 最短落地路径

目标：最短时间交付一个“能被调用、能完成业务任务、能验证结果”的新业务 Agent。

### Step 1. 定义业务边界

先写清楚 4 个问题：

- 用户是谁：运维、审查、报表、知识问答，还是客户系统集成
- 输入是什么：自然语言、配置文件、日志、巡检报告、工单
- 输出是什么：诊断结论、审查报告、结构化摘要、操作建议
- 禁止项是什么：不能改配置、不能执行高风险命令、不能泄漏敏感信息

如果这 4 点说不清，不要先写代码。

### Step 2. 决定能力形态

先判断需求属于哪一类：

| 需求 | 首选 |
| --- | --- |
| 单一动作、输入输出明确、无需模型规划 | Tool |
| 领域流程、操作手册、专家步骤编排 | Skill |
| 需要隔离上下文、委托给专家子智能体 | Agent capability |
| 调整语气、术语、输出风格 | Prompt 模板 |
| 增加审计、治理、脱敏、控制 | Lifecycle Hook |

不要把“改回答风格”做成 Tool，也不要把“执行一个确定动作”做成 Skill。

### Step 3. 建一个新业务 Agent

推荐目录：

```text
<configRoot>/agents/<your-agent-id>/
├── agent.yaml
└── prompts/
    └── SYSTEM_PROMPT/
        └── template.yaml
```

最小 `agent.yaml` 示例：

```json
{
  "agentId": "network-audit-agent",
  "agentVersion": "v1",
  "displayName": "网络审查智能体",
  "description": "用于网络配置审查与风险提示的业务智能体",
  "userInvocable": true,
  "modelIds": ["MiniMax-M2.7-highspeed"],
  "defaultModelId": "MiniMax-M2.7-highspeed",
  "capabilityBindings": [
    {
      "capabilityId": "read",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "grep",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "config-review",
      "capabilityType": "SKILL",
      "providerId": "local-skills",
      "enabled": true
    }
  ],
  "runtimeSettings": {
    "defaultLanguage": "zh-CN",
    "maxTurns": 20,
    "maxToolCallsPerTurn": 20,
    "requestTimeoutMs": 1800000
  },
  "resources": []
}
```

然后在 `packages/agent-app/config/default-system.yaml` 里切换：

```json
{
  "hostedAgent": {
    "activeAgentId": "network-audit-agent"
  }
}
```

### Step 4. 先用 Prompt 定业务身份

很多业务二开第一版不需要先写新 Tool，先把业务身份和输出约束固化到 prompt 模板即可。

`prompts/SYSTEM_PROMPT/template.yaml` 示例：

```yaml
schemaVersion: nextagent.prompt-template/v1
purpose: SYSTEM_PROMPT
content:
  - id: identity
    inline: 你是面向电信网络配置审查的只读业务智能体。
  - id: responsibilities
    inline: 你的职责是识别配置缺陷、解释风险、给出整改建议，不执行修改。
  - id: output
    inline: 输出必须包含问题摘要、风险说明、证据来源和整改建议。
```

适用场景：

- 只是把默认 Agent 变成某个业务角色
- 只是要求输出结构更稳定
- 只是要求术语、语言、报告格式更一致

### Step 5. 只在必要时新增 Tool / Skill

如果 Prompt 不够，再看是否需要新能力。

#### 什么时候新增 Tool

- 需要读取某类外部事实
- 需要执行一个确定动作
- 输入输出稳定，可以 schema 化
- 不需要模型自己理解一大段流程正文

Tool 示例边界：

- 读取设备配置
- 读取告警文件
- 查询内部接口
- 生成某类固定结构报告

#### 什么时候新增 Skill

- 需要复用一套业务流程
- 重点是“怎么分析”和“怎么组织步骤”
- 不是新增底层执行能力，而是复用已有 Tool

Skill 示例边界：

- OSPF 邻居异常诊断
- 配置审查 checklist
- 巡检报告生成流程

### Step 6. 用最短 API 路径验证

先不要一上来联调复杂前端。先用 curl 跑通主路径：

```bash
# 1. 创建会话
curl -X POST http://127.0.0.1:3000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"locale":"zh-CN"}'

# 2. 提交请求
curl -X POST http://127.0.0.1:3000/api/v1/sessions/sess_xxx/requests \
  -H "Content-Type: application/json" \
  -d '{"inputText":"请审查这份网络配置","idempotencyKey":"business-dev-001","locale":"zh-CN"}'

# 3. 看 SSE
curl -N http://127.0.0.1:3000/api/v1/sessions/sess_xxx/stream?requestId=req_xxx
```

只要这条链路通了，再去做前端或更复杂的集成。

## 什么时候选 Tool / Skill / Hook

### Tool

适合：

- 单次动作
- 输入输出结构明确
- 需要 runtime schema validation
- 可以独立测试

不要用 Tool 做：

- 纯提示词编排
- 大段领域手册注入
- 改 runtime 主流程控制语义

### Skill

适合：

- 复合领域流程
- 专家式步骤说明
- 需要复用多个现有 Tool
- 希望模型基于 `description` / `when_to_use` 做更稳的路由

不要用 Skill 做：

- 代替底层执行器
- 承载高风险执行权限
- 表达 owner scope / agent scope / auth 逻辑

### Hook

适合：

- 审计
- 输出脱敏
- 参数治理
- 受控阻断
- pending input 控制

不要用 Hook 做：

- 新增业务主能力
- 绕过 capability binding
- 修改 terminal commit 规则
- 写一个“业务流程引擎替代品”

## 三种典型二开模式

### 模式 A：只改业务身份，不加新能力

适合：

- 智能问答
- 审查解释
- 业务摘要

改动：

- 新 Agent
- 新 SYSTEM_PROMPT
- 可选调整 capabilityBindings

第一版交付标准：

- 能稳定输出业务语气
- 能按固定结构回答
- 不越权使用无关能力

### 模式 B：复用内置 Tool，加 Skill 编排

适合：

- 配置审查
- 故障诊断
- 报告生成

改动：

- 新 Agent
- 一个或多个本地 Skill
- 绑定 `read` / `grep` / `write` / `rag` / memory tools 等已有 Tool

第一版交付标准：

- 能命中正确 Skill
- 能完成端到端任务
- 输出里能看到业务证据和建议

### 模式 C：新增业务 Tool

适合：

- 需要调用内部接口
- 需要接企业知识源
- 需要接设备查询 API

改动：

- 新 Tool 定义
- app composition 注入或 capability source 接入
- Agent 绑定新 Tool
- 必要时再配 Skill

第一版交付标准：

- Tool 输入输出 schema 稳定
- Tool 失败能安全降级
- 主路径能看到 Tool 调用结果被模型消费

## 推荐目录模板

### 方案 1：业务 Agent + 本地 Skill

```text
<configRoot>/agents/network-audit-agent/
├── agent.yaml
└── prompts/
    └── SYSTEM_PROMPT/
        └── template.yaml

<configRoot>/skills/
└── config-review/
    └── SKILL.md
```

### 方案 2：业务 Agent + 自定义 Tool

```text
<configRoot>/agents/network-report-agent/
├── agent.yaml
└── prompts/
    └── SYSTEM_PROMPT/
        └── template.yaml

packages/<your-package>/
└── src/
    ├── tools/
    │   └── report-query-tool.ts
    └── index.ts
```

### 方案 3：业务 Agent + Hook 治理

```text
<configRoot>/agents/network-safe-agent/
├── agent.yaml
└── prompts/
    └── SYSTEM_PROMPT/
        └── template.yaml

packages/<your-package>/
└── src/
    └── hooks/
        └── output-audit-hook.ts
```

## 最小交付 checklist

### 设计

- [ ] 已明确用户、输入、输出、禁止项
- [ ] 已判断这是 Prompt、Tool、Skill、Hook 中的哪一种
- [ ] 若涉及新公共契约、持久化、stream、gateway、scope，已先补 OpenSpec change

### 实现

- [ ] `agent.yaml` 为 JSON 形态
- [ ] `activeAgentId` 已切到目标 Agent
- [ ] 只绑定业务需要的 capability
- [ ] 高风险能力未默认开放
- [ ] 新 Tool 有 input/output schema
- [ ] 新 Skill 只复用被允许的 Tool

### 验证

- [ ] 能创建 session
- [ ] 能提交 request，且带 `idempotencyKey`
- [ ] SSE / WS 至少能看到 acceptance 和 terminal 事件
- [ ] 输出符合业务目标，而不是只有原始工具结果
- [ ] 错误路径不会泄漏 raw prompt、credential、路径、原始 provider error

### 门禁

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run test:contract`
- [ ] `npm run lint:architecture`
- [ ] `openspec validate --all --strict`

## 常见误区

- 把 `agent.yaml` 当 YAML 写。当前仓库约定是扩展名 `.yaml`，内容按 JSON 写。
- 直接在请求里发 `content`。当前提交接口主字段是 `inputText`，且必须带 `idempotencyKey`。
- catalog 发现了能力，就以为 Agent 能调用。实际上还要显式做 `capabilityBindings`。
- 用 Hook 做业务主流程。Hook 是治理扩展点，不是业务流程编排引擎。
- 一开始就改 runtime / core。大多数业务二开不需要动 Kernel。

## 建议的第一版策略

如果你要尽快交付一个业务 Agent，推荐按下面顺序推进：

1. 新建 Agent
2. 补 SYSTEM_PROMPT
3. 先只绑定已有 Tool
4. 如果输出仍不稳，再加 Skill
5. 如果还缺事实来源，再补 Tool
6. 如果有审计/脱敏/阻断需求，再加 Hook

这样最容易保持 KISS，也最容易验证问题到底出在业务定义、能力绑定，还是底层实现。

## 相关文档

- [快速上手](./01-quickstart.md)
- [Agent 配置参考](./03-agent-configuration.md)
- [Skill 与 Tool 开发](./04-skill-tool-development.md)
- [能力扩展](./05-capability-extension.md)
- [API 参考](./10-api-reference.md)
- [教程与示例](./13-tutorials-examples.md)
- [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)
