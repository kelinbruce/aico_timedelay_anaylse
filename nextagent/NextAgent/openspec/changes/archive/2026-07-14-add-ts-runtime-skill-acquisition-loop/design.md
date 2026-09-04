## 背景和现状（Context）

当前代码已有 SkillHub 查询期同步链路：`SkillHubDiscovery.search()` 在 `CapabilityCatalog.listAvailable()` 路径中调用远端 `listCandidates` 和 `fetchContent`，将内容放入 `managedInstallRoot/staging`，通过 `RemoteSkillContentInstaller` 校验 `SKILL.md` 并发布到 `managedInstallRoot/installed/<installId>`，再写入 `remote-skill-content-index.json`。随后 catalog 从 index 读取 installed fact，解析 manifest，返回 governed descriptor；Skill Tool body loading 根据 `sourceIdentity/frontmatterHash` 从 index 加载 body，并通过同一个 SkillHub provider 的 `listSkillResources` / `readSkillResource` 投影 Skill 资源。

该链路的 owner 边界是清楚的：SkillHub HTTP path、wire DTO、credential resolution 和 archive/materialization 属于 `agent-platform-gateway-remote` adapter；staged folder intake、manifest validation、managed install、index 和 catalog governance 属于 `agent-capability`；`agent-runtime`/`agent-core` 当前只消费 catalog view。

现状缺口是：主执行 loop 中没有显式 acquisition/replan 机制。模型 step 已经开始后，当前 toolset/capability snapshot 不会中途变化；如果运行中发现缺少 Skill，只能依赖用户或外部请求触发下一次 catalog 查询，不能在同一 request/run 内自动 acquire 并继续执行。

另一个相关现状是 runtime-generated Skill：内置 `skill-creator` 指导模型把新 Skill 写到 execution-scope `generated-skills/<skill-name>/SKILL.md`。该路径由 runtime-generated local discovery 读取，目标是当前 run/scope 内快速使用，不经过 SkillHub managed install/index，也不代表组织级远端 Skill 发布。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在同一 request/run 内支持运行中获取远端 Skill，并在下一模型 step 生效。
- 保持每次 model invocation 的 capability snapshot 冻结，新增 Skill 只能在 step 边界后进入下一 snapshot。
- 复用 SkillHub source 的远端访问、managed install、index 和 catalog governance，不引入绕过安装治理的执行路径。
- 保留 runtime-generated Skill 的本地即时使用路径：`skill-creator -> generated-skills/ -> 下一 capability snapshot`，并明确它不自动同步到 SkillHub。
- 复用通用 capability timeline/checkpoint，为 acquisition result 提供安全 execution evidence。
- acquisition 失败时安全降级，允许模型继续规划、请求用户补充或结束，但不得暴露 provider-private facts。

**非目标：**
- 不支持一次 model invocation 中途动态新增 tool 并让同一 invocation 继续调用。
- 不新增后台 TTL refresh、全局预热、marketplace UI 或多 Agent 运营管理界面。
- 不把本地 managed cache 作为绕过远端同步和 Agent source authorization 的独立 SkillHub source。
- 不把 `generated-skills/` 自动发布、复制或登记到 SkillHub；若业务需要组织级发布，后续应新增显式 publish change。
- 不让 `agent-runtime` 或 `agent-core` 直接访问 SkillHub endpoint、archive bytes、staging path 或 managed install layout。
- 不把 acquisition 做成任意动态 tool/plugin 创建框架；首版只覆盖 SkillHub-backed Skill acquisition。

## 设计决策（Decisions）

### D1 唯一执行路径：SkillHub acquisition capability + step 边界重入

首版由配置的 SkillHub provider 暴露一个预声明 acquisition capability，工作名为 `acquire_skill`。该 capability 只在 Agent 绑定/授权对应 SkillHub provider 时进入 capability snapshot；它本身只表达“请求获取缺失 Skill”，不直接代表远端 Skill，也不属于通用 builtin toolset。

执行路径固定为：

