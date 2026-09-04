---
sources:
  - AGENTS.md
  - openspec/config.yaml
last-verified: 2026-09-01
---

# OpenSpec 变更工作流

NextAgent 采用契约先行开发。修改代码前必须有 OpenSpec change。本页描述完整工作流。

→ 详见 [contract-navigation.md](contract-navigation.md) 了解 OpenSpec 目录结构

## 核心原则

**新增或修改以下内容前，必须先有 OpenSpec change：**
- Web API
- Stream event
- Runtime command
- Context contract
- Capability contract
- Gateway contract
- Persistence owner
- 安全边界
- 可观测信号

**不得把未被 OpenSpec 定义的行为直接写进实现。**

## 变更工作流

### Step 1：创建 Change 目录

```
openspec/changes/add-{简短描述}/
```

命名使用 `add-`、`fix-`、`refine-`、`restore-` 等前缀 + kebab-case 描述。

### Step 2：编写 Proposal

`openspec/changes/add-{desc}/proposal.md`

必须包含：
- 变更动机和背景
- 影响范围（涉及哪些包、contract、spec）
- 与已有基线的关系
- 是否需要新增架构设计

### Step 3：编写 Design（如涉及架构变更）

`openspec/changes/add-{desc}/design.md`

必须包含：
- 设计方案和备选方案
- 对现有 contract 的影响
- DO/DTO/PO/Record 变更
- Gateway 持久化变更（如有）
- 安全和 scope 影响
- 向后兼容策略

### Step 4：编写 Tasks

`openspec/changes/add-{desc}/tasks.md`

- 每个 task 必须可独立验证
- 包含验证命令或测试期望
- 多个独立约束的 task 应拆分为可分别验收的子目标
- task 不得部分完成

### Step 5：实施

- **只改 active change 文档和代码**
- 长期基线文档在归档前更新
- 对照 proposal、design、spec、tasks，确认关键约束都有对应实现或明确延期说明

### Step 6：验证

- 运行 `openspec validate --all --strict`
- 运行对应包的测试
- 涉及 runtime lifecycle/concurrency/cancellation/retry/terminal commit/streaming/gateway persistence/sandbox/security/agent scope/owner scope 时，补 characterization/contract/architecture 测试

### Step 7：归档

归档时更新长期基线文档，将 change 目录移入归档。

## 变更类型速查

| 变更类型 | 典型前缀 | 涉及文件 |
|---|---|---|
| 新增 API 端点 | `add-` | agent-contracts (DTO) + agent-channel-web (route) + gateway (Record, 如需) |
| 新增 Timeline Event | `add-` | agent-common (enum) + agent-runtime (发布) + agent-channel-web (投影) |
| 新增 Gateway Record | `add-` | agent-contracts/gateway (Record) + agent-platform-gateway-local (Row + mapping) |
| 新增 Capability Kind | `add-` | agent-contracts/capability + agent-capability |
| 修复流式行为 | `fix-` | agent-model / agent-core / agent-channel-web |
| 精化已有行为 | `refine-` | 对应包 + 对应 spec |
| 恢复已移除行为 | `restore-` | 对应包 + 对应 spec |

## 常见约束

- **同形同策**：发现一个 case 需要调整原则时，先更新 OpenSpec，把新原则应用到所有同类 case；不得只修当前点
- **例外必须文档化**：真正不能套用统一原则的例外必须在 OpenSpec design 中写明原因、适用范围、owner 和验证方式
- **禁止 speculative work**：不实现请求之外的功能，不为未来能力添加未被 OpenSpec 定义的半实现

## OpenSpec 设计领域映射

不确定设计文档应放在哪个领域？参考：

| 领域 | 典型变更 |
|---|---|
| D1 Session and Streaming | 会话 CRUD、消息格式、SSE/WS 事件 |
| D2 Request Runtime | 生命周期状态、lane、terminal commit、recovery |
| D3 Agent Assembly | Agent 配置、路由策略、model/tool loop |
| D4 Model and Context | 模型调用、context budget、compaction |
| D5 Capability System | Tool/Skill/Agent/Workflow 治理、sandbox |
| D6 Security and Governance | Risk policy、scope isolation、guardrail |
| D7 Observability and Audit | 日志、trace、metric、audit |
| D8 Data and Memory | 持久化、长期记忆、trajectory |
| D9 Workflow Orchestration | Recipe、节点、parallel gateway |
| D10 Secondary Development | 插件、Hook、Skill 开发、平台适配 |
| D11 Reliability and Resilience | Recovery、checkpoint、retry、resilience |

→ 详见 [contract-navigation.md](contract-navigation.md)、[verification-gates.md](verification-gates.md)
