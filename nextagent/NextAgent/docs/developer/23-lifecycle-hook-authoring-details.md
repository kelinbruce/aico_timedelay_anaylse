# Lifecycle Hook 细化开发指南

本文面向需要编写自定义 Lifecycle Hook 的开发者，补充一条从需求判断、代码定义、插件装配、Agent 启用到测试验证的实操路径。完整运行时语义、stage 白名单和异常规则以 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) 为准；本文只讲怎么写得清楚、可测、可维护。

## 适用场景

Lifecycle Hook 适合做请求生命周期上的受控治理，不适合绕过 runtime、gateway、sandbox 或 capability owner。

优先使用 Hook 的场景：

- 在请求执行过程中记录安全审计、诊断采样、指标或外部通知。
- 在模型调用前调整当前轮 `messages`、`tools` 或 provider options。
- 在工具调用前治理工具参数，例如限制某类路径、补齐安全默认值、降低 timeout。
- 在工具返回后改写模型可见的 `structuredPayload`、`generatedMessages` 或 `contextPatch`。
- 在最终 answer 发给用户前做格式化、脱敏、阻断或触发补充工具调用。

不应使用 Hook 的场景：

- 新增 Web API、stream event、runtime command、gateway table 或 persistence owner。
- 替代 capability input/output schema validation、sandbox policy、risk policy 或 gateway owner scope 校验。
- 从请求体、模型输出、Capability 参数或 hook config 覆盖 `agentId`、`tenantId`、`subjectId` 等可信 scope。
- 动态加载远端脚本、执行 shell hook、热插拔 hook 或按请求扫描 hook 目录。

## 开发流程

1. 明确要影响的黑盒结果：观察、改写、拒绝、阻断或挂起。
2. 选择唯一 stage：把逻辑放到拥有该 protected operation 的 stage，不跨 stage 搬运状态。
3. 选择最小 `effects`：只观察用 `OBSERVE`；要改字段才加 `TRANSFORM`；要 `DENY` / `BLOCK` / `PEND` 才加 `CONTROL`。
4. 定义 hook object：用 `defineLifecycleHook(...)`，声明 `hookId`、`kind`、`supportedStages`、`effects`、`failureMode`、`configSchema` 和 `execute`。
5. 通过 app/plugin composition 启动期注册 hook：hook 实现必须成为 trusted TypeScript `LifecycleHook` object。**外部（仓库外）开发者只能走插件路径**（步骤见下文"插件方式交付"）；直接修改 app composition 需要源码仓库权限。
6. 在目标 Agent 的 `agent.yaml.hooks` 显式启用：加载插件不等于启用 hook。
7. 写测试：覆盖 stage 触发、mutation 生效、非法结果 fail closed、日志不泄漏敏感内容。

## 如何定义 Hook

最小定义结构如下：

```ts
import { defineLifecycleHook } from "@nextagent/agent-runtime";
import type { HookInput, HookResult } from "@nextagent/agent-contracts/runtime";

export const terminalPrefixHook = defineLifecycleHook({
  hookId: "telecom.terminal-prefix",
  kind: "CUSTOM",
  supportedStages: ["BEFORE_AGENT_TERMINAL"] as const,
  effects: ["TRANSFORM"] as const,
  failureMode: "FAIL",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prefix: { type: "string" }
    }
  },
  configure(config) {
    const prefix = typeof config["prefix"] === "string" ? config["prefix"] : "";
    return {
      execute(input: HookInput<"BEFORE_AGENT_TERMINAL">): HookResult<"BEFORE_AGENT_TERMINAL"> {
        return {
          outcome: "PASS",
          mutation: {
            finalContent: `${prefix}${input.boundary.finalContent}`
          }
        };
      }
    };
  },
  execute(input) {
    return {
      outcome: "PASS",
      mutation: {
        finalContent: input.boundary.finalContent
      }
    };
  }
});
```

定义规则：

