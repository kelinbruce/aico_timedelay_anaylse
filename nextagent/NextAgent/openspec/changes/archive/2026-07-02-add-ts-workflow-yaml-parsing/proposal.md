# add: add-ts-workflow-yaml-parsing

## 背景与问题（Why?）

`agent-app` 的 `parseBuiltInConfig` 是全仓共享的文本解析口径，被系统配置 `default-system.yaml`、agent 定义 `agent.yaml`、workflow recipe 三条加载路径消费。当前对非 JSON 内容回退到手写 `parseFlatYaml`，后者仅支持单行扁平 `key: value`（key 字符集 `[A-Za-z0-9_]+`），不支持缩进块、嵌套 map、块式数组，也不做数字/布尔/null 类型推断，遇到任意复杂语法直接抛 `Built-in YAML uses unsupported syntax.`。

事实核查：
- 仓内现有 `.yaml` 文件（`default-system.yaml`、两个 `agent.yaml`）全部以 JSON 语法写成，走 `JSON.parse` 成功，`parseFlatYaml` 是事实死路径。
- workflow recipe 是第一个真正需要 YAML 嵌套语法的场景：节点图 `nodes`、`next` 分支嵌套 map、`inputs`/`outputs` 嵌套结构在扁平解析器下全部失败。

本 change 只解决「YAML 文本 → JavaScript 对象」的解析能力缺失，提供一个入参为字符串、出参为对象的纯解析接口。谁触发解析、解析结果如何被消费、是否为合法 recipe，均不属于本 change。

## 第一性原理

- **会什么**：把任意 YAML 文本（key-value 的 map、数组、字符串、数字、布尔、null 及任意嵌套）解析为等价的 JavaScript 值；JSON 文本仍优先走 `JSON.parse`。
- **解决什么问题**：嵌套 YAML 无法解析；`parseFlatYaml` 死路径掩盖真实解析能力缺失。
- **目标**：提供唯一、标准、可测试的 YAML 解析接口。
- **输入**：文本内容字符串。
- **输出**：与文本结构对应的 JavaScript 值（对象/数组/标量）。
- **边界**：仅做文本→对象的解析。不关注谁触发解析（系统配置/agent 定义/recipe 加载均可是调用方）；不关注解析结果的业务语义；不关心结果是否为合法 recipe/agent 定义/系统配置。触发时机、加载目录、文件扫描、失败日志、业务转换、schema 校验均由各调用方负责。
- **黑盒效果**：
  - 给定合法 YAML（含嵌套），返回等价 JS 值；
  - 给定合法 JSON，返回等价 JS 值（行为不变）；
  - 给定非法 YAML，抛异常，由调用方处理；
  - `Built-in YAML uses unsupported syntax.` 错误彻底消失。

## 变更范围（What Changes?）

- **替换** `parseBuiltInConfig` 的 YAML 解析实现：引入 `js-yaml` 替换手写 `parseFlatYaml`，支持 map、数组、字符串、数字、布尔、null 及任意嵌套。
- **移除** `parseFlatYaml` 手写解析器及其 `Built-in YAML uses unsupported syntax.` 错误路径。
- 接口签名不变：入参 `content: string`，出参 `unknown`（解析后的 JavaScript 值）。

## 不在范围内（Explicit Non-Goals?）

- **不关注谁触发解析**：`parseBuiltInConfig` 是被调用的纯解析接口，触发时机、调用方（系统配置/agent 定义/recipe 加载）不在本 change 关注范围。
- **不改 recipe 加载流程**：recipe 加载触发点、扫描目录（`agents/{agentId}/recipes/` 收窄由 `refine-ts-workflow-routing-recipe-loading` owner）、文件信任校验、失败日志（`recipeRef`/`diagnostic` 由调用方 `workflow-recipe-loader` 负责）均不属于本 change。
- **不负责业务转换**：`normalizeRecipeDefinition`、`normalizeNodeType`、节点类型映射、Ajv `RecipeDefinitionSchema` 校验由各消费方/后续 recipe-load change 负责。本 change 不改动这些函数逻辑，也不在 spec 中固化其行为。
- 不改 `RecipeDefinition`/`FlowGraph`/`WorkflowNodeDef`/`AgentDefinition` 契约字段定义。
- 不改 `parseAgentDefinition` / `evaluateDefaultSystemConfig` 的归一化与校验逻辑。
- 不实现 YAML 自定义标签、锚点/别名、多文档（`---`）等高级特性。
- 不改 `mergeConfigOverlay` / `resolveModelProfileEnvRefs` 等系统配置后处理逻辑。

## Capability 影响（Capabilities）

### 修改的 Capability
- `app-config-schema`：`parseBuiltInConfig`（系统配置加载路径的核心解析函数，被系统配置/agent 定义/recipe 三条路径共享）的 YAML 解析实现升级为标准 YAML 解析器。本 change 只升级解析接口实现，不改各调用方的加载流程。

## 影响范围（Impact）

- `agent-app`：`src/config/system-config.ts`（`parseBuiltInConfig` / 移除 `parseFlatYaml`）；`package.json` 新增 `js-yaml` 依赖。
- `agent-app`：`src/composition/workflow-recipe-loader.ts`、`src/assembly/*`、`src/local-runtime-package/*` 作为调用方，无直接改动，行为随解析接口升级而变化。
- `agent-contracts/core` / `agent-common`：无改动。
- `agent-app/tests`：新增 YAML 解析接口能力测试。
- `openspec/specs/app-config-schema`：新增 `Recipe YAML Parsing` requirement。

## 职责边界对齐（Boundary Alignment）

- `app-config-schema`：owner `parseBuiltInConfig` 解析接口实现与系统配置 schema；本 change 升级解析接口实现，不改 schema、不改各调用方加载流程。
- `workflow-contracts`：owner `RecipeDefinition` 契约，本 change 不改字段。
- `workflow-package`：recipe 加载流程（触发点、目录、日志）的 owner；本 change 不改其流程，仅升级其消费的解析接口。
- 后续 recipe-load change：owner recipe 业务转换（归一化、节点映射、校验）。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/app-config-schema/spec.md`：新增 `Recipe YAML Parsing` requirement。
- `openspec/designs/modules/agent-workflow.md`：补充 YAML 解析口径。
- `openspec/designs/spec-to-design-map.md`：按需补充导航。

## 验证入口（Validation）

- `npm run build`
- `vitest run packages/agent-app/tests/workflow-recipe-yaml-parsing.test.ts`
- `vitest run packages/agent-app/tests/system-config.test.ts`
- `openspec validate --all --strict`
- `npm run lint:architecture`


