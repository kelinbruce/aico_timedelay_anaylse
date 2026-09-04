# Skill 与 Tool 开发

这一篇讲怎么在 NextAgent 里写自定义 Skill 和 Tool。Tool、Skill、Agent 三类能力都走 `agent-capability` 的统一 catalog 和生命周期；这里聚焦 Tool 和 Skill，Agent（subagent）能力见 [能力扩展](./05-capability-extension.md)。

## 能力类型对比

三类能力都以 governed `CapabilityDescriptor` 表达，差异在于语义、执行入口与上下文模型：

| 类型 | `capabilityType` | 执行入口 | 上下文模型 | 适用场景 |
|------|------------------|----------|------------|----------|
| **Tool** | `TOOL` | `BuiltinToolExecutor` 在主对话上下文中同步执行 | 主对话上下文 | 单一可执行动作：文件读写、命令执行、检索、提问 |
| **Skill** | `SKILL` | `Skill` tool 解析 governed SKILL descriptor 后注入 Skill body | `inline` 在主对话注入；`fork` 暂未在本版本执行 | 复合领域能力：诊断流程、领域知识、操作手册 |
| **Agent** | `AGENT` | `Agent` tool 通过 runtime-owned subagent execution 创建 fresh-context child run | 独立 fresh-context child session/run | 委托给专家 Agent 做隔离分析 |

所有能力共用 `CapabilityProvider`、`CapabilityDescriptor`、`CapabilityInvocationRequest`、`CapabilityInvocationResult`、`CapabilityInvocationPort` 契约，不存在 Tool/Skill/Agent 各自的平行公共调用协议。

## Tool 开发

### Tool 接口

Tool 框架的契约由 `packages/agent-capability/src/tools/tool-spi.ts` 定义。核心是 `Tool` 接口与 `defineTool` 辅助函数：

```ts
// packages/agent-capability/src/tools/tool-spi.ts
export interface Tool<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonObject = JsonObject,
  TConfig extends JsonObject = JsonObject
> {
  configure?(config: TConfig, deps?: ToolDependencies): Tool<TInput, TOutput, TConfig>;
  execute(input: TInput, options?: ToolExecuteOptions): Promise<TOutput | CapabilityInvocationResult>;
}

export interface ToolMetadata<TConfig extends JsonObject = JsonObject> {
  readonly name: CapabilityId;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly configSchema?: JsonObject;
  readonly requiredDependencies?: readonly ToolDependencyName[];
  readonly replayPolicy?: CapabilityReplayPolicy;
  readonly disclosurePolicy?: CapabilityDisclosurePolicy;
  readonly returnsCapabilityResult?: boolean;
  readonly observability?: ToolObservabilityDefinition;
}

export type ToolDependencyName =
  | "approval" | "sandbox" | "workspaceFiles"
  | "skillSources" | "ragRetrieval" | "subagentExecution"
  | "todoState" | "workflowExecution" | "cronTasks"
  | "apiCallPort" | "parameterExtraction";
```

关键约束（来自 `builtin-tool-framework` spec）：

- Tool 实现只接收**已校验的业务输入**和可选 `ToolExecuteOptions`（含 `context` / `deps` / `signal`），返回业务输出对象，**不接收 `CapabilityInvocationRequest`，也不返回 `CapabilityInvocationResult`**。结果包装由 `BuiltinToolExecutor` 负责。
- `metadata` 是 provider-neutral 的，**不含 provider 身份**。provider 身份由 `CapabilityProvider` 提供（builtin 工具固定为 `providerId="builtin-tools"`、`providerKind="BUNDLED"`）。
- Tool 实现不接收 workspace root、host 绝对路径、sandbox 内部对象或 host 进程 API；需要文件访问走 `workspaceFiles` 依赖，需要动态执行走 `sandbox` 依赖。
- `requiredDependencies` 声明的依赖在 catalog 阶段就会被校验，缺失依赖的 Tool 会被标记为 `UNAVAILABLE`，不会进入可执行路径。

### 实现示例

以内置 `Glob` tool 为例（最小形态：无 config、依赖 `workspaceFiles`）：

