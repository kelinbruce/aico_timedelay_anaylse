## 背景和现状（Context）

当前 lifecycle hook 的执行闭环已经存在：`agent-runtime` 拥有 stage 触发、decision / mutation 消费、pending input、timeline-only evidence 和 HookInvocationEvent；`agent-core` 只提供邻接 stage facts；`agent-app` 通过 `lifecycleHook`、`lifecycleHookDefinitions`、`lifecycleHookBindings` 把冻结后的组合结果注入 runtime。

现状缺口不在 runtime executor，而在工程装载层：

- 产品 hook 没有与 `skills/` 类似的目录化承载方式；
- hook 的 definition / binding / handler 只能靠 composition 代码手工拼装；
- 没有统一的 startup validation、路径边界和重复检测；
- `add-ts-lifecycle-hook-execution` 已经把 `hooks/` 写成非规范性示意，但实现和 stable spec 仍没有工程目录加载路径。

仓库现有 trusted 工程目录体系已经形成两个稳定习惯：

1. `configRoot` 承载工程配置和受信源目录，例如 `configRoot/skills`、`configRoot/agents`。
2. `agent-app` startup composition 负责把 trusted root 派生、校验并转成冻结后的 runtime input，而不是让 runtime 自己扫目录。

因此，这次 change 的核心不是再造一套 hook runtime，而是把 hook 目录加载收敛到与 local Skill source 一致的 startup-composed trusted root 模式。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 把 trusted hook root 唯一收敛为 `configRoot/hooks`。
- 定义 `hooks/` 下 hook package 的目录布局、manifest authoring 和 module entry 约束。
- 由 `agent-app` 在启动期扫描、校验、加载并冻结 hook snapshot，再注入现有 runtime executor。
- 明确 fail-closed 边界：重复 `hookId`、路径逃逸、导出错误、manifest 非法、binding 非法都必须阻止启动。
- 保持 runtime、pending、mutation、observability、risk policy 的既有 owner 边界不变。

**非目标：**

- 不引入 remote hook source、hook marketplace、provider 化 hook catalog、热加载 watcher 或 runtime reload。
- 不新增 `agent-contracts/hook`、generic `HookProvider`、通用插件系统或第二套 hook executor。
- 不让 `agent-runtime`、`agent-core` 或 `agent-channel-web` 承担目录扫描职责。
- 不把 hook directory loading 扩展成用户请求驱动的动态代码装载。
- 不修改 risk policy 的 owner boundary；risk policy 仍不是 lifecycle hook。

## 设计决策（Decisions）

### D1. 唯一 trusted hook root 采用 `configRoot/hooks`

选择：`hooks/` 根目录固定从 trusted `configRoot` 派生为 `configRoot/hooks`。

原因：

- 这与 `configRoot/skills` 的现有稳定模式一致，读者和运维都容易理解；
- `configRoot` 已经是 app composition 的 trusted root，天然适合承载产品工程资源；
- 避免新增 `paths.hooksRoot` 之类的用户可写 path entry，减少路径安全面；
- 相比 `workspaceRoot/hooks`，`configRoot/hooks` 更符合“工程静态资源而非运行数据”的语义。

放弃方案：

- `workspaceRoot/hooks`：会把工程代码与运行数据根混在一起，增加 overlap / cleanup 风险。
- 任意绝对路径配置：会扩大 trusted path 面，与现有 `configRoot/skills` 模式不一致。
- app 内硬编码 import registry：仍然要求人工改 composition，不解决目录化装载问题。

### D2. Hook package 采用一级目录 + 固定文件名

选择：每个 hook package 固定为 `configRoot/hooks/<hook-id>/`，目录内包含：

- `hook.json`：受信 manifest
- `index.js`：启动期实际 import 的 module entry

工程源代码可以以 TypeScript 形式维护，但启动期加载的 trusted entry 以构建产物 `index.js` 为准。目录名必须等于 `hookId`，禁止额外路径跳转。
首版 `index.js` 要求自包含导出 `invoke(input, signal)`，不支持 `import` 声明；如后续需要多文件模块化装载，必须通过新 change 显式扩展启动装载模型。

`hook.json` 的 authoring 结构固定为：