- app-local / repo 内直接装配 hook 时，`defineLifecycleHook` 从 `@nextagent/agent-runtime` 导入；插件包内编写 hook 时，从 `@nextagent/agent-plugin-sdk` 导入 SDK authoring helper。
- `hookId` 必须稳定、唯一、可读，建议使用业务域前缀，例如 `telecom.ops.terminal-safety`。
- `kind` 业务扩展使用 `CUSTOM`；`SYSTEM` 只用于框架内置治理。
- `supportedStages` 只列真正需要的 stage，避免 hook 拿到不必要的 boundary。
- `effects` 是权限声明，不是标签。多声明一个 effect 就扩大一类影响面。
- `failureMode` 对 impact hook 要慎重。必须保护主流程时用 `FAIL`；外部通知或非关键改写可考虑 `CONTINUE`。
- `configSchema` 必须拒绝未知字段，推荐 `additionalProperties: false`。
- `configure(config)` 只在启动期执行，把配置转成闭包内只读策略；运行期不要再读取动态配置文件。

## 支持哪些能力

### OBSERVE

`OBSERVE` hook 并行执行，不改变请求真相。适合审计、trace、诊断采样和幂等外部通知。

```ts
export const auditHook = defineLifecycleHook({
  hookId: "telecom.audit.model-call",
  kind: "CUSTOM",
  supportedStages: ["BEFORE_MODEL_INVOKE"] as const,
  effects: ["OBSERVE"] as const,
  failureMode: "CONTINUE",
  async execute(input) {
    await auditSink.write({
      idempotencyKey: input.idempotencyKey,
      hookId: input.hookId,
      stage: input.stage,
      agentId: input.agentId,
      requestRunId: input.requestRunId,
      messageCount: input.boundary.messages?.length ?? 0,
      toolCount: input.boundary.tools?.length ?? 0
    });
    return { outcome: "PASS" };
  }
});
```

编写要求：

- 不返回 mutation、`DENY`、`BLOCK` 或 `PEND`。
- 外部副作用使用 `input.idempotencyKey` 做幂等。
- 不把 raw prompt、raw model output、tool args/result、附件正文、路径或 credential 写入日志、metric、audit、trace 或 safe error。

### TRANSFORM

`TRANSFORM` hook 串行执行，可以替换当前 stage 白名单字段。mutation 是同名字段完整替换，不支持 JSON Patch。

常用 stage：

| 目的 | stage | mutation 字段 |
|---|---|---|
| 改模型输入 | `BEFORE_MODEL_INVOKE` | `messages`、`tools`、`commonOptions`、`providerOptions`、`timeoutMs` |
| 改模型输出 | `AFTER_MODEL_RESULT` | `content`、`reasoning`、`toolCalls` |
| 改工具参数 | `BEFORE_CAPABILITY_INVOKE` | `arguments`、`timeoutMs` |
| 改工具结果 | `AFTER_CAPABILITY_RESULT` | `structuredPayload`、`generatedMessages`、`contextPatch` |
| 改压缩摘要 | `AFTER_CONTEXT_COMPACT` | `content` |
| 改最终 answer | `BEFORE_AGENT_TERMINAL` | `finalContent`、`toolCalls` |

工具结果改写示例：

```ts
export const normalizeToolResultHook = defineLifecycleHook({
  hookId: "telecom.tool-result-normalizer",
  kind: "CUSTOM",
  supportedStages: ["AFTER_CAPABILITY_RESULT"] as const,
  effects: ["TRANSFORM"] as const,
  failureMode: "FAIL",
  execute(input) {
    if (input.boundary.capabilityId !== "Read" || input.boundary.structuredPayload === undefined) {
      return { outcome: "SKIP" };
    }

    return {
      outcome: "PASS",
      mutation: {
        structuredPayload: {
          ...input.boundary.structuredPayload,
          normalizedBy: "telecom.tool-result-normalizer"
        }
      }
    };
  }
});
```

注意：

