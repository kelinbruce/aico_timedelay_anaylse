## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.32 管理插件开发诊断产物` | LOCAL 和 REMOTE 部署向已加载插件提供一致的开发诊断产物输出 | `plugin-developer-diagnostic-artifacts` | `FN-10.32 管理插件开发诊断产物` |

## `FN-10.32 管理插件开发诊断产物`

### 目标与规范依据

本设计闭合 proposal 中的部署一致性目标：部署模式只选择产品运行入口和网关能力；统一应用组合默认创建 developer diagnostic artifact writer，部署专用入口不感知也不启用该能力。

#### 本 Function 的目标 Requirements

canonical spec：`plugin-developer-diagnostic-artifacts`

- `MODIFIED`：`系统统一接收插件开发诊断记录`
- `MODIFIED`：`开发诊断记录使用独立的短期产物文件族`

### 当前实现

- `agent-plugin-sdk` 已定义稳定的 `DeveloperDiagnosticArtifactSink`、统一输入和稳定 drop reason；plugin loader 在宿主没有提供 writer 时注入 noop sink。
- `agent-app` 的同步和异步 composition 都只在 `deployment.mode === "LOCAL"` 时实例化调用方提供的 `developerDiagnosticArtifactWriterFactory`。
- 异步 LOCAL composition 在 factory 缺失时会动态加载 `agent-platform-gateway-local` 的 `createLocalDeveloperDiagnosticArtifactWriter`；REMOTE composition 不执行该默认装配。
- `agent-platform-gateway-local` 的 LOCAL 产品入口已经注入现有 writer factory；`agent-remote-deployment` 已依赖该 package，但两个 REMOTE 产品入口均未注入该 factory。
- 现有 writer 已拥有目标文件目录、NDJSON envelope、容量、轮转、压缩、保留、状态和失败隔离语义，相关 unit 与 LOCAL product-path E2E 已覆盖。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 官方 LOCAL 和 REMOTE 产品入口均接受已加载插件的合法记录 | `agent-app` 在 REMOTE 模式丢弃已提供的 factory，plugin loader 因此使用 noop sink | REMOTE 合法记录返回 `DROPPED/OUTPUT_UNAVAILABLE`，不产生物理记录 |
| 两种部署模式使用同一物理产物边界 | 物理 writer 位于 `agent-platform-gateway-local`，公共 app composition 不能直接依赖该 package | writer owner 与部署无关的公共装配目标不一致 |
| 部署模式不决定 sink 能力 | `agent-app` 在公共 composition 中读取 `deployment.mode` 决定 writer 创建 | 公共 Plugin host 能力与部署选择发生不必要耦合 |
| 新部署入口自动继承能力 | writer 由产品入口注入时，每个新增入口都必须重复接线 | 公共能力变化不能从唯一 composition owner 自动生效 |

### 修改方案

唯一实施路径如下：

1. `agent-log` 成为 developer diagnostic artifact 物理 writer 的唯一 owner。现有实现及其 fixed file policy 原样迁入该 package，并使用 deployment-neutral 名称 `createDeveloperDiagnosticArtifactWriter`。该 writer 创建独立 `agent-local-file-roll` handle，不与 operational writer 共享 destination、buffer、maintenance state 或 lifecycle。
2. `agent-app` 继续拥有统一 Plugin host composition。同步和异步 composition 使用调用方显式提供的 `developerDiagnosticArtifactWriterFactory`，否则默认使用 `agent-log` 的 `createDeveloperDiagnosticArtifactWriter`；两条路径都只传入冻结后的 `paths.logDirectory`，不读取 `deployment.mode`。
3. `developerDiagnosticArtifactWriterFactory` 只保留为测试和定制宿主的显式覆盖 seam，不再作为产品能力启用条件。通过 `agent-app` composition 启动的宿主即使未提供 factory，也获得默认可写 sink；直接绕过 app composition 调用 plugin loader 的隔离测试仍可验证 noop sink。
4. `agent-platform-gateway-local` 删除 developer diagnostic writer 实现、公开 export、testing export 和 LOCAL entrypoint/testing 注入；`agent-remote-deployment` 删除 writer import 与两个 REMOTE 入口的注入。部署入口不新增替代接线。
5. writer lifecycle、host service binding、plugin loader 输入校验、状态投影和关闭顺序保持现有路径。plugin、产品入口和请求路径均不得传入文件名、轮转、压缩或保留参数。

