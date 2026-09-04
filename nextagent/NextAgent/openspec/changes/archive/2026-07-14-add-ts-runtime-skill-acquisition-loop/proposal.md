## 背景与问题（Why）

当前 SkillHub 支持的是查询期同步：`catalog.listAvailable` 触发远端 search/fetch，内容安装到 managed root 并写入 `remote-skill-content-index.json` 后，Skill 才能进入 catalog descriptor。该路径适合 Web 技能列表刷新和请求前能力可见性构建，但不能满足主执行 loop 中的黑盒目标：当模型执行过程中发现当前能力不足时，系统应能在同一个 request/run 内受控获取远端 Skill，并在后续模型 step 中使用它。

如果只把远端 Skill 当作已存在事实，或只把内容下载到 staging，而没有完成本地安装、manifest 校验、index 发布、catalog governance 和 capability snapshot 重建，则该 Skill 不能被 Skill Tool 稳定加载，也不能被审计和恢复路径解释。反过来，如果在一次模型调用中途静默改变 toolset，又会破坏模型调用边界、timeline 可追溯性、checkpoint 语义和安全审计。

因此本 change 需要把“动态生效”定义为同一 run 内的受控 acquisition：当前模型 step 通过预声明能力或 runtime-owned acquisition path 请求获取 Skill；系统完成 SkillHub search/fetch/install/index 后，在 step 边界重建 capability snapshot；下一次模型 step 看到并使用新 Skill。

## 变更范围（What Changes）

- 新增 runtime skill acquisition loop 行为：当当前 capability snapshot 无法满足任务时，主执行 loop 可以触发受控 Skill acquisition，并在同一 request/run 的下一模型 step 中生效。
- 明确 runtime-generated Skill 的本地即时使用边界：`skill-creator` 写入 `generated-skills/<skill-name>/` 后，不需要同步 SkillHub；它通过 execution-scope runtime-generated local discovery 在同一 run/scope 的下一 capability snapshot 中生效。
- 明确每次模型调用的 toolset/capability snapshot 必须冻结；禁止在一次 model invocation 中途静默新增 Skill 或改写已披露 toolset。
- 新增 acquisition 结果语义：成功 acquisition 不直接执行远端 payload，而是返回“需要重建 snapshot 并重新规划”的结构化结果。
- 复用现有 SkillHub source 安装治理链路：远端候选必须经过 search、fetch、staging、`SKILL.md` 校验、managed install、index 写入和 catalog governance 后，才能进入下一步 snapshot。
- runtime/agent-core 复用既有 step 边界、通用 capability timeline/checkpoint 和继续规划机制；agent-capability 拥有 acquisition 执行、安装、catalog 可见性和 Skill source loading/resource projection；remote gateway 继续只拥有具体服务协议和内容归一化。
- 不新增后台 TTL refresh、marketplace UI、跨 run 全局自动启用、基于本地 managed cache 绕过远端同步的 local-only SkillHub 模式。
- 不把 runtime-generated Skill 自动发布、复制或登记到 SkillHub managed install/index；SkillHub publish 属于后续显式发布 change。
- BREAKING：无。该 change 扩展主 loop 能力，不改变现有查询期同步的可用行为；但会把“运行中动态生效”的目标从隐式 listAvailable 副作用收敛到显式 acquisition/replan 流程。

## Capability 影响（Capabilities）

### 新增 Capability
- `runtime-skill-acquisition-loop`: 定义主执行 run 内受控获取远端 Skill、重建 capability snapshot 并在下一模型 step 生效的黑盒行为。

### 修改的 Capability
- `skillhub-source`: 明确 SkillHub source 可被 runtime acquisition 消费，但远端内容仍必须通过 managed install、index 和 catalog governance 后才可见；SkillHub source 不负责修改正在进行的 model invocation toolset。

## 影响范围（Impact）

- `agent-runtime`：复用通用 capability timeline/checkpoint，支持同一 run 在后续 step 继续执行；不新增 SkillHub 专属 snapshot rebuild 分支。
- `agent-core`：需要在 agent loop 中承载 acquisition/replan 协议，保证 acquisition 发生在模型 step 之间而不是模型调用中途。
- `agent-capability`：需要提供受控 acquisition 能力或 acquisition service，复用 SkillHub search/fetch/install/index 和 catalog governance。
- runtime-generated local Skill：继续写入 execution-scope `generated-skills/` root，由本地 discovery 读取；本 change 只明确它与 acquisition snapshot 边界的关系，不把它提升为 SkillHub source。
- `agent-platform-gateway-remote`：继续保持 SkillHub HTTP/服务格式 owner，不新增对 runtime/core 的反向依赖。
- `agent-contracts`/`agent-common`：可能需要新增安全结果枚举、timeline reason code 或 acquisition result contract；不得暴露 endpoint、token、managed path、raw package 或 provider-private loading key。
- 测试：需要新增 agent loop characterization/contract 测试、SkillHub fake gateway 黑盒测试、snapshot 冻结 negative case、安全泄露 negative case 和恢复/降级路径测试。
- 运维：该能力增加请求期远端获取和安装时延，首版必须有安全失败和可诊断 evidence，但不引入后台预热或异步刷新队列。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/runtime-skill-acquisition-loop/spec.md`：新增主 loop 内受控 acquisition、snapshot 重建、下一模型 step 生效和失败降级契约。
- `openspec/specs/skillhub-source/spec.md`：归档前补充 SkillHub source 被 runtime acquisition 消费时仍需经过 managed install/index/catalog governance 的长期行为。

长期背景：
- `openspec/overview.md`：补充运行中动态获取远端 Skill 的产品目标和“同一 run 内、下一 step 生效”的边界。

设计视图：
- `openspec/designs/architecture/runtime-capability-acquisition.md`：新增跨模块流程、snapshot 冻结、step 边界重入、timeline/checkpoint、安全和失败降级设计。
- `openspec/designs/modules/agent-runtime.md`：补充 runtime 复用通用 capability timeline/checkpoint 承载 acquisition evidence 的职责。
- `openspec/designs/modules/agent-core.md`：补充 agent loop 对 acquisition/replan 的职责。
- `openspec/designs/modules/agent-capability.md`：补充 acquisition service 与 SkillHub source/install/catalog governance 的职责。
- `openspec/designs/adr/<id>.md`：如实现阶段确认需要保留“模型调用内 toolset 不热变更”的长期取舍，可新增 ADR；否则无。
- `openspec/designs/spec-to-design-map.md`：补充 `runtime-skill-acquisition-loop` 和 `skillhub-source` 到新增架构/模块设计的导航。

验证入口：
- agent loop 黑盒测试：初始 snapshot 缺 Skill，运行中 acquisition 成功后下一模型 step 可见并执行新 Skill。
- runtime-generated Skill 测试：`skill-creator` 写入 `generated-skills/<skill-name>/SKILL.md` 后，同一 run/scope 的下一 capability resolution 可见，但不进入 SkillHub managed index。
- contract/architecture 测试：model invocation 期间 toolset 不变，acquisition 只能在 step 边界影响下一 snapshot。
- SkillHub fake gateway 测试：search/fetch/install/index/catalog descriptor/body loading 全链路通过。
- negative case：远端不可用、scope mismatch、manifest invalid、安装失败均安全降级且不泄露 endpoint、credential、managed path、raw package。