```ts
// packages/agent-capability/src/builtins/glob/glob-tool.ts
import { AgentError, brand, type JsonObject } from "@nextagent/agent-common";
import { defineTool } from "../../tools/tool-spi.js";
import { globInputSchema, globOutputSchema } from "./glob-schemas.js";

export const globCapabilityId = brand<string, "CapabilityId">("Glob");

export const globToolDefinition = defineTool({
  name: globCapabilityId,
  description:
    "Find authorized workspace files by a bounded glob pattern.\n\n" +
    "When to use:\n- Find files by name pattern (e.g., `**/*.ts`, `src/**/*.json`).\n" +
    "- Call Glob in parallel with multiple patterns to locate several file kinds at once.\n" +
    "When NOT to use:\n- To search file contents, use Grep.\n- To read a known path, use Read.\n" +
    "Key behaviors:\n- Returns up to 500 workspace-relative filenames; `truncated=true` indicates more matches exist.",
  inputSchema: globInputSchema,
  outputSchema: globOutputSchema,
  requiredDependencies: ["workspaceFiles"],
  replayPolicy: "IDEMPOTENT",
  disclosurePolicy: { mode: "EAGER" },
  async execute(input: JsonObject, options) {
    if (options?.deps?.workspaceFiles === undefined || options.context === undefined) {
      throw new AgentError({
        code: options?.deps?.workspaceFiles === undefined ? "TOOL_DEPENDENCY_MISSING" : "TOOL_CONTEXT_MISSING",
        message: "Required Tool dependency or context is unavailable.",
        category: options?.deps?.workspaceFiles === undefined ? "UNAVAILABLE" : "INTERNAL",
        retryable: false
      });
    }
    return options.deps.workspaceFiles.globFiles(input, options.context, options.signal);
  }
});
```

需要 sandbox 动态执行的 Tool（如 `Bash`、`Python`）声明 `requiredDependencies: ["sandbox"]`，并通过 `options.deps.sandbox.runShell(...)` / `runPython(...)` 提交到 sandbox gateway 边界：

```ts
// packages/agent-capability/src/builtins/bash/bash-tool.ts （节选）
export const bashToolDefinition: ToolDefinition = defineTool({
  name: bashCapabilityId,
  description: bashToolDescription,
  inputSchema: bashInputSchema,
  outputSchema: bashOutputSchema,
  configSchema: bashConfigSchema,
  requiredDependencies: ["sandbox"],
  replayPolicy: "NON_IDEMPOTENT",
  disclosurePolicy: { mode: "EAGER" },
  async execute(input, options): Promise<JsonObject> {
    // 校验 sandbox 边界存在，缺失即拒绝（SANDBOX_BYPASS_DENIED）
    // 解析 command、解析 timeout、提交 sandbox gateway
    // 超时抛 ToolTimedOutResultError，非零退出抛 ToolDegradedResultError
    return executeBash(input, options);
  }
});
```

> Bash 命令权威已下沉到 sandbox gateway denylist：Bash tool 只做 tokenization + sandbox 路由，executable allow/deny 由 sandbox gateway policy 决定（deny-by-default）。

失败语义约定：

- `ToolDegradedResultError` — 安全降级结果（如非零退出码），executor 会包装为 `DEGRADED` 结果，仍暴露 `structuredPayload` 供后续模型步骤反应。
- `ToolTimedOutResultError` — 安全超时结果。
- `ToolFailedResultError` — 安全失败结果，含 `code` / `category` / `retryable`。

### Tool 注册

builtin Tool 注册是**显式**的，通过 owned builtin tool list 完成，不存在目录扫描、装饰器发现或 import 副作用自注册：

```ts
// packages/agent-capability/src/builtins/index.ts
export const builtinToolsProvider: CapabilityProvider =
  { providerId: "builtin-tools", providerKind: "BUNDLED" };

export const builtinToolDefinitions: readonly ToolDefinition[] = createBuiltinToolDefinitions({});
// createBuiltinToolDefinitions 返回 17 个内置 Tool definition：
// Read / Write / Glob / Grep / Bash / Python / Edit / Rag / Skill /
// AskUserQuestion / Agent / ToolSearch / TodoWrite / Workflow / ApiCall / Cron
```

`createCapabilitySubsystem(...)` 在内部通过 `CapabilityDiscoveryFactory.create({ provider: builtinToolsProvider, discoveryMode: "EAGER" })` 把 builtin tool list 包装成 `ToolCatalog`，再以普通 `CapabilityDiscovery` 身份接入 catalog。`defineTool` 不会隐式注册——模块导出一个 Tool definition 不会让它变得可发现，必须被加入 owned list 才会进入 catalog。

应用层若要贡献自定义 Capability，通过 `createCapabilitySubsystem` 的 `externalProviders` 选项注入 `CapabilityProvider`（每个 provider 绑定一个 `CapabilityProvider` identity + 一个 `CapabilityDiscovery`，可选 `CapabilityExecutor`），它们会以独立 provider 身份进入统一 catalog。其他 owning package（如 `agent-memory` 提供 `memory-tools`）也通过 public factory 返回 `CapabilityProviderContribution`，由 `agent-app` 经 `externalProviders` 注入。