该方案不修改 `agent-contracts`、不新增配置项，也不让 `agent-app` 依赖 gateway implementation。`agent-app` 已依赖 `agent-log`，`agent-log` 已是 concrete file writer owner 并依赖 `agent-local-file-roll`，因此 owner 迁移不会形成新依赖方向或新增 file-roll production consumer。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；沿用 stable spec 的 `原始调测内容与主输出面隔离` | REMOTE 复用 manifest-bound identity、专属文件族和既有敏感内容隔离，不新增 public reader | REMOTE 记录不进入 operational、audit、metrics、timeline、stream 或 Web |
| 性能/容量 | 无新增黑盒质量目标；沿用 stable spec 的 `产物写入具有有界容量和生命周期` | 两种部署模式复用同一 writer、buffer 和 file-roll policy | 现有 4 MiB、8 MiB、100 MiB、daily rotation 与 3-day retention 不漂移 |
| 可靠性/恢复 | 无新增黑盒质量目标；沿用 stable spec 的 `产物失败不改变受保护操作` | sink/drop/lifecycle failure 继续由现有非抛出路径隔离 | REMOTE destination failure 不改变 hook 和请求结果 |
| 可维护性 | 两个 MODIFIED 功能性 Requirements | 一个公共 composition 默认值、一个 deployment-neutral writer、零产品入口接线 | 不出现 deployment 条件、第二套 writer 或入口重复注入 |
| 可测试性 | 两个 MODIFIED 功能性 Requirements | 保留 factory override 与 writer dependency seam | LOCAL/REMOTE 参数化 product-path、默认 factory 和显式 override |

## 验证策略（Verification Strategy）

- app composition tests 覆盖同步和异步路径在 LOCAL、REMOTE 下都默认创建 writer、消费显式 override，并确认不读取部署模式决定能力。
- LOCAL/REMOTE product entrypoint architecture tests 确认部署入口不导入、不注入 developer diagnostic writer。
- product-path E2E 以 LOCAL、REMOTE 参数矩阵执行同一已激活 `developer-hook-trace`，断言请求完成且相同目录中出现相同文件族和 envelope。
- `agent-log` writer unit tests 继续覆盖记录大小、缓冲区、轮转、压缩、保留、状态、destination failure 与 bounded close，防止 owner 迁移改变物理输出策略。
- architecture tests确认没有新增 `agent-local-file-roll` consumer、没有跨 package private import、没有把开发诊断 payload 投影到主输出面。
- 人工语义检视确认 deployment 选择不再进入公共 writer 实例化决策，且 `agent-contracts`、Plugin API、配置 schema 与日志位置均未变化。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/plugin-developer-diagnostic-artifacts/spec.md`：增加 `FN-10.32` 元数据，并合并两个 MODIFIED Requirements 的部署无关目标态。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.32-管理插件开发诊断产物.md`：新增 Function，记录输入、输出、结果和 LOCAL/REMOTE 支持范围。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.2-装配插件.md`：把 `FN-10.32` 纳入组成 Functions，并补充跨部署调测产物质量保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/agent-plugin-composition.md`：将 developer diagnostic host service 记录为 deployment-agnostic composition 能力。
- `openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-log.md`、`openspec/designs/modules/agent-platform-gateway-local.md`：分别同步公共默认 composition、唯一物理 writer 和 gateway-local 移除该职责；`agent-remote-deployment` 不承担本能力职责。
- `openspec/designs/adr/`：无，新目标复用既有 composition 与 file-roll 决策。
- `openspec/designs/spec-to-design-map.md`：新增 `plugin-developer-diagnostic-artifacts` 到 `FN-10.32`、相关 architecture/modules 和验证入口的唯一导航。

## 风险与取舍（Risks / Trade-offs）

- REMOTE 部署会在本机日志目录新增包含潜在敏感调测内容的文件；通过保持插件显式激活、既有专属文件族、访问控制和短期保留降低风险。
- `agent-log` 同时拥有 operational writer 和 developer diagnostic artifact writer，但两者必须保持独立 handle 和生命周期；architecture 与 writer tests 防止物理输出面合并。

## 待确认问题（Open Questions）

无。