- 顶层 `hookId`
- 顶层最小 definition 字段：
  - `kind`
  - `supportedStages`
  - `executionMode`
  - `failureMode`
- `bindings`
  - 首版最小 authoring 只要求 `agentId`
  - 运行时 `bindingId`、`enabled=true`、`stages=supportedStages`、`order=0`、`timeoutMs=system default` 由 loader 派生
  - binding 内不重复 `hookId`

这样做的原因：

- 运行时边界仍然是 definition / binding / handler 三分，不引入平行 DTO；
- `hookId` 作为显式稳定 identity 保留，便于 runtime、observability、timeline 和启动期一致性校验；
- 去掉 `definition` 包裹层后，工程作者不需要手写一份过于贴近 runtime DTO 的嵌套结构；
- `source` 不进入首版 manifest，由 loader 固定派生成 trusted directory source，避免无意义样板字段；
- binding 只要求 `agentId`，其他低频字段统一走 loader 默认值，更贴近产品作者真正需要声明的最小信息；
- `defaultOrder`、`defaultTimeoutMs`、`defaultConfig` 不进入首版 manifest，避免把低频默认项暴露成工程配置噪音；
- 一级目录布局和 local Skill source 一致，便于未来排查和 packaging；
- 固定 `hook.json + index.js` 比“任意入口文件 + 自定义 manifest 路径”更简单、可校验、可测试。

放弃方案：

- 把 definition、binding、handler 写成多个任意文件：灵活但会扩大装载复杂度。
- 单文件 `hooks/<hook-id>.ts`：目录扩展性差，不利于未来加文档或测试资源。
- 让 manifest 指定任意 `sourceModule`：会增加路径逃逸与重复校验复杂度。
- 保留 `source` 作为 manifest 必填字段：对首版没有实际区分价值，只会增加样板配置。
- 要求 binding 首版显式填写 `bindingId`、`enabled`、`stages`、`order`、`timeoutMs`：与最小 authoring 目标冲突，增加理解成本。
- 把 `defaultOrder`、`defaultTimeoutMs`、`defaultConfig` 暴露到首版 manifest：虽然与 runtime DTO 更一致，但对首版工程作者来说信息密度过高，不符合 KISS。

### D3. 目录扫描 owner 固定在 `agent-app`

选择：`agent-app` startup composition 新增 hook directory loader，负责：

1. 派生并校验 `configRoot/hooks`
2. 扫描一级目录 candidate
3. 读取并校验 `hook.json`
4. 校验 `index.js` 位于当前 package 目录内且导出约定的 `invoke(input, signal)`
5. 物化为：
   - `RegisteredLifecycleHookPort`
   - `LifecycleHookDefinition[]`
   - `AgentHookBinding[]`
6. 冻结快照后注入 `createRequestLifecycleCoordinator`

原因：

- app composition 已经是 trusted source root、resource registry 和 reserved provider 的 owner；
- runtime 只应该消费冻结后的 hook snapshot，不该知道目录结构；
- 与 `local-skills-system` 的 startup resource 合成模式一致。

### D4. 启动失败采用 fail-closed，不允许部分加载

选择：只要 `configRoot/hooks` 存在并包含 hook candidate，所有 candidate 必须全部通过校验；任何一个失败都阻止 app 启动。

失败条件至少包括：

- `hook.json` 缺失或 schema 非法
- `hookId` 与目录名不一致
- duplicate `hookId`
- 非法 `supportedStages` / `executionMode` / `failureMode`
- `SYSTEM` hook 被 binding 禁用
- binding 的 `agentId` 缺失或非法
- `index.js` 缺失、导出缺失或导出类型不匹配
- `index.js` 包含 `import` 声明
- symlink / junction / reparse point / `..` 造成的路径逃逸

原因：

- hook 是 request lifecycle 治理边界，半加载状态比“无 hook”更危险；
- fail-open 会造成生产行为与工程期望不一致，排查成本高；
- 与现有 app startup config validation 的 fail-closed 原则一致。

### D5. 运行时不重载、不监听、不回写目录

选择：启动完成后只保留冻结后的 snapshot。request 执行中、recovery 中、pending 恢复中都只使用这个快照；不对 `configRoot/hooks` 做 watcher、热更新或 runtime rewrite。

原因：