> **外部（仓库外）开发者注意**：`externalProviders` 注入需要修改 app composition（`agent-app` 层），只有拿到源码仓库的开发者可以走这条路。外部二开者贡献自定义 Tool 的受支持路径是打包成插件（`@nextagent/agent-plugin-sdk` 的 `defineTool` / `defineToolProvider`，通过 system config `plugins[]` 加载），见 [Agent Plugin 开发指南](./19-agent-plugins.md)。

### 在 agent.yaml 启用 Tool

`agent.yaml` 使用 YAML（JSON 也是兼容子集）。在 `capabilityBindings` 中按 `{capabilityId, capabilityType, providerId, enabled}` 绑定：

```json
{
  "capabilityBindings": [
    {
      "capabilityId": "Glob",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": true
    },
    {
      "capabilityId": "Bash",
      "capabilityType": "TOOL",
      "providerId": "builtin-tools",
      "enabled": false
    }
  ]
}
```

> **注册 ≠ 绑定**：catalog 知道一个能力存在，不代表 Agent 可以调用它。必须在 `agent.yaml.capabilityBindings` 显式绑定（builtin 默认 Agent 已绑定常用工具；subagent 如 `network-explorer` 会显式 `enabled: false` 关闭 `Write`/`Bash`/`Python`/`Skill`/`AskUserQuestion`）。

## Skill 开发

### Skill 结构

一个 Skill 是磁盘上的一个目录，根目录必须有 `SKILL.md`；可选 `scripts/`、`references/`、`assets/` 子目录。只有这三个子目录会在执行期被 projection 到 execution workspace 供 Skill body 引用：

```
configRoot/skills/
└── my-skill/
    ├── SKILL.md              # 必需：frontmatter + Markdown body
    ├── scripts/              # 可选：脚本资源
    │   └── diag.py
    ├── references/           # 可选：参考文档
    │   └── alarm-codes.md
    └── assets/               # 可选：静态资源
```

> 根级文件如 `README.md`、`LICENSE`、额外说明**不会**被 projection 进运行时视图。

### Python 脚本输出路径环境变量

当 Skill 通过 Bash/Python 执行 `.nextagent/skills/<projection-key>/<skill-name>/scripts/*.py` 脚本时，sandbox 会为该 Python 子进程注入当前 request 专属的输出路径环境变量。Skill 脚本应通过这些变量决定文件写入位置，不要依赖进程 cwd，也不要把结果写回 `.nextagent/`。

| 环境变量 | 含义 | 适用写入 |
|----------|------|----------|
| `NEXTAGENT_WORKSPACE_DIR` | 当前 Agent/Owner/Session 对应的 durable workspace 目录 | 最终结果、报告、可供后续 Read 读取的用户可见文件 |
| `NEXTAGENT_TEMP_DIR` | 当前 run 的临时目录 | 中间数据、缓存、分阶段产物、可丢弃临时文件 |
| `NEXTAGENT_SKILL_ROOT` | 当前已授权 Skill projection 根目录 | 只读读取本 Skill 的 `scripts/`、`references/`、`assets/` 资源 |

隔离语义：

- 这些变量只注入到当前 sandbox 子进程，不写入服务端全局 `process.env`，并发 run 不共享环境变量对象。
- `NEXTAGENT_TEMP_DIR` 是 run-scoped，不同 run 的物理目录不同；中间文件不得依赖后续 run 仍可见。
- `NEXTAGENT_WORKSPACE_DIR` 是 durable 输出根；同一 Agent/Owner/Session 下可能被多个 run 共享，Skill 作者应使用任务名、时间戳、输入 id 或调用方提供的文件名避免覆盖。
- `NEXTAGENT_SKILL_ROOT` 来自当前 run 已授权的 Skill projection，只读；脚本不得向该目录写文件。
- cwd 保持为 execution view root，用于解析 `workspace/`、`temp/`、`.nextagent/skills/...` 等 root-qualified 路径；不要假设 cwd 等于 workspace。

Python 获取方式：

```python
import os
from pathlib import Path

workspace_dir = Path(os.environ["NEXTAGENT_WORKSPACE_DIR"])
temp_dir = Path(os.environ["NEXTAGENT_TEMP_DIR"])
skill_root = Path(os.environ["NEXTAGENT_SKILL_ROOT"])

# 中间数据：当前 run 临时产物
stage_file = temp_dir / "stage.json"
stage_file.write_text("{}", encoding="utf-8")

# 最终结果：可读回的 workspace 输出
result_file = workspace_dir / "diagnosis-result.md"
result_file.write_text("# Diagnosis Result\n", encoding="utf-8")

# 只读 Skill 资源
reference = skill_root / "references" / "alarm-codes.md"
reference_text = reference.read_text(encoding="utf-8")
```