```text
model step N
-> model calls acquire_skill with safe query / requested capability facts
-> agent-core tool loop executes acquire_skill
-> agent-capability acquisition service calls SkillHub source sync/install/governance
-> acquisition result returns ACQUIRED_REQUIRES_REPLAN or safe failure
-> agent-core stops current planning turn after capability result is appended
-> generic capability result evidence records the acquisition outcome
-> agent-core starts model step N+1 with rebuilt capability snapshot
-> model sees acquired Skill descriptor and can call Skill Tool
```

放弃方案：
- 放弃“model invocation 中途扩展 toolset”：该方案会破坏模型调用边界、审计、replay 和 prompt/tool disclosure 一致性。
- 放弃“让 catalog.listAvailable 隐式承担 loop acquisition”：该方案把副作用藏在查询里，无法表达 acquisition intent 和失败降级。
- 放弃“runtime 直接调用 SkillHub gateway”：该方案越过 `agent-capability` 的安装治理和 catalog owner。

### D2 acquisition service 归 `agent-capability`

`agent-capability` 新增 `SkillAcquisitionService`，只暴露 capability/core 可消费的 provider-neutral acquisition 输入和安全结果。它内部复用 SkillHub source：

- 输入：trusted owner scope、trusted agent scope、provider id、可选 requested capability id、用户/模型提供的安全搜索文本、当前 snapshot id。
- 输出：`ACQUIRED_REQUIRES_REPLAN`、`NOT_FOUND`、`UNAVAILABLE`、`REJECTED`、`INSTALL_FAILED`、`UNAUTHORIZED` 等安全结果。
- 成功输出只包含 safe descriptor summary、provider id、skill id 和 content consistency summary，不包含路径、endpoint、raw payload 或 private loading key。

该 service 不修改 runtime 状态，不提交 terminal，不直接重启模型 step。

### D3 agent-core 拥有 acquisition/replan 协议

`agent-core` 在 tool loop 中识别 acquisition capability 的安全结果。若结果是 `ACQUIRED_REQUIRES_REPLAN`，core 不把 acquired Skill 直接注入当前 toolset，而是结束当前 tool result append 后进入下一 planning/model round。下一 round 的 context assembly 和 model request construction 必须基于 runtime/core 提供的 rebuilt capability snapshot。

`agent-core` 负责保证：
- 当前 invocation toolset 不变。
- acquisition result 进入模型可见上下文时只包含安全摘要。
- acquisition 成功后下一 round 重新查询 catalog。
- acquisition 失败按普通 capability failure/degraded result 进入已有规划路径。

### D4 runtime 复用通用 capability execution evidence

`agent-runtime` 继续拥有 request lifecycle、checkpoint、timeline 和 terminal commit。首版不新增 SkillHub/acquisition 专属 timeline event；acquisition 作为普通 capability invocation 进入既有 `CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED` 和 capability result message 路径。通用 capability evidence 只记录 safe provider id、provider kind、safe skill id、outcome code、step id、run id 关联，不记录 endpoint、credential、managed path、staging path、raw package、raw provider response 或 private loading key。

首版 snapshot 不需要新增 gateway durable table，也不需要专属 rebuild event。新 Skill 的动态可见性来自 SkillHub provider 写入 managed install/index 后，下一 model step 重新通过 catalog/context assembly 解析 capability；managed install/index 是 SkillHub source 的 provider-private durable fact。

### D5 SkillHub source 只负责 governed content lifecycle

SkillHub source 的目标态不变：远端内容必须经过 trusted scope、gateway access、staged folder、manifest validation、managed install、index 和 catalog governance。新增点只是它可以被 acquisition service 调用，而不是只能被 `catalog.listAvailable` 调用。具体 Skill 加载时，body 和 resource projection 都必须回到 SkillHub provider 的 SkillSourceDiscovery 能力：`loadCanonicalBodyView` 从 index 绑定的 manifest 加载 body，`listSkillResources` / `readSkillResource` 从同一已发布 installed folder 枚举和读取 `references/`、`scripts/`、`assets/`、`api/` 等受控资源。

