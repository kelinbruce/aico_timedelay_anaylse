# Design

## 问题与目标

`parseBuiltInConfig` 是全仓共享的文本解析口径，被系统配置、agent 定义、workflow recipe 三条路径消费。当前对非 JSON 内容回退到手写 `parseFlatYaml`，只支持单行扁平 `key: value`，无法处理嵌套 map 与块结构。仓内现有 `.yaml` 文件均以 JSON 语法写成，`parseFlatYaml` 是事实死路径；workflow recipe 是第一个真正需要 YAML 嵌套语法的场景。

目标：把 `parseBuiltInConfig` 升级为标准 YAML 解析接口，入参字符串、出参对象，不关注谁触发、不关注结果业务语义。

## 第一性原理

- **会什么**：YAML 文本 → 等价 JavaScript 值（map/数组/字符串/数字/布尔/null 及嵌套）；JSON 文本 → `JSON.parse`。
- **解决什么**：嵌套 YAML 无法解析；死路径掩盖能力缺失。
- **输入**：文本字符串。**输出**：JavaScript 值。**边界**：仅解析，不解释业务语义，不关心调用方与触发时机。
- **黑盒效果**：合法 YAML→等价值；合法 JSON→等价值（不变）；非法 YAML→异常由调用方处理；`Built-in YAML uses unsupported syntax.` 消失。

## 唯一实现路径

**引入 `js-yaml` 替换 `parseFlatYaml`。**

理由与取舍：
- 手写完整 YAML 解析器不可靠且违反 KISS；电信级质量要求指向业界标准实现。
- `js-yaml` 是 YAML 1.1 事实标准，覆盖全部需求。
- `parseBuiltInConfig` 已是三条路径的共同解析口径，统一升级即可（同形同策），不为某条路径单独引入第二套解析函数。
- 不启用 YAML 高级特性（自定义标签、锚点/别名、多文档），`js-yaml` 默认 `load` 即可。

不采用方案：
- 扩展 `parseFlatYaml` 支持嵌套：等于重写半个 YAML 解析器，复杂且不可靠，舍弃。
- 为 recipe 单独引入独立解析函数：违反同形同策，舍弃。

## 解析器替换

```ts
import { load as parseYaml } from "js-yaml";

export function parseBuiltInConfig(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return parseYaml(content);
  }
}
```

接口签名不变：入参 `content: string`，出参 `unknown`。保留 JSON 优先回退：`.json` 与 JSON-as-YAML 文件行为不变；非 JSON 内容走标准 YAML 解析。移除 `parseFlatYaml` 及其错误路径。

本 change 不改动 `normalizeRecipeDefinition` / `normalizeNodeType` / `containsUnsupportedParallelNode` / `recipeValidator` / `mergeConfigOverlay` / `resolveModelProfileEnvRefs` 等调用方逻辑——它们继续以现有方式工作，其行为固化和重构由各自 owner change 负责。

## 影响面分析

`parseBuiltInConfig` 是被调用的纯解析接口，调用方（均为本 change 之外的关注点）：
- 系统配置：`system-config.ts`、`local-runtime-package/index.ts`。`default-system.yaml` 实为 JSON，走 `JSON.parse`，升级无影响。
- agent 定义：`agent-discovery-source.ts`、`agent-directory-loader.ts`、`local-runtime-package/index.ts` → `parseAgentDefinition`。现有 `agent.yaml` 实为 JSON，升级无影响。
- recipe：`workflow-recipe-loader.ts` → `normalizeRecipeDefinition`。升级前非平凡 recipe 解析失败被调用方跳过，升级后接口返回正确对象，后续业务转换是否能处理由 recipe-load change 负责。

本 change 不改动任何调用方，只升级被调用的解析接口。

## 类型推断与兼容性

`js-yaml` 做 YAML 1.1 类型推断：`1.0`→number、`true`→boolean、`null`→null。`parseFlatYaml` 把所有标量当字符串。

- **系统配置 / agent 定义**：`.yaml` 文件实为 JSON，`JSON.parse` 已做类型推断，升级无变化。
- **recipe**：解析层只返回对象，类型推断结果交由调用方消费；本 change 不关心。
- 样例 `version: 1.1.0`：`1.1.0` 非合法数字，js-yaml 保留为字符串。这是解析接口的客观行为，是否符合 recipe 契约由调用方判断。

## 安全边界

- `js-yaml` 默认 `load` 不启用自定义 schema，不执行任意代码，安全。
- 解析接口本身无 I/O、无日志、无状态，不涉及文件信任校验（由调用方负责）。
- 解析失败抛异常，是否记录日志、记录什么内容，由调用方决定。

## 质量属性审视

- **安全**：解析器不执行代码；无 I/O 副作用。
- **性能/容量**：`js-yaml` 解析性能满足需求；调用方按需调用。
- **可靠性/恢复**：解析失败抛异常，恢复策略由调用方决定。
- **可维护性**：移除手写解析器，降低维护成本；解析口径统一。
- **可测试性**：`parseBuiltInConfig` 已从 `testing.ts` 导出，接口能力可独立测试（入参字符串、出参对象）。
- **审计/可追溯**：解析行为变化在 spec 固化。

## 边界对齐

- `app-config-schema`：owner `parseBuiltInConfig` 解析接口实现与系统配置 schema；本 change 升级解析接口实现，不改 schema、不改各调用方加载流程。
- `workflow-package`：recipe 加载流程（触发点、目录、日志）的 owner；本 change 不改其流程，仅升级其消费的解析接口。
- `workflow-contracts`：owner `RecipeDefinition` 契约，本 change 不改字段。

## 验证入口

- YAML 解析接口能力测试：覆盖 map/数组/字符串/数字/布尔/null 及嵌套；JSON 优先回退；非法 YAML 抛异常。
- 系统配置加载回归测试：`default-system.yaml` 加载不回归。
- 架构测试：`agent-app` 对 `js-yaml` 的依赖不破坏架构边界。