推荐在脚本启动时显式校验变量存在，缺失时快速失败：

```python
required = ["NEXTAGENT_WORKSPACE_DIR", "NEXTAGENT_TEMP_DIR", "NEXTAGENT_SKILL_ROOT"]
missing = [name for name in required if not os.environ.get(name)]
if missing:
    raise RuntimeError(f"Missing NextAgent sandbox env: {', '.join(missing)}")
```

反模式：

```python
# 不要：裸相对路径会写到 execution view root，既不是 durable workspace，也不是 run temp。
Path("result.md").write_text("...")

# 不要：.nextagent 是只读 Skill/resource 投影，不是输出目录。
Path(os.environ["NEXTAGENT_SKILL_ROOT"], "result.md").write_text("...")
```

### SKILL.md 格式

`SKILL.md` 是 Skill 的权威 manifest 输入（`skill-manifest-contract` spec）。它由 leading frontmatter 块和 Markdown body 组成。系统只加载下表约定的受治理顶层字段；白名单之外的顶层键会被静默忽略（不报错、不进 metadata、无治理语义）：

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | 是 | 1-64 字符，小写字母/数字/连字符，`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`；必须与目录名一致 |
| `description` | 是 | 1-1024 字符（含中文时）；纯英文时可到 4096 字符；描述 Skill 做什么以及何时使用；可为 YAML literal/folded block |
| `license` | 否 | 字符串 |
| `compatibility` | 否 | 1-500 字符字符串 |
| `allowed-tools` | 否 | 空格分隔的 tool name 字符串，解析为 `string[]`，去重保留首次顺序 |
| `disallowed-tools` | 否 | 空格分隔的 tool name 字符串或字符串数组，解析规则与 `allowed-tools` 一致，映射为 denied tool 约束 |
| `context` | 否 | `inline`（默认）或 `fork` |
| `agent` | 否 | fork Agent 选择 hint，必须是 canonical `AgentId`；声明 `agent` 时 `context` 默认归一为 `fork`，与 `inline` 显式冲突会被 reject |
| `user-invocable` | 否 | 布尔，默认 `false` |
| `model-invocable` | 否 | 布尔，默认 `true` |
| `model` | 否 | 安全 model 名字符串（推理参数声明在 `metadata.modelOptions`） |
| `metadata` | 否 | string→string 映射；`exclusiveWith`/`compatibleWith`/`tags` 可为数组；`metadata.version` 映射为 descriptor version；`metadata.zh-name`/`en-name` 映射为中英文展示名称；`metadata.modelOptions` 为受治理 model hint；`metadata.extension` 为结构化扩展 wrapper；其余未知键按安全 source metadata 保留，不安全/不支持条目静默省略 |

builtin 示例（`skill-creator`）：

```markdown
---
name: skill-creator
description: Create or refine NextAgent runtime local skills that fit the current skill manifest and skill resource boundaries.
context: inline
user-invocable: false
model-invocable: true
metadata:
  version: 0.1.0
  zh-name: 技能创建
  en-name: Skill creation
---

Create or update one NextAgent skill that matches the current system boundary.
```

校验结果分两态：`accepted`（产出 descriptor；不安全或不受支持的 metadata/extension 条目被静默省略，不产生诊断）和 `rejected`（不产出 descriptor，进入 source skip path）。诊断使用稳定的 `SkillManifestDiagnostic.reasonCode` 集合（如 `SKILL_MD_MISSING`、`INVALID_NAME`、`NAME_MISMATCH`、`INVALID_DESCRIPTION`、`INVALID_CONTEXT`、`AGENT_REQUIRES_FORK_CONTEXT`、`UNSAFE_MODEL_DECLARATION`、`INVALID_OFFICIAL_FIELD`、`INVALID_TOOL_CONSTRAINTS` 等）；`CONFLICTING_MODEL_DECLARATION`、`SOURCE_METADATA_OMITTED`、`EXTENSION_OMITTED` 在契约中保留但当前不会发出。已移除的声明键（`metadata.nextagent.model`、`metadata.nextagent.modelOptions`、`metadata.denied-tools`）不报错，但只作为 source metadata 保留、不产生任何效果——相关声明需迁移到顶层 `model` / `metadata.modelOptions` / `disallowed-tools` 才会生效；顶层 `model` JSON 对象形态仍会以 `UNSAFE_MODEL_DECLARATION` 拒绝。

