## 背景与问题（Why）

`enhance-ts-workflow-api-choice-node` change（PR !838）在实现 api-choice 节点 D1-D9 设计决策时，将 restful 节点的参数提取（fm_extract_parameter）、时间参数转换、API 级重试和追问反思能力打包在同一 commit 中，但存在以下问题：

1. **P0 — Scope 越界，restful 增强缺少 OpenSpec change**：commit `42e743a3e` 新增了 `restful-param-extract.ts`（336 行）和 `restful-time-param.ts`（230 行）两个完整文件，并直接修改了 stable spec `workflow-capability-nodes/spec.md`（+59 -4 行），但 `enhance-ts-workflow-api-choice-node` 的 proposal 明确说"本 change 仅增强 api-choice 节点"。restful 节点增强没有对应的 OpenSpec change proposal 支撑，违反 AGENTS.md "规格优先"原则。

2. **P1 — 模型配置解析逻辑重复**：`resolveApiChoiceModelConfig`（knowledge-nodes.ts:696）和 `resolveParamExtractModelConfig`（restful-param-extract.ts:177）是近乎完全相同的代码，都做"读 model/modelGroup → 尝试 resolveModelForParamExtract override → fallback 到 resolveModelInvocationConfig"，唯一差异是 api-choice 版额外合并 model_params。违反"同形同策"原则。

3. **P1 — modelGroup 被静默丢弃**：`resolveModelForParamExtract` adapter（runtime-adapters.ts:54）参数签名接收 `modelGroup`，但实现中 `_modelGroup` 被完全忽略。spec D6 说"model / modelGroup 通过 resolveModelForParamExtract 覆盖全局配置"，但实现只用 model。用户配置了 modelGroup 但没有 model 时，override 不生效。

4. **P2 — capability-nodes.ts 空白字符损坏**：`executePythonNode` 和 `executeAgentNode` 有不相关的缩进变更（2-space 被改为 1-space），属于意外 whitespace damage。

5. **P2 — asNonNegativeInteger 重复定义**：capability-nodes.ts:277 和 engine/index.ts:1307 各有一份，实现略有不同。

## 变更范围（What Changes）

- **新增** OpenSpec change 覆盖 restful 节点增强能力（参数提取、时间转换、重试、追问反思），补齐 P0 缺失的规格
- **提取** 统一的 `resolveNodeModelConfig` 到 `shared.ts`，消除 `resolveApiChoiceModelConfig` 和 `resolveParamExtractModelConfig` 的重复
- **修复** `resolveModelForParamExtract` adapter 对 modelGroup 的处理：要么在 adapter 中处理 modelGroup（通过扩展 selectModelProfile 或增加路由组参数），要么在 proposal/design 中明确 modelGroup 为 deferred 并记录原因
- **修复** capability-nodes.ts 中 executePythonNode / executeAgentNode 的缩进 whitespace damage
- **去重** asNonNegativeInteger：提取到 shared.ts 或 agent-common，两处共用

## Capability 影响

### 修改的 Capability

- `workflow-capability-node-handlers`：restful 节点增强规格补齐（参数提取、时间转换、重试、追问反思）
- `workflow-knowledge-node-handlers`：api-choice 模型配置解析去重

### 复用的外部依赖

- 模型路由：复用已有的 `resolveModelForParamExtract` 机制（本 change 修复其 modelGroup 处理）
- 模板引擎：复用 `prepareLlmPrompt` + `renderTemplate`

## 影响范围

- `agent-workflow`：修复 knowledge-nodes.ts、restful-param-extract.ts、capability-nodes.ts、shared.ts、runtime-adapters.ts
- `agent-contracts`：无 contract 变更（`resolveModelForParamExtract` 已在 types.ts 中定义，本 change 只修复 adapter 实现）
- `agent-app`：无变更（DI wiring 已在 workflow-composition.ts 中完成）

## 职责边界对齐

- 本 change 仅修复 `enhance-ts-workflow-api-choice-node` 的代码审查发现，不新增功能能力
- restful 节点增强的规格补齐是对已实现代码的 retroactive OpenSpec 覆盖，不改变已实现行为
- 模型配置去重遵循"同形同策"原则，不引入新的抽象层

## 归档前基线更新

- `openspec/specs/workflow-capability-nodes/spec.md`：已在 `enhance-ts-workflow-api-choice-node` 中被修改，本 change 确认其内容与实现一致
- `openspec/specs/workflow-knowledge-nodes/spec.md`：如需要，补充 api-choice 模型路由去重的 spec 条目

## 验证入口

- Unit test：`resolveNodeModelConfig` 统一函数在 api-choice 和 restful-param-extract 两处行为一致
- Unit test：modelGroup 有值但 model 为空时，override 生效（或明确 deferred 并有测试断言不生效）
- Unit test：capability-nodes.ts 中 executePythonNode / executeAgentNode 缩进恢复正常
- Architecture test：asNonNegativeInteger 无重复定义
- Regression test：已有 api-choice 和 restful 测试全部通过