- 这与现有 lifecycle hook spec 的 frozen snapshot 语义一致；
- 避免把 request correctness 与文件系统变更绑定；
- 保持恢复路径的确定性。

## 最小工程示意（Minimal Example）

首版 `hooks/` 目录按以下最小结构组织：

```text
config/
  hooks/
    terminal-output-safety-check/
      hook.json
      index.js
```

其中 `hook.json` 采用首版最小 authoring shape：

```json
{
  "hookId": "terminal-output-safety-check",
  "kind": "SYSTEM",
  "supportedStages": ["BEFORE_TERMINAL_EVENT"],
  "executionMode": "BLOCKING",
  "failureMode": "FAIL",
  "bindings": [
    {
      "agentId": "default-agent"
    }
  ]
}
```

对应的 `index.js` 最小导出示意如下：

```js
export async function invoke(input, signal) {
  if (input.stage !== "BEFORE_TERMINAL_EVENT") {
    return { decision: "NO_OPINION" };
  }

  const summary = input.boundary.safeTerminalSummary;
  if (typeof summary === "string" && summary.includes("secret")) {
    return {
      decision: "REJECT",
      safeReason: "terminal-output-blocked"
    };
  }

  return { decision: "APPROVE" };
}
```

首版支持的 entry 写法示例如下：

```js
export async function invoke(input, signal) {
  if (signal.aborted) {
    return { decision: "NO_OPINION", safeReason: "aborted" };
  }
  if (input.stage !== "BEFORE_REQUEST_ACCEPT") {
    return { decision: "NO_OPINION" };
  }
  return { decision: "APPROVE" };
}
```

首版不支持的 entry 写法示例如下：

```js
import { decide } from "./shared.js";

export async function invoke(input, signal) {
  return decide(input, signal);
}
```

不支持这类写法的原因不是 hook 语义本身有限，而是当前 startup composition 仍保持同步装载模型。若在首版直接支持标准 ESM `import`，就需要把 `createComposedApp()` 及其产品/测试启动链路一并扩展为异步装载或引入新的受信构建装载机制，这超出了本次 change 的最小范围。

startup loader 对这份最小示意的派生规则固定为：