关键规则：

- `name` 映射为 `CapabilityDescriptor.capabilityId` 和稳定 `displayName`；`metadata.zh-name`、`metadata.en-name` 分别映射为中英文 `locales`。Provider 限定 id 只留在 `CapabilityDescriptor.provider`，**不**替换模型可见的 Skill `name`。
- `description` 映射为 `CapabilityDescriptor.description`（bounded、sanitized、不含 secret/path/credential）。
- `metadata.version` 映射为 `CapabilityDescriptor.version`，无需 `nextagent` 前缀。
- catalog governance 保证同一 Agent 模型可见披露集中每个 `capabilityId` 至多一个可用 Skill，歧义重复在模型披露与调用前被 resolve/shadow/skip/diagnose。
- `allowed-tools` / `disallowed-tools` 只是 tool 约束**事实**，不授予额外权限；实际 tool 执行权仍由 capability governance、Agent assembly、owner scope、policy 决定。
- `model` 声明是受治理 model **hint**，非授权；最终 provider/model/credential/endpoint 由模型目录与选择治理决定。
- Markdown body 是 authoring content，由后续 Skill 调用 / context disclosure 负责加载，manifest 校验只交换 frontmatter 派生的 descriptor/metadata/诊断。

### Skill 指定后续模型调用

Skill 可以通过 manifest 的 `model` 声明为**下一次模型调用**提供受治理 model hint。这个能力适合把特定领域流程交给更合适的模型，例如告警根因分析、配置审查、报告生成等需要更强推理或更低温度的 Skill。

注意边界：

- Skill 的 `model` 直接指定 canonical `modelId`，不会按 display name 或 provider 私有名称反查。
- Skill 不允许直接指定 provider、credential、baseUrl、endpoint、headers 或 provider 私有配置。
- 最终模型选择仍由当前 Agent 的 `modelIds`、`defaultModelId`、模型目录可用性和 model governance 决定。
- `model` / `modelOptions` 只在 Skill 成功加载后作为 request-local `contextPatch` 影响后续模型轮次；Skill body 加载这一轮仍使用当前已选模型。
- 如果当前 Agent 的已激活模型中没有该 `modelId`，后续模型选择会以 `CAPABILITY_MODEL_PATCH_DENIED` 安全拒绝。

#### 1. 在 system config 定义可用模型

开发者的 `application.yaml` 中必须存在与 Skill manifest 声明完全相同的 canonical `modelId`：

```yaml
modelProfiles:
  - providerId: openai-compatible
    baseUrl: https://api.example.invalid/v1
    credentialRef: env:OPENAI_API_KEY
    models:
      - modelId: deterministic-test-model
        temperature: 0.2
        maxOutputTokens: 2048
        contextWindowTokens: 128000
        fallbackEligible: false
        timeoutMs: 30000
      - modelId: skill-preferred-model
        temperature: 0.1
        maxOutputTokens: 1024
        contextWindowTokens: 128000
        fallbackEligible: false
        timeoutMs: 30000
```

#### 2. 在 Agent assembly 中授权该模型

`agent.yaml` 的 `modelIds` 必须包含默认模型和 Skill 可能请求的模型。顶层 `defaultModelId` 是普通请求的可选默认模型：

```yaml
agentId: default-agent
agentVersion: v1
modelIds:
  - deterministic-test-model
  - skill-preferred-model
defaultModelId: deterministic-test-model
capabilityBindings:
  - capabilityId: model-patch-skill-test
    capabilityType: SKILL
    providerId: local-skills-system
    enabled: true
runtimeSettings:
  defaultLanguage: zh-CN
  requestTimeoutMs: 30000
resources: []
```

不要只在 system config 中定义 Skill 目标模型。若 Agent 显式收窄模型集合，却只声明：

```yaml
modelIds:
  - deterministic-test-model
```

则 Skill 中声明 `model: "skill-preferred-model"` 不会生效；后续模型轮次会被 model governance 安全拒绝。正确做法是把 `skill-preferred-model` 也加入 `modelIds`，再以顶层 `defaultModelId` 保持普通请求默认使用 `deterministic-test-model`。

#### 3. 在 SKILL.md 声明 model hint

推荐使用顶层 `model` 声明。`model` 只接受 canonical model ID 字符串；推理参数用 `metadata.modelOptions` 单独声明（JSON 字符串对象）：