为避免双路径漂移，SkillHub source 的 install/governance 代码必须是 acquisition 和 catalog refresh 共用的一条实现路径；不能新增一套 acquisition 专用安装器、index 文件、descriptor projection 或 resource projection。

### D6 runtime-generated Skill 保持本地 source，不进入 SkillHub managed index

`skill-creator` 生成的 Skill 继续写入 execution-scope `generated-skills/<skill-name>/`。这是本地运行期 source，由 runtime-generated local discovery 扫描并形成 descriptor。它与 SkillHub source 的区别必须保持：

- 不写入 `skillhub-managed/staging`、`skillhub-managed/installed` 或 `remote-skill-content-index.json`。
- 不调用 SkillHub `/skills/search` 或 `/skills/package`。
- 不被描述为全局已安装或远端已发布 Skill。
- 在同一 run/scope 内可在下一 capability resolution / 下一 model step 生效。
- 仍受 model invocation snapshot freeze 约束，不能插入已经开始的 model invocation toolset。

如果后续需要把 generated Skill 发布到 SkillHub，必须新增显式 `publish_generated_skill` / SkillHub publish capability：先校验本地 generated Skill，再调用远端 publish/register gateway，最后仍通过 SkillHub search/fetch/install/index 回到 governed catalog。该发布流程不是本 change 的实施范围。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | acquisition 输入中的 owner/agent scope 只能来自 accepted run 和 assembly；模型只能提供搜索意图或 requested capability id，不能覆盖 tenant、subject、agent、provider endpoint 或 managed root。runtime-generated Skill 只能写入 governed `generated-skills/` root，不能伪装成 SkillHub managed content。所有失败结果和 timeline event 必须脱敏。 | acquisition negative tests；generated skill path tests；safe serialization assertions；architecture boundary tests |
| 性能/容量 | 首版 acquisition 是按需同步操作，只在模型显式调用 `acquire_skill` 时发生。每次 acquisition 使用现有 SkillHub size/file budget，不引入后台扫描。需要防止同一 run 中重复 acquisition 同一 provider/skill 造成无界远端调用。 | focused unit tests for dedupe/idempotency；integration test with bounded fake gateway calls |
| 可靠性/恢复 | installed/index 发布复用 SkillHub provider-private idempotent install path。runtime 重启/恢复时不得执行 staging 内容；已发布内容通过 index 重新进入 catalog，未发布内容需要重新 acquire。terminal commit 不依赖 acquisition 成功。 | runtime resume characterization；installer idempotency tests；failure path tests |
| 可维护性 | runtime/core/capability/gateway owner 单一：core 管 replan，runtime 管 evidence/snapshot lifecycle，capability 管 acquisition/install/catalog，gateway 管 remote service。 | dependency-cruiser/architecture tests；code review 检查 private import 和 owner 越界 |
| 可测试性 | acquisition service 使用 fake SkillHub access port；agent loop 使用 deterministic model fixture 先调用 acquire，再在下一 round 调用 Skill Tool。 | agent-kernel integration tests；agent-capability unit tests；contract tests |
| 审计/可追溯性 | 通用 capability timeline/checkpoint evidence 记录 acquisition attempt 和结果，但只包含低敏安全字段。 | timeline assertions；safe log/stream serialization tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 同一 run 内 acquire 后下一模型 step 可见新 Skill | 2.1, 3.1, 4.1 | `tests/agent-kernel/runtime-skill-acquisition-loop.test.ts` |
| model invocation toolset 冻结，新增 Skill 不能中途进入当前 invocation | 3.2, 4.2 | agent loop characterization test |
| SkillHub acquisition 必须经过 install/index/catalog governance，具体 Skill 资源投影由 SkillHub provider 提供 | 2.2, 4.3 | `packages/agent-capability/tests/skill-acquisition.test.ts`; `packages/agent-capability/tests/skillhub-source.test.ts` |
| runtime-generated Skill 不进入 SkillHub managed index，但下一 step 可见 | 2.5, 4.5, 4.6 | `packages/agent-capability/tests/runtime-generated-skill-activation.test.ts`; agent loop generated skill test |
| acquisition 失败安全降级且不泄露 provider-private facts | 2.3, 4.4 | safe serialization negative tests |
| runtime 记录 acquisition execution evidence | 3.3, 4.5 | generic capability timeline/checkpoint assertions |
| 模块边界不越界 | 5.1 | architecture tests / dependency-cruiser |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/runtime-skill-acquisition-loop/spec.md` 主承载同一 run 内 acquisition、snapshot 冻结、step 边界重入和安全失败行为；`openspec/specs/skillhub-source/spec.md` 主承载 SkillHub source 在 acquisition 消费下仍必须走 governed install 的行为。
- 架构和跨模块设计：`openspec/designs/architecture/runtime-capability-acquisition.md` 主承载跨模块流程、snapshot 生命周期、timeline/checkpoint、安全边界和恢复语义。
- 模块设计：`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-capability.md` 分别承载模块职责更新；`agent-capability` 还承载 runtime-generated local discovery 与 SkillHub source 的边界。
- ADR：如实现阶段需要长期记录“禁止 model invocation 中途 toolset 热变更”的取舍，归档前新增 ADR；否则该决策由 architecture 文档承载。
- 导航：`openspec/designs/spec-to-design-map.md` 记录新增 spec 到 architecture/modules/验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] acquisition 增加单次 run 延迟。 -> 首版只在模型显式调用 acquisition capability 时触发，并复用现有 SkillHub budget。
- [风险] acquisition 与 catalog refresh 形成两套安装路径。 -> 强制共用 SkillHub source install/index/governance 实现，不新增 acquisition-only installer。
- [风险] runtime-generated Skill 被误认为 SkillHub managed Skill。 -> 在 spec、tests 和 safe output 中明确 generated Skill 是 execution-scope local source，不自动写入 SkillHub managed index。
- [风险] 模型反复 acquire 同一 Skill。 -> 首版在 request-local acquisition service/core 协议中记录同一 provider/query/skill 的尝试结果，避免同一 run 内无限重复。
- [风险] snapshot rebuild 与 terminal commit 竞争。 -> 不新增专属 snapshot rebuild 分支；acquisition 成功只通过普通 capability result/contextPatch 影响下一 planning round。
- [风险] safe event 泄露 provider-private facts。 -> timeline/log/stream serialization 增加 negative assertions。

## 迁移计划（Migration Plan）

无数据迁移。现有查询期 SkillHub 同步路径保持可用。新增 acquisition capability 默认只在 Agent assembly/source policy 允许 SkillHub provider 时可用；如果没有配置 SkillHub provider 或 remote adapter，acquisition 返回安全不可用结果。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/runtime-skill-acquisition-loop/spec.md`：归档新增 capability 行为契约。
- `openspec/specs/skillhub-source/spec.md`：补充 acquisition consumption 下的 governed install/index/catalog 行为。
- `openspec/overview.md`：补充动态获取远端 Skill 的产品目标和同一 run 内下一 step 生效边界。
- `openspec/designs/architecture/runtime-capability-acquisition.md`：提炼跨模块流程、snapshot 冻结、step 边界重入、timeline/checkpoint、恢复和安全边界。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 复用通用 capability evidence 承载 acquisition 结果的职责。
- `openspec/designs/modules/agent-core.md`：补充 core 对 acquisition/replan 的职责。
- `openspec/designs/modules/agent-capability.md`：补充 acquisition service、SkillHub source 复用、catalog governance、runtime-generated local discovery 与 SkillHub managed source 的边界。
- `openspec/designs/spec-to-design-map.md`：新增导航和验证入口。

## 待确认问题（Open Questions）

无。首版 scope 已收敛为 SkillHub-backed Skill acquisition 和 runtime-generated local Skill 下一 step 生效，不支持当前 model invocation 中途 toolset 热变更；generated Skill 发布到 SkillHub 属于后续显式 publish change。