- `AFTER_CAPABILITY_RESULT` 的 mutation 会在 runtime 构造并 append `CAPABILITY_RESULT` message 前应用，因此会影响后续模型可见工具结果。
- `BEFORE_AGENT_TERMINAL.finalContent` 会在 terminal commit 前应用，因此会影响用户可见 answer。
- 如果在 `BEFORE_AGENT_TERMINAL` 返回非空 `toolCalls`，不要同时替换 `finalContent`；runtime 会继续执行这些 tool calls，而不是提交当前 answer。

### CONTROL

`CONTROL` hook 可以返回 `DENY`、`BLOCK` 或 `PEND`。

```ts
export const terminalBlockHook = defineLifecycleHook({
  hookId: "telecom.terminal-block-secret",
  kind: "CUSTOM",
  supportedStages: ["BEFORE_AGENT_TERMINAL"] as const,
  effects: ["CONTROL"] as const,
  failureMode: "FAIL",
  execute(input) {
    if (input.boundary.finalContent.includes("-----BEGIN PRIVATE KEY-----")) {
      return {
        outcome: "BLOCK",
        safeReason: "TERMINAL_OUTPUT_CONTAINS_HIGH_RISK_SECRET"
      };
    }
    return { outcome: "PASS" };
  }
});
```

约束：

- `DENY` / `BLOCK` / `PEND` 只在声明 `CONTROL` 时合法。
- `PEND` 只允许在 `BEFORE_MODEL_INVOKE`、`BEFORE_CAPABILITY_INVOKE`、`BEFORE_AGENT_TERMINAL`。
- control outcome 和 mutation 同时出现时，runtime 以 control 为准，不应用 mutation。
- `safeReason` 必须是安全摘要，不能包含原始用户输入、模型输出、工具参数或工具结果。

## 在 Agent 中启用

Hook 实现被注册后，还必须在目标 Agent 的 `agent.yaml` 中启用：

```yaml
hooks:
  - hookId: telecom.tool-result-normalizer
    enabled: true
    stages: [AFTER_CAPABILITY_RESULT]
    timeoutMs: 1000
    order:
      priority: 20
    config:
      mode: strict
```

启用规则：

- `CUSTOM` hook 默认不生效，必须在当前 Agent 显式启用。
- `stages` 只能收窄，不能扩大 hook 的 `supportedStages`。
- `config` 会在启动期按 `configSchema` 校验。
- `timeoutMs` 应按影响面设置，impact hook 不应无界等待。
- `order.before` / `order.after` 只能指向同 kind、同 effect group、同 stage 有效的 hook。

## 插件方式交付

业务插件可以导出 hook：

```ts
import { defineLifecycleHook, definePlugin } from "@nextagent/agent-plugin-sdk";

const normalizeToolResultHook = defineLifecycleHook({
  hookId: "telecom.tool-result-normalizer",
  kind: "CUSTOM",
  supportedStages: ["AFTER_CAPABILITY_RESULT"] as const,
  effects: ["TRANSFORM"] as const,
  failureMode: "FAIL",
  execute(input) {
    if (input.boundary.capabilityId !== "Read" || input.boundary.structuredPayload === undefined) {
      return { outcome: "SKIP" };
    }
    return {
      outcome: "PASS",
      mutation: {
        structuredPayload: {
          ...input.boundary.structuredPayload,
          normalizedBy: "telecom.tool-result-normalizer"
        }
      }
    };
  }
});

export default definePlugin({
  pluginId: "telecom-hook-pack",
  version: "1.0.0",
  providers: [],
  policies: [],
  hooks: [normalizeToolResultHook]
});
```

部署时需要两步：

1. 在 `default-system.yaml` 的 `nextAgent.system.plugins[]` 声明插件 artifact，使 hook definition 进入 startup registry。
2. 在目标 Agent 的 `agent.yaml.hooks[]` 激活具体 `hookId`。

只加载插件但不激活 Agent hook，主流程不会触发该 hook。

## 编写建议