```markdown
---
name: alarm-diagnosis
description: Diagnose telecom alarm chains and produce probable root cause.
context: inline
user-invocable: true
model-invocable: true
allowed-tools: Read Grep rag
model: skill-preferred-model
metadata:
  version: "1.0.0"
  modelOptions: '{"temperature":0.4,"topP":0.8}'
---

# Alarm Diagnosis

Analyze alarm correlation, affected NE/interface, KPI degradation, recent changes,
and likely root cause. Use only governed context and allowed tools.
```

只声明 `modelOptions` 而不切换模型也是合法写法（沿用当前已选模型，仅覆盖推理参数）：

```markdown
---
name: report-generation
description: Generate a telecom incident report from gathered evidence.
context: inline
user-invocable: true
model-invocable: true
model: skill-preferred-model
metadata:
  version: "1.0.0"
  modelOptions: '{"temperature":0.3,"topP":0.9}'
---

# Report Generation

Create a concise incident report with scope, evidence, root cause, action plan, and residual risks.
```

Skill `modelOptions` 只接受 closed canonical inference fields；`providerOptions` 可承载当前 selected provider 的安全扩展，但不得重复 canonical fields，也不得包含 identity、access、transport、credential 或 header 控制。需要调整通用默认生成参数时，优先在对应 `modelProfiles[].models[]` 子项直接配置。

#### 4. 生效链路

```text
模型调用 Skill(name="alarm-diagnosis")
  -> Skill tool 解析 governed Skill descriptor
  -> 加载 SKILL.md body 并生成 <skill_content> meta message
  -> Skill metadata.model 生成 contextPatch.modelId
  -> Skill metadata.modelOptions 生成 contextPatch.modelOptions
  -> 下一轮 context assembly 调用 modelSelectionResolver
  -> 只在当前 Agent assembly.modelIds 中解析可用模型
  -> canonical modelId 精确匹配时使用该模型
```

这意味着 Skill 指定模型不是 capability 自己直接调用 provider，而是通过 request-local context patch 交给统一模型选择服务做最终选择。

#### 5. 验证

该场景有专门 E2E 覆盖：

```bash
npx vitest run --config vitest.config.release.ts tests/e2e/skill-tool-search-multi-round-context.test.ts
```

测试用例 `applies Skill model metadata to the next governed model invocation` 会走真实 HTTP request、`ToolSearch`、`Skill` 加载和后续模型轮次，断言：

- 前两轮仍使用默认 `deterministic-test-model`。
- Skill 加载后的下一轮切到 `skill-preferred-model`。
- Skill 的 `temperature` / `topP` 覆盖被合并，profile 默认 `maxOutputTokens` 保留。

测试用例 `rejects Skill model metadata when the target model is not authorized by the Agent assembly` 覆盖负向边界：

- 开发者 `application.yaml` 同时配置默认模型和 Skill 目标模型。
- 当前 Agent 只在 `modelIds` 中授权默认模型。
- Skill 成功加载后，目标模型 patch 被拒绝，请求进入 `REQUEST_FAILED`。
- 捕获到的模型调用仍只使用默认模型，不能切到未授权的 Skill 目标模型。

该文件已纳入 `npm run test:e2e:release`。

### Skill 注册（进入 catalog）

Skill 不通过代码注册，而是通过 **source discovery** 进入 catalog。`agent-capability` 提供两类本地 Skill source（`packages/agent-capability/src/local/skill-discovery.ts`）：

- **系统级本地 Skill**：`local-skills-system` provider（`providerKind=LOCAL_DIRECTORY`，`discoveryMode=EAGER`），扫描 `configRoot/skills` 目录，启动期进入 catalog governance。每个子目录需含合法 `SKILL.md`，目录名必须匹配 `name`。
- **Agent-owned 本地 Skill**：`local-skills-agent-owned` provider（`providerKind=LOCAL_DIRECTORY`，`discoveryMode=SEARCH`），由 trusted Agent package locator 定位 `configRoot/agents/{agentId}/skills`，在当前 Agent request scope 中按 SEARCH discovery 进入可用 Skill 清单。

另有 `builtin-skills` provider（`providerKind=BUNDLED`，`discoveryMode=EAGER`）承载打包内置的 Skill（如 `skill-creator`），以及 `skill-hub` / `SKILL_HUB` provider（`discoveryMode=SEARCH`）承载远程 SkillHub。

`createCapabilitySubsystem(...)` 在内部把这几类 source 注册进 `StaticCapabilityCatalog`：