- `hookId` 取自 `hook.json`，并要求与目录名一致；
- `kind`、`supportedStages`、`executionMode`、`failureMode` 直接映射到运行时 definition；
- `source` 不由 manifest 提供，由 loader 固定派生为 trusted hook directory source；
- `bindings[].agentId` 由 manifest 提供；
- `bindingId`、`enabled=true`、`stages=supportedStages`、`order=0`、`timeoutMs=system default` 由 loader 自动补齐；
- runtime 最终只消费 loader 物化并冻结后的 `RegisteredLifecycleHookPort`、`LifecycleHookDefinition[]`、`AgentHookBinding[]`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | trusted root 固定为 `configRoot/hooks`；禁止任意 path config、remote URL、symlink/junction/reparse point/path traversal；只允许 package 内 `index.js` 导出；runtime 不接触目录扫描 | app config / startup validation tests、negative loader tests、architecture review |
| 性能/容量 | 只在启动期做一次一级目录扫描和有限 manifest/module 加载；request 主路径不增加额外目录 I/O | startup integration tests、code review 检查“request path 无扫描” |
| 可靠性/恢复 | request/recovery/pending 恢复继续使用冻结 snapshot；不存在请求中途重载；加载失败直接阻止启动，避免半加载状态 | characterization tests for recovery + startup failure tests |
| 可维护性 | 统一目录布局 `configRoot/hooks/<hook-id>/` + `hook.json` + `index.js`；manifest 只暴露最小高频字段；复用现有 runtime executor 和 `RegisteredLifecycleHookPort`，不新增第二套模型 | module tests、code review |
| 可测试性 | loader 可被独立替身测试；manifest 校验、重复检测、路径逃逸、导出错误都可黑盒验证；runtime 继续复用现有 hook integration tests | unit/integration/contract tests |
| 审计/可追溯性 | 启动加载结果与失败原因需要走 safe diagnostic / structured log；request 期 observability 继续复用既有 HookInvocationEvent 和 timeline-only evidence | logging tests、observability review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| trusted hook root 固定为 `configRoot/hooks` | 1.1 | `tests/agent-kernel/config-assembly.test.ts` |
| loader 只在 startup 扫描、runtime 不扫目录 | 1.2 / 2.2 | architecture review、focused integration tests |
| hook package 目录布局与 manifest/schema 必须合法 | 1.3 | loader unit/integration tests |
| duplicate hookId、路径逃逸、导出错误必须 fail closed | 1.4 | negative tests |
| startup 成功后 runtime 只消费冻结 snapshot | 2.1 | lifecycle hook integration tests、recovery characterization tests |
| 现有 hook executor / pending / mutation 语义不回退 | 2.3 | `tests/agent-kernel/lifecycle-hook-execution-*.test.ts` |
| build / contract / architecture 门禁保持通过 | 3.1 | `npm run build`、`npm run test:contract`、`npm run lint:architecture` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/lifecycle-hook-execution/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/configuration-boundary.md`
- 模块设计：`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-runtime.md`
- ADR：若归档时认为“为什么采用 `configRoot/hooks` 而不是 provider/hot reload”需要长期保留，再新增 ADR；否则无
- 导航：`openspec/designs/spec-to-design-map.md`

同一事实的主承载固定如下：

- `configRoot/hooks` trusted root、目录校验和 fail-closed 规则：architecture
- startup loader 和 snapshot materialization owner：agent-app module design
- runtime 只消费冻结快照、不扫目录：agent-runtime module design
- 可观察行为和外部契约：stable spec

## 风险与取舍（Risks / Trade-offs）

- [风险] `index.js` 作为启动期入口要求 packaging 正确保留 `hooks/` 构建产物 -> 缓解方式：把 build/package 验证写成显式任务和测试入口。
- [风险] 同时允许测试直接注入 `lifecycleHook*`，可能造成产品路径和测试路径分叉 -> 缓解方式：spec 明确“测试可直注，产品路径以目录加载为准”，并保留产品路径集成测试。
- [风险] 未来若要支持多 agent 差异化 hook 组合，`hook.json` 的 binding authoring 可能增长 -> 缓解方式：首版只要求 `agentId`，其余字段按 loader 默认值派生；真实需求出现后再通过新 change 增量扩展。
- [风险] 移除 manifest 中的 `defaultOrder` / `defaultTimeoutMs` / `defaultConfig` 后，部分低频默认项只能由 loader 或后续扩展提供 -> 缓解方式：首版先固定默认值，等真实产品需求出现后再通过新 change 扩展。

## 迁移计划（Migration Plan）

1. 先实现 startup loader 和 `configRoot/hooks` 校验。
2. 再让产品 composition 默认从 `configRoot/hooks` 物化 `lifecycleHook`、definitions、bindings。
3. 保留测试装配里的 direct injection 入口，不作为产品路径。
4. 若目标部署暂时没有 `configRoot/hooks`，允许空目录/缺失目录启动为“无产品 hook”模式。

回滚策略：

- 回退本 change 后，产品路径恢复为 no-op / 手工 composition 注入；
- 由于本 change 不改变 runtime hook executor contract，回滚不涉及持久化 schema 迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：提炼 `configRoot/hooks`、startup loading、freeze snapshot、fail-closed 和 no-hot-reload 行为。
- `openspec/overview.md`：补充 hook 工程装载方式从手工组合演进到目录化 trusted source 的长期背景。
- `openspec/designs/architecture/configuration-boundary.md`：提炼 `configRoot/hooks` trusted root、路径边界和 startup validation。
- `openspec/designs/modules/agent-app.md`：提炼 hook directory loader 与 startup composition owner。
- `openspec/designs/modules/agent-runtime.md`：提炼 runtime 继续只消费冻结 snapshot 的 owner 边界。
- `openspec/designs/spec-to-design-map.md`：增加 `lifecycle-hook-execution` 到上述设计文档的导航。

## 待确认问题（Open Questions）

- 是否需要在首版 manifest 中支持多个 agent 的 binding authoring，还是只支持当前产品默认 agent；当前设计按现有 `AgentHookBinding[]` 全量承载，不再额外裁剪。
- packaging 阶段是否需要专门的 `hooks/` 产物复制步骤，或现有 TS build 输出已足够；该点在实现阶段通过 build/package tests 确认。