- 先写一句黑盒目标：例如“把 `Read` 工具返回的 counters payload 归一化后再进入后续模型上下文”。
- 一个 hook 只做一类事。不要把审计、参数改写、最终 answer 脱敏塞进同一个 hook。
- 优先选靠近目标的 stage。最终用户可见 answer 用 `BEFORE_AGENT_TERMINAL`，不要用 `AFTER_MODEL_RESULT` 代替。
- mutation 返回完整字段值。不要假设 runtime 会做局部 merge 或 patch。
- 不要原地修改 `input.boundary`；构造新的 mutation object。
- OBSERVE 副作用失败不应影响主流程；impact hook 失败是否中断必须显式用 `failureMode` 表达。
- 不要在 hook 中访问私有 package path。跨 package 只用 public exports 和 `agent-contracts` / `agent-common`。
- 不要把 hook 当成安全边界的唯一实现。不可绕过的安全要求应落在 runtime guard、gateway、sandbox、risk policy 或 app composition。
- 不要在 hook 中做长耗时网络调用。确实需要外部策略时，使用短 timeout、版本化策略引用和确定性 fallback。
- 所有观测输出都只写安全字段：id、stage、count、duration、safe reason code、bounded summary。

## 测试建议

最小测试覆盖：

- `defineLifecycleHook(...)` 能校验 hook object，非法 effects / stage / config schema 失败。
- Agent 启用后，目标 stage 确实触发 hook；未启用时不触发。
- mutation 进入后续黑盒结果：例如工具结果改写后，后续 `CAPABILITY_RESULT` message 或模型输入中可见的是改写后的 payload。
- `OBSERVE` hook 返回 mutation/control 时被忽略，并产生诊断但不改变主流程。
- `TRANSFORM` hook 返回未知 mutation 字段时 fail closed。
- `CONTROL` hook 的 `DENY` / `BLOCK` 能阻断 protected operation。
- `PEND` 只在允许 stage 创建 pending input，其它 stage 返回 `PEND` 走非法结果路径。
- `HOOK_INVOKED`、日志、metric、audit、trace 不泄漏 raw prompt、模型输出、工具参数、工具结果、附件正文或 credential。
- 恢复重执行场景下，impact hook 行为确定；外部副作用自行幂等。

建议测试位置：

- hook 纯逻辑单测放在实现 package 的 `tests/`。
- lifecycle 主路径行为放 `tests/agent-kernel/lifecycle-hook-*.test.ts`。
- contract 或架构边界放 `tests/contract/`、`tests/architecture/`。
- 插件 artifact 加载和 Agent 激活放插件 product-path 测试。

## 常见落点

| 需求 | 推荐实现 |
|---|---|
| 记录每次模型调用 messages 数量 | `OBSERVE` + `BEFORE_MODEL_INVOKE` |
| 按客户策略隐藏某类工具 | `TRANSFORM` + `BEFORE_MODEL_INVOKE.tools` |
| 工具调用前补齐只读参数 | `TRANSFORM` + `BEFORE_CAPABILITY_INVOKE.arguments` |
| 工具结果进入上下文前归一化 | `TRANSFORM` + `AFTER_CAPABILITY_RESULT.structuredPayload` |
| 工具结果追加 request-local context patch | `TRANSFORM` + `AFTER_CAPABILITY_RESULT.contextPatch` |
| 最终 answer 加水印或格式头 | `TRANSFORM` + `BEFORE_AGENT_TERMINAL.finalContent` |
| 最终 answer 命中高危泄漏时阻断 | `CONTROL` + `BEFORE_AGENT_TERMINAL.BLOCK` |
| 需要用户确认后继续 | `CONTROL` + 支持 `PEND` 的 before stage |

## 相关文档

- [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md)
- [Agent Plugin 开发指南](./19-agent-plugins.md)
- [测试与调试](./11-testing-debugging.md)
- [最佳实践](./15-best-practices.md)
- `packages/agent-contracts/src/runtime/index.ts`
- `packages/agent-runtime/src/lifecycle/`
- `packages/agent-core/src/tools/tool-loop.ts`