```ts
// packages/agent-capability/src/subsystem.ts （节选）
const internalProviders = createInternalProviders({ discoveryFactory, ... });
const externalProviders = options.externalProviders ?? [];
const providers = [
  ...internalProviders,
  ...externalProviders,
  ...createConfigDrivenProviders({ discoveryFactory, configs: normalizedConfigs, ... })
];
const snapshot = assembleCapabilityProviders(providers);
catalog = new StaticCapabilityCatalog([], {
  eagerDiscoveries: snapshot.eagerDiscoveries,
  searchDiscoveries: snapshot.searchDiscoveries,
  skillSourceDiscoveries: skillSourceDiscoveries([...snapshot.eagerDiscoveries, ...snapshot.searchDiscoveries]),
  ...
});
```

### Skill 执行流程

Skill 通过 `Skill` tool（`packages/agent-capability/src/builtins/skill-tool.ts`）执行。`Skill` tool 是统一 capability framework 下的 Tool 入口，`returnsCapabilityResult: true`：

```
模型决定调用 Skill（name = 某 governed capabilityId）
  → Skill tool 校验 input（name + 可选 args；禁止 timeout/path/provider 等执行治理字段）
  → capabilityResolver.resolveCapability({ kind: "SKILL", capabilityId })
  → disclosure 校验（EAGER / DEFERRED / HIDDEN）
  → readSkillMetadata(descriptor) 读取 SkillMetadata
  → context 校验：metadata.context === "fork" 在本版本被拒绝（SKILL_CONTEXT_UNSUPPORTED）
  → skillSources.resolveSkillSource(providerId) 拿到 SkillSourceDiscovery
  → source.loadCanonicalBodyView(...) 加载 body + 一致性校验（frontmatterHash / 版本必须匹配 governed descriptor）
  → body 安全边界校验（大小、控制字符、受保护宿主路径；`/tmp/` 可作为业务目录）
  → workspaceFiles.projectSkillResources(...) 把 scripts/references/assets projection 到 execution workspace
  → 生成 <skill_content> USER meta message 注入主对话 + 可选 contextPatch（allowedTools/deniedTools/model/modelOptions）
  → 返回 CapabilityInvocationResult{ status: "SUCCEEDED", generatedMessages: [...], ... }
```

关键点：

- Skill body 作为 `USER` role 的 meta message 注入**主对话上下文**（`inline` 语义），不是独立子 run。
- `args` 只承载任务相关 JSON 对象数据；`timeout`/`path`/`provider`/`budget`/`mode` 等执行治理字段是禁止的，出现即 `INVALID_INPUT`。
- `available-deferred-skills` 中列出的 Skill id 只是 ToolSearch 候选，不是调用许可；必须先经 `ToolSearch` 激活后才能调用 `Skill` tool（见 [能力扩展](./05-capability-extension.md) 的 ToolSearch 模式）。
- 一致性校验：加载时的 `frontmatterHash`、`skillVersion`、`providerId`、`capabilityId` 必须与 governed descriptor 匹配，否则返回 `SKILL_SOURCE_CHANGED` / `SCOPE_MISMATCH`，防止 source 在 governance 后被篡改。

### Forked Skill（独立上下文 Skill）

`context: fork` 是 manifest 契约支持的上下文扩展，表示 Skill 应在独立上下文执行。但**当前版本尚未实现 fork 执行路径**：`skill-tool.ts` 在检测到 `metadata.context === "fork"` 时直接返回 `SKILL_CONTEXT_UNSUPPORTED`。`agent` frontmatter 字段是 fork Agent 选择 hint，声明它会让 `context` 归一为 `fork`，但同样无法在本版本执行。开发者当前应使用 `context: inline`，除非后续版本明确提供 fork 执行路径。

## 代码位置速查

| 组件 | 路径 |
|------|------|
| Tool SPI / `defineTool` / `Tool` 接口 | `packages/agent-capability/src/tools/tool-spi.ts` |
| Tool catalog / `createToolCatalog` | `packages/agent-capability/src/tools/tool-catalog.ts` |
| Builtin tool list / providers | `packages/agent-capability/src/builtins/index.ts` |
| Builtin tool executor | `packages/agent-capability/src/execution/executor.ts` |
| Capability subsystem 装配 | `packages/agent-capability/src/subsystem.ts` |
| Provider config 归一化 | `packages/agent-capability/src/provider-config.ts` |
| Catalog governance | `packages/agent-capability/src/catalog/catalog.ts` |
| Skill manifest 契约 / parser | `packages/agent-capability/src/skills/skill-manifest.ts` |
| Skill source discovery 接口 | `packages/agent-capability/src/skills/skill-source-discovery.ts` |
| 本地 Skill source 实现 | `packages/agent-capability/src/local/skill-discovery.ts` |
| Skill tool（执行入口） | `packages/agent-capability/src/builtins/skill-tool.ts` |
| ToolSearch tool | `packages/agent-capability/src/builtins/tool-search-tool.ts` |
| Agent tool（subagent 入口） | `packages/agent-capability/src/builtins/agent/agent-tool.ts` |
| Bash tool（sandbox 路由示例） | `packages/agent-capability/src/builtins/bash/bash-tool.ts` |
| Glob tool（最小 tool 示例） | `packages/agent-capability/src/builtins/glob/glob-tool.ts` |
| 内置 Skill 示例 | `packages/agent-capability/src/builtins/skills/skill-creator/SKILL.md` |
| 默认 Agent 配置 | `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` |
| 规格契约 | `openspec/specs/builtin-tool-framework/spec.md`、`openspec/specs/skill-manifest-contract/spec.md`、`openspec/specs/skill-tool/spec.md`、`openspec/specs/capability-catalog/spec.md` |
| 设计文档 | `openspec/designs/architecture/capability-spi.md`、`openspec/designs/architecture/skill-invocation-and-disclosure.md` |

