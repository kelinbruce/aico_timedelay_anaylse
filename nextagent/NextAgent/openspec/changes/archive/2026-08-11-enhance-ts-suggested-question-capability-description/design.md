## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.20 查看推荐问题` | 推荐 prompt 增加产品能力范围上下文 | `question-recommendation` | `FN-1.20 查看推荐问题` |

## `FN-1.20 查看推荐问题`

### 目标与规范依据

推荐生成的 prompt 填槽在现有 `query`、`final_answer`、`skill` 三个变量基础上，新增 `capability_description` 变量。该变量来自 agent-owned resource 文件 `agents/{agentId}/resource/capabilityDescription.md`，通过具备 LOCAL/REMOTE 双模式的热加载 Provider 解析。

#### 本 Function 的目标 Requirements

canonical spec：`question-recommendation`

- `MODIFIED`：`Prompt Variable Resolution`
- `ADDED`：`Capability Description Provider`
- `ADDED`：`Capability Description Resolution`

### 当前实现

`agent-session/src/services/suggested-question-service.ts` 的 `renderRecommendationContext()` 构建 user message，包含 `query`、`final_answer` 和可选 `skill` 段。`SuggestedQuestionServiceDependencies` 不包含产品能力范围相关依赖。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| prompt 可包含产品能力范围 | 无此变量和 Provider | 需新增 Provider 和填槽逻辑 |
| 文件热替换后新 run 立即生效 | 无 Provider，不适用 | 需 REMOTE 模式 fingerprint 检测 |
| 文件不存在时行为不变 | 当前无此文件 | Provider 返回 undefined 时省略段 |

### 修改方案

#### Provider 设计

对照 `ChatUploadConfigProvider`（`agent-attachment-runtime/src/chat-upload-config.ts`）的模式，在 `agent-session` 中实现同构 Provider。

| 维度 | ChatUploadConfigProvider | CapabilityDescriptionProvider |
|---|---|---|
| 所在 package | agent-attachment-runtime | agent-session |
| 文件路径 | `config/config.json` | `resource/capabilityDescription.md` |
| 返回类型 | `ChatUploadFileConfig`（结构化对象） | `string`（markdown 原文） |
| LOCAL 模式 | load-once 缓存 | load-once 缓存 |
| REMOTE 模式 | `statSync` fingerprint | `statSync` fingerprint |
| 缺失返回 | local: 默认值; remote: `undefined` | `undefined` |
| AbortSignal | 不接收 | 接收（对齐 SuggestedQuestion async contract） |

Provider 接口：

```typescript
export interface CapabilityDescriptionProvider {
  get(signal?: AbortSignal): Promise<string | undefined>;
}
```

`CapabilityDescriptionSourceLocator` 接口与 `ChatUploadConfigSourceLocator` 同构，由 composition 层适配 `AgentPackageRootLocator`。

LOCAL mode：首次 `get()` 调用 `readFile` 加载文件，之后永久返回缓存值；不检测文件变化。

REMOTE mode：每次 `get()` 调用 `statSync(path)` 计算指纹 `path:size:mtimeMs`；指纹不变返回缓存值，指纹变化时重新 `readFile` 加载。

#### Prompt 变更

system prompt 增加选择规则：

```text
6. 当提供了产品能力范围时，推荐问题应与之相关，避免推荐产品不支持的问题。
```

user message 增加产品能力范围段（仅非空时包含），段顺序为用户问题 → 最终回答 → 产品能力范围 → 相关 Skill。

```text
产品能力范围：
{capability_description}
```

`{capability_description}` 经过 `escapeTemplateVariable` 转义 `{` 和 `}`，防止模板注入，与 `query`、`final_answer`、`skill` 的转义策略一致。

#### 注入链路

```text
session-services-composition.ts
  ├─ createAgentPackageRootLocator(systemConfig) → sourceLocator
  ├─ deployment mode 判断
  │   ├─ LOCAL → createLocalCapabilityDescriptionProvider({ sourceLocator, activeAgentId })
  │   └─ REMOTE → createRemoteCapabilityDescriptionProvider({ sourceLocator, activeAgentId })
  └─ createSuggestedQuestionService({ ..., capabilityDescriptionProvider })
```

`CapabilityDescriptionProvider` 是可选依赖。未注入时 `{capability_description}` 视为空字符串，行为与文件不存在时一致。

#### 安全约束

- `capabilityDescription.md` 内容来自 agent package 文件系统，属于可信 app composition 范畴。
- Provider 只返回文件原文，不做解析或转换。
- 文件内容不暴露给 Web API、SSE、WebSocket 或其他不可信边界。
- `escapeTemplateVariable` 转义 `{` 和 `}`，防止模板注入。

### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | `Capability Description Provider` | REMOTE 模式 fingerprint 热重载 | 替换文件后新 run 读取新内容 |
| 安全 | `Prompt Variable Resolution` | 文件来自可信 agent-owned resource | 内容不进入不可信边界 |
| 可测试性 | `Capability Description Resolution` | Provider 返回 undefined 时省略段 | 文件存在/不存在/热替换行为 |

## 验证策略（Verification Strategy）

- unit 层验证 Provider 的 LOCAL/REMOTE 双模式：文件存在返回原文、不存在返回 `undefined`、REMOTE 模式热替换后重新加载。
- unit 层验证 `renderRecommendationContext`：`capability_description` 非空时包含产品能力范围段、为空时省略、`{` `}` 转义。
- integration 层验证 `createSuggestedQuestionService` 注入 Provider 后，`generate()` 调用 `provider.get()` 并将结果填入 prompt。
- TypeScript build 验证源码类型安全。
- OpenSpec strict validation 验证 delta 与 canonical Requirement 一致。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/question-recommendation/spec.md`：归档时更新 `Prompt Variable Resolution`，新增 `Capability Description Provider` 和 `Capability Description Resolution`。
- `openspec/designs/functions/D1-会话与流式交互/D1.4-智能输入辅助/FN-1.20-查看推荐问题.md`：归档时更新处理过程，增加产品能力范围填槽步骤。
- Feature：无。
- `openspec/overview.md`：无。
- architecture：无。
- `openspec/designs/modules/agent-session.md`：归档时补充 `CapabilityDescriptionProvider`。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- `capabilityDescription.md` 文件过大可能超出模型 context window。当前不设文件大小限制；如果模型调用因 context 超限失败，service 沿用既有失败/空结果语义。如果后续证明需要限制，可通过独立 change 增加最大文件大小约束。
- `PrecomputedSuggestedQuestionPort` 的 5 分钟 TTL 缓存意味着热替换文件后，已完成 run 的缓存结果在 5 分钟内不会刷新。新 run 立即生效，影响低。`No Caching` spec 债务不在本次 change 范围内。
- LOCAL 模式不检测文件变化，与 `ChatUploadConfigProvider` 的 LOCAL 模式行为一致。本地开发时如需热替换，使用 REMOTE 模式。

## 待确认问题（Open Questions）

无。