## 开发 Checklist

### Tool 开发 Checklist

- [ ] 用 `defineTool({ name, description, inputSchema, outputSchema, ... })` 定义 Tool，返回 `ToolDefinition`
- [ ] `description` 覆盖模型决策信息：一句话总结、When to use / When NOT to use（路由指引）、Key behaviors（输出格式、截断、硬失败 + reason code）
- [ ] `inputSchema` / `outputSchema` 用 JSON Schema（TypeBox/Ajv 生态），描述真实实现行为，不承诺未实现能力
- [ ] 声明 `requiredDependencies`（`sandbox` / `workspaceFiles` / `skillSources` / `ragRetrieval` / `subagentExecution` / `approval`），缺失依赖会被 catalog 标记 `UNAVAILABLE`
- [ ] 声明 `replayPolicy`（`IDEMPOTENT` / `NON_IDEMPOTENT`）与 `disclosurePolicy`（`EAGER` / `DEFERRED` / `HIDDEN`）
- [ ] `execute` 只消费业务输入 + `ToolExecuteOptions`，返回业务输出对象（不自己构造 `CapabilityInvocationResult`）
- [ ] 不接收/派生 workspace root、host 绝对路径、host 进程 API；走受控依赖
- [ ] 失败用 `ToolDegradedResultError` / `ToolTimedOutResultError` / `ToolFailedResultError` 表达安全语义
- [ ] 把 `ToolDefinition` 加入 owned tool list（builtin 走 `builtinToolDefinitions`；应用层 / 其他 owning package 通过 public factory 返回 `CapabilityProviderContribution`，由 `agent-app` 经 `externalProviders` 注入）
- [ ] 在 `agent.yaml.capabilityBindings` 中绑定该 Tool（`capabilityType: "TOOL"`）

### Skill 开发 Checklist

- [ ] 在 `configRoot/skills/<skill-name>/`（系统级）或 `configRoot/agents/<agentId>/skills/<skill-name>/`（Agent-owned）下创建 Skill 目录
- [ ] 目录名与 `name` 一致，小写 kebab-case，匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`
- [ ] 编写 `SKILL.md`：frontmatter（`name` + `description` 必需）+ Markdown body
- [ ] `description` 明确说明 Skill 做什么以及何时触发
- [ ] 使用 `context: inline`（本版本 fork 不可执行）；`metadata.version` 标注版本
- [ ] 仅在确有需要时声明 `allowed-tools` / `disallowed-tools`（约束而非授权）
- [ ] 仅在确有需要时声明 `model` / `metadata.modelOptions`；确认目标 canonical `modelId` 已由当前 Agent 的 `modelIds` 授权
- [ ] `modelOptions` 只放安全、受治理接受的覆盖项；provider、credential、endpoint、token、secret、baseUrl 等配置必须留在 system `modelProfiles`
- [ ] 资源放 `scripts/` / `references/` / `assets/`，不放根级 `README.md` / `LICENSE`
- [ ] body 不嵌入受保护 host 路径、provider 私有 source 事实或执行治理指令；`/tmp/` 可作为常见业务目录，Auth、Authorization、Token、Credential、Password、Secret 和 API key 相关业务说明或值可作为 Skill Content 原样加载
- [ ] （若希望模型可调用）确保 `model-invocable: true`（默认即 true），并在 Agent 的 disclosure / `agent.yaml` 中可见

## 下一步

- [能力扩展](./05-capability-extension.md) — Capability source、扩展机制、Lifecycle Hook
- [提示工程](./06-prompt-engineering.md) — 定制 Agent 的对话行为
- [测试与调试](./11-testing-debugging.md) — 测试 Skill 和 Tool
