## 背景和现状（Context）

`agent-app` 是唯一 composition root，稳定规格已经把它限定为配置加载、依赖注入和服务启动三个职责。当前代码已有 `assembly-composition.ts`、`gateway-composition.ts`、`capability-composition.ts`、`request-runtime-composition.ts` 等职责入口，也已有禁止 config 反向依赖 composition、普通 composition module 反向依赖 `create-app.ts`、以及不同模块 composition entry 相互 value-import 的架构规则。

当前 gap 不在于缺少文件，而在于顶层和模块内部装配没有分层：

- `create-app.ts` 同时承载 public factory、同步/异步准备、配置解析、失败包装和约 450 行 `composeBoundApp()`；顶层无法连续展示完整 app composition 路径。
- 四个 public factory 分别处理部分 config、model、plugin、operational log、metrics、gateway binding、upload config 和 cleanup，完整 app 构造语义散落。
- `with-frontend` 当前在 core 返回后才解析 hosting manifest、校验版本并注册静态托管；该后置注册不在 app-local failure cleanup 内，失败时调用方拿不到已构造 app 进行关闭。
- `create-local-configured-app.ts` 复制完整 options，并在 host callback 内直接构造 local auth、注册 Web channel/plugin 和捕获 trusted extension；它虽由 channel stage 调用，但没有固定窄 host profile/input，仍是一条与目标 prepared-input 边界竞争的装配路径。
- `local-runtime-package/index.ts` 同时执行 package preflight、重复 config sample read/validation、Agent definition merge、operational writer/trace/model/gateway/workbench 构造、backend/frontend factory 选择、composition failure cleanup、`app.start()` 和运行证据写入；package host 事实与 app construction 事实没有分层，且 injected operational writer 的 host cleanup 与 app lifecycle cleanup ownership 重叠。
- `create-test-composition.ts` 不是普通两字段 helper：它解释 37 个顶层 test inputs，构造 isolated config/default Agent、deterministic model、local gateway/cron/sandbox/RAG defaults、observability capture 和 test lifecycle。它最终复用 product factory，但当前 change 没有完整保存这条 test-host preparation contract。
- `local-runtime-bindings.ts` 同时提供 local gateway factories和 workbench contribution；它应保留为 host adapter，而不是迁入 channel business owner，但当前设计没有固定其 contribution、failure degradation 和 lifecycle 边界。
- backend-only、local-configured-auth 和 with-frontend executable main 的 launcher 边界没有统一定义；其中 with-frontend main 仍独立构造一套 local gateway defaults。
- `composeBoundApp()` 除调用模块入口外，仍直接创建 risk policy、workspace resolver、model profile registry、observed sandbox、memory diagnostics/provider、cron port、background callbacks、upload cleanup job 和 lifecycle model wrapper。
- workflow、session、context、health、prompt 等文件已经形成清晰的权威入口；对这些模块继续做形态重构不会提高顶层可读性，反而扩大回归面。
- 现有 deferred holder 已覆盖 lifecycle/workflow/runtime 的真实循环，但 background timeline 仍通过独立 mutable 回填。
- 当前 architecture guard 能阻止明显业务逻辑回流，但不能证明配置只加载一次、完整 options 不进入共享 core、模块只有一个权威装配入口或同步/异步入口复用同一 core。
- cron 当前由 root 在启动贡献阶段调用一个只覆盖 REMOTE callback credential/registration 的 `validateCronRuntimeComposition(...)`，随后 runtime entry 在真正创建 verifier/注册 route 时又检查同一依赖；这既把 runtime prerequisite 伪装成 readiness，也让前置阶段知道 server callback 细节，而 LOCAL 的 gateway/scheduler prerequisite 仍留在后续消费点，形成不对称半套校验路径。

本 change 的主要写入 owner 是 `packages/agent-app`。它不改变 owner package 业务实现、`agent-contracts`、配置 schema、持久化或 request lifecycle。实施必须与修改 `create-app.ts` 或相同 composition entry 的 active change 串行集成。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 只阅读 `create-app.ts` 中一条短而连续的 pipeline，即可识别配置冻结点、八个宏观装配层级、真实循环绑定、失败资源交接和最终 lifecycle。
- 模块内部装配事实归入该模块唯一权威 composition entry；顶层只展示模块调用和 typed handoff。
- 每个模块的权威 entry 内部也必须形成一条连续、唯一且可复核的装配流程，明确输入、核心顺序、输出消费者以及 optional/failure/cleanup 语义；不能只完成物理归位。
- 一次启动只有一个 `DefaultSystemConfig`、一个共享装配 core 和一套 app lifecycle；全部 public/product/test/package facade 最终只进入一个 app-private sync runner 或一个 app-private async runner，同步/异步只在是否允许 await 与 rollback 等待策略上分叉。
- 完整 public options 只在入口 preparation 出现一次；共享 core 和模块 entry 只接收字段明确的窄 typed input。
- 以当前代码为基线按黑盒装配职责做完整归位：root、module、product host、package host、test host 和 launcher 中所有真实 wiring 都进入唯一 surface map；已经内聚且不拥有装配决策的 leaf implementation 保持不动。
- 保持外部功能不变，并修复装配失败时尚未交接资源缺少统一 cleanup 的已知可靠性缺口。

**非目标：**

- 不改变 public Web API、runtime command、stream event、request lifecycle、canonical timeline、gateway schema、持久化事实或任何 `agent-contracts` export。
- 不改变配置格式、配置优先级、secret resolution、Agent package、plugin manifest、provider selection 或 deployment profile 语义。
- 不迁移 memory、workflow、context、model、capability、runtime、session、gateway、channel 或 observability 的业务 ownership。
- 不删除或废弃同步入口，不新增 public builder/container，也不创建第二套测试装配路径。sync API 的跨包调用面迁移属于独立破坏性 change。
- 不引入 DI framework、自动拓扑排序、字符串 token、反射注册、全局 singleton、可变 service locator、第二套 config DTO 或新的 workspace package。
- 不以 phase 数量、文件行数或机械的一模块一文件作为成功标准；复杂模块可使用私有 helper 文件，但只能有一个权威导出装配路径。
- 不把 package manifest/evidence/run-state、test-only default construction 或 workbench-specific read projection 塞进 product shared core；它们保留各自 host owner，但必须通过固定 typed handoff 接入唯一 runner/core。
- 不为了统一命名批量重命名现有 helper；prompt、workflow、session、context、health 已满足 4.1 目标流程时不重写，否则只做恢复流程连续性所需的模块内最小调整。
- 不调整 `NextAgentApp.start()` 内 scheduled maintenance、cron、memory worker、capability ready validation、channel ready、RAG build、runtime recovery 和 listen 的既有顺序，也不在本 change 内引入 start-phase transactional rollback。八层 pipeline 只覆盖 `NextAgentApp` 构造和 lifecycle ownership handoff；start failure 的自动 rollback/所有 launcher 一致 close-on-failure 需要独立 reliability change。

## 设计决策（Decisions）

### 1. `create-app.ts` 保留唯一顶层入口，public options 在 preparation 后消失

`packages/agent-app/src/composition/create-app.ts` 继续承载 public factories 和唯一 `composeNextAgentApp(...)` core，不新增平行 builder 或 stage orchestrator。

完整 public flow 固定为：

```text
Local / Remote / Test host facade projects trusted product input
  -> choose exactly one app-private execution runner

sync: runProductCompositionSync(...)
async: runProductCompositionAsync(...)
  -> runner creates one CompositionFailureScope
  -> product options
  -> prepare trusted identity inputs
  -> loadAppCompositionConfiguration
  -> load/validate/freeze plugin snapshot（sync 或 async）
  -> prepare product-host defaults and remaining startup contributions（sync 或 async）
  -> PreparedCompositionInputs
  -> composeNextAgentApp(PreparedCompositionInputs, failureScope)
  -> ProductCompositionOutcome { app, hostFacts } returned to runner
  -> async runner only, when ProductHostCompositionInput is present:
       await completeWithFrontendProductComposition(app, hostInput)
  -> runner commits scope; public facade projects app, package host may consume hostFacts

on error:
  sync runner -> failureScope.rollbackSync() -> throw original safe failure
  async runner -> await failureScope.rollbackAsync() -> throw original safe failure
```

`createNextAgentApp(...)`、`createNextAgentAppAsync(...)`、`createComposedApp(...)` 和 `createComposedAppAsync(...)` 是现有 agent-app public factory facade，不是四个 runner。这四个 facade 及 agent-app 内的 local-auth、with-frontend、testing facade 只做固定 projection，并直接调用 `runProductCompositionSync(...)` 或 `runProductCompositionAsync(...)`。跨包 local/remote gateway adapter 只调用一个 agent-app public/testing facade，不得 import app-private runner。facade 之间 MAY 复用纯 projection helper，但 MUST NOT 通过 agent-app public-facade-to-public-facade delegation 引入嵌套 runner、第二个 scope 或重复 preparation。一次调用链恰好抵达一个 execution runner。

`prepareCompositionInputsSync(...)` / `prepareCompositionInputsAsync(...)` 是唯一允许逐字段解释完整 `CreateNextAgentAppOptions` 或 `CreateComposedAppOptions` 的内部入口。public/host/test facade MAY接收其公开options，两个execution runner MAY接收同一对象引用以建立scope并原样传给对应preparation，但facade/runner MUST NOT读取未归其projection的production field、rest-spread/copy或自行normalize。preparation 分别完成同步可用或必须 await 的 I/O；不得通过 `{ ...options }` 把完整 options 复制给 shared core。只有这两个 product preparation 可以创建 `PreparedCompositionInputs`；host 不得直接构造该 root state。

sync 和 async 是 runner 的执行能力差异，不是两套装配语义：

- `runProductCompositionSync(...)` 只支持能被同步完整准备的输入，只调用 sync loader/preload，不允许 await，不得静默跳过、fallback 或降级 async-only plugin materialization、startup preload 或 host finalization。如果入口类型无法在调用前排除该输入，则必须进入既有 safe composition failure。
- `runProductCompositionAsync(...)` 是完整产品能力的 canonical path，支持 async plugin/preload/host preparation，且是唯一可以在 core 后执行具体 with-frontend typed finalization 的 runner。
- 两个 runner 产出同形 prepared input，调用同一 core、模块顺序和 lifecycle；差异只是 preparation/finalization 是否允许 await，以及失败时 `rollbackSync()` 的 best-effort trigger 与 `rollbackAsync()` 的 awaited settle。
- 本 change 保留全部既有 public sync factory 及其黑盒结果，但把内部语义收敛到唯一 sync runner。删除或废弃 sync API 需要独立 change 盘点 public exports、local/remote/testing facade 和存量调用方，不在本 change 中执行。

product selector 只包含两个正交维度：`channelAuthProfile: DEFAULT_WEB | LOCAL_CONFIGURED_AUTH` 与 `frontendHostingProfile: NONE | WITH_FRONTEND`。local/remote package kind、local gateway defaults 和 test host kind 不是 profile，不进入 channel switch。backend-only 使用 `DEFAULT_WEB + NONE`；local configured auth 使用 `LOCAL_CONFIGURED_AUTH + NONE`；with-frontend 只把 frontend 维度设为 `WITH_FRONTEND`，channel auth 仍由所选产品入口明确给出。production preparation 是唯一逐字段解释 agent-app production options、解析 local gateway/workbench defaults并产出 `channelInput` 的位置。

local configured auth dependency graph 中的 app-private `local-configured-auth-channel-contribution.ts` 是唯一允许静态 import `@nextagent/agent-channel-web-auth-local` 的 app 文件。它实现不含 options/config/server 的字段固定 `LocalConfiguredAuthChannelContribution` factory；`create-local-configured-app.ts`只创建/选择该contribution，并把原options引用、`LOCAL_CONFIGURED_AUTH`和contribution交给同一个sync runner。preparation 从 options 逐字段取得 trusted extension/protected prefixes；channel entry 调用 contribution，contribution 此时才校验 frozen local-auth config、构造 auth/plugin并在 protected scope注册 Web/extension。shared `channel-composition.ts`、generic core、backend-only 与 with-frontend 不 import local-auth package；facade 不复制 options、不捕获宽 options bag，也不直接调用 server registration。

with-frontend facade 只读取 `productVersion`、manifest resolver、index scripts 三个 host-specific 字段和 `trustedLocalWebExtensionRegistration === undefined` 派生的 `useDefaultWorkbenchScripts`，把原 options 对象、`frontendHostingProfile: WITH_FRONTEND` 和字段固定的 `ProductHostCompositionInput` 交给唯一 app-private async runner。

async runner 先创建唯一 failure scope，再调用 async preparation/shared core。core 返回的 `ProductCompositionOutcome.app` 尚未公开且 scope 尚未 commit；仅当传入具体 `ProductHostCompositionInput` 时，runner 随后调用唯一 typed `completeWithFrontendProductComposition(...)`，按既有顺序解析 manifest、校验 frontend/product version，根据 `useDefaultWorkbenchScripts` 选择 scripts，并 `await server.register(frontendHostingPlugin, ...)`，成功后才 commit 和返回 outcome。该 host input/finalizer 不从 package public export 暴露，也不定义第三个 runner、第二套配置、scope 或模块顺序。独立 `createWithFrontendCandidateEvidence(...)` 查询保持 manifest/version evidence 行为，不进入 app composition scope。除这个字段固定、仅由 async runner 在 commit 前调用的 finalizer 外，任何产品宿主都不得在 shared core 返回后调用 `server.register(...)`；commit 或 public return 后一律禁止补产品 route/plugin registration。

local/remote runtime package、remote deployment 和 test host 在调用 factory 前可以创建 host-specific、非 app-owned 的 adapter input或测试事实，但 app preparation 对 injected value 保持优先且不得重复创建。任何按现有成功 `NextAgentApp.close()` 契约由 app 关闭的 injected handle，都在 execution runner 接受调用时转为 app-owned，并必须立即登记到同一 failure scope；宿主只负责 runner 接受前的本地构造失败，不得在 runner 已接受后再次关闭。model service、provider definition、metrics registry、test capture sink 和无 close contract 的 contribution 保持 caller-owned。具体 ownership 见决策 6。

host preparation 与 runner 执行能力是正交的，不形成三类 host × 两类 factory 的六套语义。三类场景都先投影为标准 product options/窄 contributions，再由一个 execution runner 调用唯一 product preparation 形成 prepared state：

| 场景 | host 额外拥有的受信任输入 | facade/host preparation 责任 | shared core 可见事实 |
|---|---|---|---|
| Local | local package manifest/layout、一次 frozen package config、packaged Agent、local gateway/workbench/local-auth contributions、optional writer/trace、start/evidence facts | package preflight 只产出一次 config fact 并构造窄 contributions；writer/trace 在 runner 接受后转为 app-owned；host 选择 sync-compatible 或 canonical async facade | `configuration`、`gatewayInput`、`channelInput`、`observability`、`assemblyInput`；不知道 local package |
| Remote | remote gateway/model/RAG/sandbox contribution 及 deployment/package/evidence facts | remote host 构造窄 remote contribution 并调用 public facade；config 仍走唯一 configuration entry，除非注入已受信任 frozen config | frozen selection 与 remote gateway contributions；remote cron callback 只在 runtime/channel 层按 selection 注册 |
| Test | 全部37个 test options、isolated config/default Agent、deterministic model、gateway/cron defaults、observability capture、lifecycle overrides | test host 逐字段保持 override/default，创建隔离资源，然后投影为普通 production options/窄 contributions 并调用同一 runner | 与产品同形的 model/gateway/channel/observability/lifecycle 输入；不知道 test mode |

边界规则固定为：

- host 决定“提供什么受信任 contribution/default”；
- frozen config 决定“启用什么 capability 或 deployment adapter”；
- product preparation 决定“如何把已选输入准备为同形 root state”；
- shared core 只按窄 prepared input 装配，`PreparedCompositionInputs`、`composeNextAgentApp(...)` 及 module entry MUST NOT 包含或检查 `hostKind`、`testMode` 或 `LOCAL | REMOTE | TEST` discriminator。现有 cron deployment selection、channel auth profile 和 frontend hosting profile 是业务/产品选择事实，不是 host-kind 分支。

两条 preparation 路径产生同形、只读、app-private 的 `PreparedCompositionInputs`。该类型只有下列字段组，字段组本身也是固定 typed projection：

- `identity`: `credentialResolver`、trusted `identity`、monotonic `clock`；
- `configuration`: 唯一 `systemConfig`、capability reference validation port、resolved gateway sandbox runtime input；
- `observability`: final metrics registry、optional metrics infrastructure/operational writer/runtime logger binding/trace projector、logger factories；
- `plugin`: frozen plugin registry snapshot/contributions；
- `attachment`: final upload config；
- `model`: product model service 和 provider kind；
- `assemblyInput`: optional injected Agent definition；
- `gatewayInput`: gateway providers、sandbox/scheduled-maintenance/RAG factories、optional injected bindings/sandbox/CLIP runner；
- `capabilityRuntimeInput`: optional risk evaluator、registered adapter types、SkillHub/background factories、cron id factory；
- `lifecycleWorkflowInput`: injected lifecycle hooks/executor/definitions 和 workflow factory/mode/remote gateway；
- `channelInput`: channel auth profile、optional local-auth contribution、Web/local extension/task registrations 及 protected prefixes；
- `cronInput`: 从 frozen config 一次投影的 app-private `deploymentSelection: DISABLED | LOCAL | REMOTE`，其中 `DISABLED` 规范化现有未启用/缺省状态而不是新增 config token；其余字段是 cron task gateway/scheduler/callback registration 与 callback credential reference。selection 只表达部署模型，不携带 readiness 结论。

`PreparedCompositionInputs` 不含 `options`、`trusted options`、`unknown` map、字符串 key、setter、lookup、动态注册、`hostKind`、`testMode` 或等价 host discriminator。除 public/host/test facade signature、恰好两个execution runner与两个 preparation entry 外，agent-app 内其他内部函数不得接收完整 public options；只有preparation可以逐字段解释production fields，runner只原样传递同一options引用。只有 async runner 可额外接收字段固定、app-private 的 `ProductHostCompositionInput`，且该 input 只能由该 runner 在 commit 前传给唯一 with-frontend finalizer，不进入 prepared root state 或模块 entry。`composeNextAgentApp(...)` 是唯一允许整体接收 `PreparedCompositionInputs` 的 shared root core；它不得复制、重建或整体转交该对象，只能逐字段或逐窄字段组传给对应模块。任一模块 entry 的参数类型不得引用 `CreateNextAgentAppOptions`、`CreateComposedAppOptions` 或 `PreparedCompositionInputs`。不得新增与 `PreparedCompositionInputs` 同形的 `ComposeNextAgentAppInput`、layer aggregate 或第二个 root state type。

shared core 的 package-private 返回类型固定为：

```text
ProductCompositionOutcome {
  app: NextAgentApp,
  hostFacts: {
    gatewayReadiness: {
      selectedProviderId,
      deploymentMode,
      gatewaySnapshotRef,
      bindingsReadinessRef
    },
    reportAppStartFailure(error: unknown): void
  }
}
```

`hostFacts` 是借用型、只读且与 `app` 同生命周期的安全 handoff：不得含 credential、路径、raw provider error、完整 config、writer/projector/bindings 等可关闭 handle，也不得提供 cleanup。public factory、local-auth/with-frontend facade 和 external adapter 只返回 `outcome.app`；只有 local runtime package 的 app-private start path可以消费 `gatewayReadiness` 与 reporter，以保持 startup proof 和 start-failure operational diagnostic。该 outcome 不扩大 `NextAgentApp`、package public options 或 `agent-contracts`。

顶层 core 允许出现模块 `load*`/`prepare*`/`compose*`/`validate*` 调用、typed result 交接、root-only deferred/failure-scope registration、binding 和最终返回。failure scope 恰好由当次唯一 app-private sync 或 async runner 创建并作为单独的 root control object 传入，不属于 prepared state；public facade、preparation 和 core 不创建竞争 scope，core 不捕获错误，也不执行 commit 或 rollback。sync runner 在 core 返回完整 outcome 后直接 commit；async runner 若持有 with-frontend host input，则先用 `outcome.app` await 唯一 typed host finalizer，再 commit，否则直接 commit。public facade 随后只投影 app，local package private path保留 outcome。credential/identity/clock 的三项简单规范化可以留在 preparation helper；root 不需要为其新增 composition 文件。

#### 1.1 完整装配 surface 与唯一 handoff

文件是否进入本 change 由其是否拥有黑盒装配决策决定，而不是由目录、文件数或 `composition` 命名决定。目标 surface 固定如下：

| surface | 当前文件 | 唯一目标职责 | 禁止事项 |
|---|---|---|---|
| product factory/runner/core | `composition/create-app.ts` | 四个public factory facade、恰好一个sync runner与一个async runner、sync/async preparation、唯一 failure-scope policy、唯一 `composeNextAgentApp`、package-private outcome/host facts | facade不创建scope或嵌套调用；不承载 package evidence、test defaults 或 post-return registration；public facade只投影app |
| module entry families | design 4.1 列出的 app-local module files | 本模块 selection/construction/optional branch/job/result/partial-failure cleanup | 不接收完整 public/prepared options，不形成第二个 root |
| local configured auth host | `composition/create-local-configured-app.ts` | 只选择 `LOCAL_CONFIGURED_AUTH`、创建/选择local-only typed contribution并把原 options/model/provider 交给同一 runner | 不复制/capture options、不解释auth config、不直接注册 route/plugin、不拥有 rollback |
| local auth channel adapter | `composition/local-configured-auth-channel-contribution.ts` | local product dependency graph中唯一local-auth静态依赖点；实现字段固定contribution，在channel invocation时构造auth/plugin与protected registration | 不接收/capture完整options、不调用app factory、不拥有server lifecycle/rollback |
| with-frontend host | `entrypoints/with-frontend.ts` | host field projection、同一async runner的typed host input、唯一commit前frontend finalizer；executable main只选择config/profile | 不创建第三个runner或第二套local defaults，不在commit/public return后注册 |
| local runtime package host | `local-runtime-package/index.ts` | manifest/layout preflight、一次 package config fact、packaged Agent definition、唯一writer后可选OTLP trace bootstrap、candidate/run evidence、deployment dispatch、start/stop、private hostFacts消费 | 不重复读取 local config，不构造第二套 product model/gateway/通用observability pipeline，不从app projection反推evidence，不重复关闭 runner-owned handle |
| local gateway/workbench adapter | `local-runtime-package/local-runtime-bindings.ts` | 动态提供窄 local gateway factory set、protected prefixes、frontend scripts和 workbench contribution | 不调用 app factory、不拥有 server/rollback，不把 workbench projection迁入 channel业务语义 |
| test host | `composition/create-test-composition.ts` | 解释完整 test options、构造 isolated test facts/defaults、投影 production input、调用同一sync或async runner | 不直接构造prepared state，不复制 production module order/config loader/channel registration/cleanup policy |
| public testing facade | `testing.ts` | test-only wrappers、observation projection、app cleanup registration、testing exports | 不形成第二个 preparation/core，不向 production prepared type泄漏 test-only fields |
| thin launchers | `entrypoints/backend-only.ts`、`entrypoints/local-configured-auth.ts`、`entrypoints/with-frontend.ts` executable main | 选择公开 factory/profile并调用 `app.start()` | 不读取/规范化 app config、不构造 provider/default、不注册 route/plugin、不拥有 composition rollback |
| local gateway public facade | `packages/agent-platform-gateway-local/src/entrypoints/local.ts` | 在agent-app边界前按固定字段提供local gateway/SkillHub defaults并保持explicit override优先 | 可投影标准public options一次；不读app config、不编排module/core、不拥有server或rollback |
| local gateway testing facade | `packages/agent-platform-gateway-local/src/testing.ts` | 保持local defaults、audit capture、metrics default与test wrapper | 不创建第二个test/product core；capture只关联成功返回app |
| external remote host | `packages/agent-remote-deployment/src/index.ts` | 构造 remote adapter contribution并调用 public product factory；保留 package start/stop | 不复制 product module order；本 change 默认只做 integration characterization，除非验证发现必须做窄接入修改 |
| root process host | `src/main.ts` | 创建app、安装fatal boundary、调用start，并在start failure安全记录/close/设置退出状态 | 不参与composition rollback或module wiring；保留process failure语义 |
| local dev host | `scripts/start-dev-backend.mjs` | 动态取得固定local gateway/workbench defaults，调用一个async product factory并start | 不形成第二个config/core；保持开发启动行为 |
| workflow demo host | `scripts/start-demo-workflow-server.mjs` | 通过testing facade构造demo app、在start前添加既有CORS hook、注册signal close并start | demo hook不是产品route/plugin；不得在start后追加产品registration或形成第二个core |

`auth/local-auth.ts`、`server/fastify.ts`、`assembly/**`、`config/**`、`plugin/plugin-loader.ts`、`packaging/**`、`release/**` 和其他 helper 只有在其实际承载上述 selection/construction/handoff 时才修改；仅提供 leaf factory、schema/parser、evidence mapping、safe diagnostic 或 public export 时不因相邻文件重构而改动。

全目录只读审计必须按下表给每个非 surface 文件归因；这不是按文件名豁免，而是按其黑盒职责判断。实施中若某文件出现右列之外的 root/host wiring 信号，必须先把它升级为上表的装配 surface并补 design/tasks，不能借“leaf”标签绕过重构。

| 路径类别 | 当前黑盒职责 | 本 change 写入判据 |
|---|---|---|
| `composition/*-composition.ts`、`cron/cron-runtime-composition.ts` | design 4.1 的 module entry，或 module 内部 supporting composition | 权威 entry 必须纳入；纯 supporting helper 只在该 module 流程需要时修改，不新增竞争 entry |
| `composition/{app-composition-helpers,composition-contracts,deferred-composition-bindings}.ts` 及新增 failure/config support | root 的 typed support、deferred holder和 failure control | 只承载决策1/2/5/6定义的固定类型与控制语义，不形成独立 pipeline |
| `composition/{test-lifecycle,test-observation-logger,test-sqlite-path}.ts` | test-host leaf support | 仅在37字段投影、test ownership或隔离验收要求时窄改，不解释 production options |
| `assembly/**` | Agent definition/parser/compiler/registry/source 等被 assembly module 调用的领域 leaf | assembly 黑盒行为不变；只有任务3.3所需的窄 typed handoff冲突时修改 |
| `config/**` | schema、validation、path/env evaluator和 pure resolver | 不拥有 app pipeline；仅配置唯一入口复用或 cron/gateway 共用 pure predicate需要时窄改 |
| `plugin/plugin-loader.ts` | 单个 plugin snapshot loader/validator | 由 plugin module 调用，loader本身不拥有 app registration、failure scope或 module order |
| `auth/local-auth.ts`、`server/fastify.ts` | identity/server leaf factory | 由 channel module调用；不升级为 host/root owner |
| `packaging/**`、`local-runtime-package/cli-output.ts` | candidate/evidence mapping与 safe CLI output | package host继续调用；不拥有 product construction或 cleanup policy |
| `release/**` | release qualification与 gate execution，不构造 `NextAgentApp` 对象图 | 不属于本 change 的 app composition；除非实施证据证明其开始调用 app factory或解释 app options，否则不改 |
| `app-startup-failure.ts`、package `index.ts` export barrel | safe failure classification或 public re-export | 无装配决策，不改 |

local runtime package 的唯一 config path 固定为：

```text
startRuntimePackage 或直接 startLocalRuntimePackage
  -> prepareLocalRuntimePackageHost（manifest/layout + 一次 config read/resolve/validate/freeze + packaged Agent definition）
  -> LOCAL dispatch 复用同一个 PreparedLocalRuntimePackageHost
  -> 按运行日志/trace基线先创建唯一writer，再初始化可选OTLP trace，并作为app-owned handles注入
  -> 唯一app-private async runner；WITH_FRONTEND只额外携带字段固定的ProductHostCompositionInput
  -> 同一async preparation和同一core
  -> private ProductCompositionOutcome.hostFacts -> normal package evidence/start/run-state
```

`startRuntimePackage` 不得在选择 LOCAL entry 后调用会重新执行 package preparation 的 public local start；它必须把已准备 result 交给 app-private local start。直接调用 public local start 时才自行执行一次相同 preparation。REMOTE dispatch 可以把 package ref 交给 remote deployment host，但 local package 不再为该 remote app另建 product pipeline。

本 change 的实现顺序固定串行于 `add-ts-runtime-operational-log-hardening` 与 `add-otlp-trace-export`：两项实现必须先完成并形成当前 writer/trace 初始化和close稳定基线；归档可以滞后，但两项剩余工作只能是验证/归档收尾，且不得在本 change 实施期间继续修改重叠装配路径。本 change 随后只移动其已冻结 handoff，不重新定义或并行编辑其 contract。

### 2. 配置入口只产生一个配置事实和两个窄环境边界输入

新增 `configuration-composition.ts`，提供唯一同步 `loadAppCompositionConfiguration(...)`：

```text
injected config 或 config locator
  -> evaluate source
  -> safe configuration-failure telemetry
  -> ready gate
  -> freeze DefaultSystemConfig
  -> resolve capability reference validation port
  -> resolve gateway sandbox runtime input
```

输出固定为：

```text
LoadedAppCompositionConfiguration {
  systemConfig,
  capabilityProviderReferenceValidation,
  gatewaySandboxRuntime
}
```

`systemConfig` 是唯一配置事实。后两个字段是 configuration boundary 必须一次性完成的 environment/reference projection，不复制 config 字段，不形成第二套配置模型。显式注入 `systemConfig` 时不读取配置文件，但仍完成相同的窄环境投影。

local runtime package 的 package preflight 是唯一受控 host 前置：它为了 layout/config evidence 读取并验证 package config，并把该同一个 frozen result 注入 product runner；`loadAppCompositionConfiguration(...)` 走 injected-config 分支，不再次打开文件。该例外不允许 package host 派生第二套 capability/gateway/model config，也不允许 `startRuntimePackage` 与 local deployment entrypoint各读一次。remote deployment 若把 `configFile` 交给 public product factory，则仍由 product configuration entry完成唯一读取。

其他 composition entry 不得调用 config evaluator、打开配置文件或直接读取 `process.env`。现有 gateway CLIP env projection 和 capability reference validation 从 root/gateway 移入这里；config parser、schema、path normalization 和 secret resolver owner 保持不变。

cron deployment selection 由 frozen `systemConfig` 经 app-private `config/gateway-selection.ts` 纯函数只解析一次，并在 preparation 投影为 `DISABLED | LOCAL | REMOTE`；`DISABLED` 仅表示现有未启用/缺省状态，不进入配置 schema、持久化或 public contract。该 helper 只拥有 selection/部署匹配规则，可与 gateway 复用，不接收 scheduler factory、callback credential reference、callback registration 或 server，也不产生 readiness/preflight 结果。配置加载成功只说明 deployment selection 合法；各装配 prerequisite 由下游真实消费者负责。

### 3. 完整 app composition 只展示八段流程，其中七段属于共享 core

入口 preparation 是 public factory 与 shared core 的边界；它与 `composeNextAgentApp(...)` 内部七段共同组成以下八个宏观层级。第 7 层由 core 构造完整 app，并由 runner 完成可选 host finalization 与 lifecycle ownership handoff；不包含 public return 后的 `app.start()`。core 中的七层是连续代码段和注释，不新增 `composeXxxStage()` wrapper，也不产生新的 layer aggregate object。

| 层级 | 输入 | 内部顺序 | 主要输出 | 失败责任 |
|---|---|---|---|---|
| 0. 入口 preparation | public options/injected dependencies、runner-owned failure scope | identity/clock → bootstrap metrics → config → plugin snapshot load/validation/freeze → product-host defaults → remaining sync/async startup contribution preload | 含唯一 frozen `PluginComposition` 的 `PreparedCompositionInputs`；async runner MAY另持窄 `ProductHostCompositionInput` | required plugin或其他preload失败不进入shared core；preparation内部部分构造失败先清本阶段，已形成handle立即登记到runner-owned scope |
| 1. 启动贡献 | frozen config、plugin snapshot、injected hooks/provider refs | lifecycle definitions → capability provider config/reference validation | definitions、resolved provider preparation | 无资源时直接安全失败；不得预检 cron runtime 依赖 |
| 2. Agent 静态装配 | config、identity、definitions、plugin policy、Agent definition | assembly compile/validation/scopes → configured directory preparation → lifecycle materialization → prompt registry → model profiles/lifecycle model | assembly、prompt、model、workspace/scopes | directory/assembly 失败不进入基础设施层 |
| 3. 平台基础设施 | config、assembly、observability preparation、gateway inputs | observability projector bootstrap → gateway/stores/sandbox/RAG；按 cron deployment selection 选择/构造 cron task gateway → audit-backed observability completion → observed gateway/CLIP/model diagnostics | gateway、projector host、observed sandbox、RAG handles | selected cron binding/factory 缺失在 gateway 消费点失败；已创建 closable handles 登记 failure scope |
| 4. 执行能力 | assembly、gateway、model/prompt、provider preparation、cron deployment selection | risk policy → 从 selection + cron gateway 构造 typed cron capability composition → memory capability → background callbacks → workflow → capability subsystem/final assembly validation → bind workflow targets | catalog、invocation、workflow adapters、memory/background ports、cron capability composition | enabled cron 缺 gateway 在 capability 消费点 fail closed；重复 binding 失败，background timeline 非法提前调用失败，既有 optional/default lookup 保持 neutral result |
| 5. 应用服务 | gateway、catalog、assembly、model/prompt、observability | attachment runtime → memory maintenance → session/question/share → context → health | app service results、worker/scheduler handles | worker/scheduler 只构造不启动 |
| 6. Runtime 与通道 | app services、capability、gateway、config、channel auth profile与host contributions、typed cron capability composition | request runtime → bind lifecycle/subagent/background targets → channel/server → 按固定precedence注册Web/local auth/workbench → task → 按 deployment 构造 LOCAL scheduler、REMOTE callback runtime 或 DISABLED empty result | runtime、server、channel/cron handles | 分支专属 prerequisite 在创建 scheduler/verifier/route 时失败；server/runtime/registration handle 登记 failure scope，任一 channel/cron registration 失败不返回 app |
| 7. App lifecycle/host handoff | 所有 lifecycle handles；async runner optional `ProductHostCompositionInput` | core compose existing start/close handles并返回未公开`ProductCompositionOutcome` → async runner optional await typed with-frontend finalization（frontend hosting/SPA fallback 最后注册）→ runner commit → public app或package-private outcome handoff | public `NextAgentApp`保持同形；package private安全host facts | finalization/commit 前失败由当次唯一runner rollback；commit 后只由既有 app lifecycle close；sync runner无 host finalization |

root 必须直接呈现上述八段边界，但不要求把模块内部真实前后依赖全部提升成独立顶层 phase。observability、lifecycle hook、capability、memory、request runtime、cron 等模块可在一个权威 entry family 中暴露少量前后 entry；这些 entry 只在其依赖所处宏观层出现。bootstrap metrics 是 config failure telemetry 的显式前置输入，因此在 config 前创建；plugin loader需要frozen plugin config和config root，因此紧随config，属于第0层preparation而不是第4层capability。其唯一frozen snapshot随后扇出给第1层lifecycle definitions的`hooks`、第2层assembly及后续request runtime的`policies`、第4层capability的`providers`，并保留`diagnostics`给既有安全诊断/characterization消费者；任何下游层都不得重新读取plugin source。plugin preload不是第九个顶层阶段。

### 4. 模块只保留一个权威装配路径，流程已清晰的模块默认不改

“一个模块一个装配文件”解释为：一个 app-local module responsibility 只有一个权威导出 composition entry family；私有 helper 文件可以存在，但不能被 root 或其他模块当作第二条完整装配路径。架构测试保护 entry ownership 和依赖方向，不锁死所有 helper 文件名。

| 模块 | 权威入口与最小增量 |
|---|---|
| configuration | 新增唯一 loader，收拢 config evaluate/ready/environment projection |
| plugin | 新增 sync/async preload entry，复用现有 plugin loader |
| observability | 扩展现有入口：config-failure metrics preparation、sync/async preload、projector bootstrap、audit-backed completion |
| lifecycle hook | 仅收拢 root 中 definitions、materialization、model wrapper；保持 hook 行为 |
| assembly | 仅收拢 root 中 definition/source locator、registry/scopes、workspace resolver；保持 compiler/validation |
| prompt | 复用现有 `prompt-template-composition.ts`，没有 root 残留则不修改生产代码 |
| model | 收拢 root 中 product model/profile/patch resolver/diagnostics；可以把小型 diagnostics helper并入同一 entry family |
| gateway | 移除 env 读取，收拢 root 中 observed sandbox/CLIP；保持 store/RAG/binding 行为 |
| memory | 收拢 root 中 opt-in/tool/provider/diagnostics，再复用现有 maintenance 构造 |
| background | 新增一个入口收拢 store callbacks 和 typed timeline proxy |
| workflow | 复用现有权威入口；只有为接收 typed deferred proxy 所必需的签名调整可修改 |
| capability | 收拢 provider preparation、external contributions、subsystem、final assembly validation 和 workflow adapters |
| attachment | 收拢 upload preload、runtime 和 periodic cleanup registration |
| session/context/health | 复用现有权威入口；不为统一内部顺序改写生产代码 |
| request runtime | 收拢 root 中 risk policy、coordinator/listener、observed/tracked command 和 subagent output |
| channel | 收拢 root 中 resolver/adapter closure 和 server registrations；只按channel auth profile与typed contribution选择default Web或local configured auth，保持custom Web/extension/task precedence；server create result 返回后立即交接唯一 cleanup，cron callback 随后注册；不静态依赖local-auth包，不拥有async frontend finalization |
| cron | 在现有 cron module 内只保留 capability composition 与 runtime composition 两个依赖阶段；删除 root 可调用的独立 readiness/preflight validator。共享 selection predicate 归 `config/gateway-selection.ts` 纯 helper，cron 不 value-import gateway composition |
| app lifecycle | 复用现有 start/close owner；只按需要接收完整 handles，不重写正常顺序 |
| with-frontend host finalization | 唯一 app-private async entry；只在唯一async runner持有typed host input、scope 未 commit、app 未公开时解析/校验 manifest 并 await hosting plugin registration；不得被sync runner、facade、core/module 调用 |

#### 4.1 模块内部装配流程契约

模块“内聚”只回答代码归谁拥有；模块“流程清晰”还必须回答如何完成装配。每个权威 entry family 都必须满足：

- 入口列出已经完成的上游 typed result 和本模块窄配置，不接收完整 public/prepared options；
- 先完成 validation/implementation selection，再创建有副作用或可关闭资源的对象；
- 内部步骤按真实依赖连续排列，不通过跨文件 mutable 回填或 root-side closure 隐藏顺序；
- optional 分支在进入下游前收敛为明确 absent/disabled/empty result；
- 最后一次性返回只包含直接消费者或 app lifecycle 所需字段的 typed result；
- 构造中途失败由模块清理未交接资源，成功交接后的 cleanup handle 由 root failure scope 或 app lifecycle 接管。

以下是各模块唯一目标流程。箭头表示必须保持的依赖顺序；实现可以提取私有 helper，但不得交换有依赖的步骤、另建竞争流程或把步骤重新展开到 root。

1. **Configuration — `configuration-composition.ts`**
   - 前置：credential resolver、config locator 或 injected config、bootstrap metrics、entrypoint logging profile。
   - 流程：选择 injected config 或 evaluate config source → 上报 blocked/invalid safe telemetry → ready gate/freeze → 选择 injected 或 default capability reference validation port → 解析 gateway sandbox runtime input。
   - 输出：`LoadedAppCompositionConfiguration`，只交给 preparation、capability provider preparation 和 gateway；失败发生在模块装配前，不产生 lifecycle resource。

2. **Plugin — `plugin-composition.ts`**
   - 前置：frozen plugin config、config root、optional injected snapshot。
   - 流程：injected snapshot 优先 → 无配置返回 frozen empty snapshot → 否则调用 sync/async loader → 冻结 plugins/providers/policies/hooks/safe diagnostics projection。
   - 输出：同形且只创建一次的 `PluginComposition`；`hooks`给startup lifecycle definitions/materialization，`policies`给assembly、capability final validation及request runtime policy，`providers`给capability external providers，`diagnostics`只进入既有安全诊断/characterization路径。required plugin失败在shared core前终止，optional rejection只保留loader定义的degraded diagnostic；任一消费者不得持有loader、config root或再次读取plugin source。

3. **Observability — `observability-composition.ts`**
   - 前置：pre-config injected metrics、frozen config、prepared writer/infrastructure、assembly scopes、gateway audit store。
   - 流程：准备 config-failure bootstrap registry → sync/async 选择 operational writer 和 metrics infrastructure → 固定最终 registry/logger binding → assembly 后构造 structured-log/metrics/trace projectors → gateway 后用 audit store 完成 audit writer/projector host。
   - 输出：prepared observability、一次性 completion 和最终 projector host，供所有 observed adapter 与 lifecycle 消费；每次资源创建成功即返回具名 cleanup handle，completion 重复调用失败。

4. **Lifecycle hook — `lifecycle-hook-composition.ts`**
   - 前置：built-in/plugin/injected hooks，随后是 validated assemblies、product model 和 lifecycle invocation proxy。
   - 流程：合并 hooks → build startup registry → freeze definitions → 对每个 assembly materialize snapshot/executable → 选择 injected 或 assembly-scoped executor → 创建使用 deferred invocation port 的 lifecycle model wrapper。
   - 输出：definitions 给 assembly，materialized executor 给 context/runtime，model wrapper 给 context/memory；request runtime 完成后由 root 单次绑定 invocation target。

5. **Agent assembly — `assembly-composition.ts`**
   - 前置：frozen config、trusted/injected Agent definition、identity、lifecycle definitions、plugin policies。
   - 流程：定位/加载 active definition → 构造 resource references → discovery/compile assemblies → 生成 recipe source/capability projection和 runtime workspace policy → startup graph validation → registry/hot-reload view → active route assembly → Agent/Owner scopes → package source locator/execution workspace resolver。
   - 输出：`AgentAssemblyComposition`，供 prompt、gateway、capability、session、context、runtime/channel 消费；无 assembly、graph/reference 或 workspace policy 非法时在创建基础设施前失败。

6. **Prompt template — `prompt-template-composition.ts`**
   - 前置：frozen paths、active Agent definition、validated assemblies。
   - 流程：验证 trusted Agent prompt root → root 存在时注册 → 注册 builtin templates → 创建唯一 assembler。
   - 输出：registry/assembler 给 workflow、memory、context、channel；root 不存在时仅跳过该 registration，越界、非目录或冲突失败。

7. **Model — `model-composition.ts`**
   - 前置：injected/default product model inputs、frozen model profiles、observability completion result。
   - 流程：选择 injected model 或按 provider kind/credential/gateway providers 构造 product model → 创建单一 model profile registry → 创建 capability model patch resolver → projector host 可用后上报 safe model exclusion diagnostics。
   - 输出：product model/provider kind、profile registry、patch resolver给 assembly-facing services、capability、context、session/runtime；不得创建第二个 registry 或在 diagnostics 阶段改变选择结果。

8. **Gateway — `gateway-composition.ts`**
   - 前置：frozen selection/paths、configuration-owned sandbox runtime input、窄 gateway factories/bindings、identity、default route assembly。
   - 流程：选择并校验 provider bindings → 投影 required stores → 构造 sandbox/scheduled-maintenance/optional cron stores → 构造 memory-configured gateway → 注册 fork cleanup job → 构造 RAG governance/retrieval → todo/local-persistence/build-gate projection → projector host 可用后构造 observed sandbox 和 CLIP runner。
   - 输出：gateway/stores、maintenance、RAG、optional cron、observed sandbox、CLIP 与 cleanup handles；选中 adapter 缺 binding 时 fail closed，模块内创建中途保持 exception-safe。

9. **Memory — `memory-maintenance-composition.ts`**
   - 前置：assemblies、frozen memory config、gateway/local-persistence evidence、identity/scopes、model/prompt/lifecycle/observability。
   - 流程：project memory-tool opt-in → 区分 unregistered/disabled/enabled → 创建 diagnostics/aging observers → 创建 tool port → 按 opt-in/config status 创建 absent、disabled 或 enabled provider → 上报 safe telemetry → LOCAL persistence 时依次创建 trajectory worker、per-Agent aging scheduler、per-Agent extraction scheduler。
   - 输出：memory capability result 和 maintenance handles；非 LOCAL 返回 empty worker/scheduler arrays，构造阶段不启动任何 worker/scheduler。

10. **Background task — `background-task-composition.ts`**
    - 前置：optional trusted store factory、deferred runtime timeline proxy。
    - 流程：factory 缺失返回 disabled result → factory 存在时创建 store → 创建 started callback → 创建 completion callback，并统一通过 typed proxy 发 timeline。
    - 输出：background store/callback composition 给 capability/channel；未绑定调用和重复 target binding fail closed，不使用 optional chaining 静默丢事件。

11. **Workflow — `workflow-composition.ts`**
    - 前置：workflow selection、recipe source、credential/lifecycle/RAG/model 依赖和 deferred capability/runtime adapter proxies。
    - 流程：创建 node catalog/adapters → 按 injected factory、REMOTE gateway、LOCAL service 的确定优先级选择唯一执行服务 → 完成 sub-recipe self-reference。
    - 输出：唯一 `WorkflowExecutionService` 给 capability/request runtime；选中的 remote gateway 缺失时失败，deferred proxy 只有实际提前调用时 fail closed。

12. **Capability — `capability-composition.ts`**
    - 前置：configuration validation port/plugin adapter types，随后是 assembly、observed sandbox、workflow、memory/background/recipe/plugin providers、risk/RAG/todo/cron、prompt/model。
    - 流程：assembly 前验证 provider references/custom adapter registration并冻结 resolved provider config → 汇总 external providers → 创建 subsystem → 注册 subsystem maintenance jobs → 构造 startup provider registry → 用最终 provider references 复验 assembly graph → 取得 catalog/invocation port → 创建 workflow runtime adapters → 启动既有非阻断 skill scan diagnostic。
    - 输出：resolved providers、subsystem、catalog、invocation、workflow adapters；root 随后立即绑定 workflow targets，final validation 失败不进入 app services。

13. **Attachment — `attachment-composition.ts`**
    - 前置：injected/default/Agent upload config，随后是 blob/attachment stores、clock、projector、owner scope、temp dir、maintenance registrar。
    - 流程：sync/async 选择 upload config并执行既有 async startup temp cleanup → 创建 diagnostics → staged upload → execution → optional summary → intake → cleanup runtime → 注册 periodic upload-temp cleanup job。
    - 输出：prepared upload config 和 `AttachmentComposition` 给 runtime/channel；summary 缺失保持 absent，job 只注册不启动。

14. **Session services — `session-services-composition.ts`**
    - 前置：gateway stores、clock、model/assembly/profile/catalog、Agent package source locator。
    - 流程：category catalog → session facade → annotation service → suggested/precomputed question services → category/frequent question services → share service。
    - 输出：`SessionServicesComposition` 给 request runtime/channel；不解析 channel DTO、不启动后台任务、不拥有 request lifecycle。

15. **Context engine — `context-engine-composition.ts`**
    - 前置：context/disclosure config、workspace resolver、assembly/gateway/catalog、lifecycle/model/prompt/patch/clock/projector。
    - 流程：large-content externalizer → fork-promotion resolver → request-scoped summary generator → context engine → observed wrapper。
    - 输出：externalizer、fork resolver、observed context engine 给 request runtime；不得重建 model profile或 prompt registry。

16. **Health — `health-composition.ts`**
    - 前置：metrics、gateway、trusted identity/default Agent、model/assembly/credential/catalog、projector/scopes。
    - 流程：session/model/capability probes → evaluator → observed wrapper → transition diagnostics wrapper。
    - 输出：唯一 `HealthEvaluator` 给 channel/final app；composition 不执行 deep check，probe runtime degradation 返回既有 safe result。

17. **Request runtime — `request-runtime-composition.ts`**
    - 前置：capability 前的 optional risk evaluator；最终阶段接收 assembly/plugin/context/lifecycle/capability/workflow/session/gateway/memory/attachment/workspace/scopes。
    - 流程：先选择 injected 或 built-in risk evaluator → 下游齐备后创建 policy resolver → request lifecycle coordinator/stores/listeners/terminal callbacks → 产出 lifecycle invocation target → 创建 runtime subagent execution → observed runtime command → question-activity tracked command。
    - 输出：runtime、tracked commands、subagent/lifecycle targets给 root/channel/cron；target 绑定失败时不进入 channel。

18. **Channel — `channel-composition.ts`**
    - 前置：runtime/commands、attachment、channel config、credential/identity/health/catalog/assembly、session services、gateway-backed optional services、prompt/inventory resolvers、access logger、`channelAuthProfile`、optional local-auth contribution，以及 preparation逐字段投影的custom Web/trusted extension/protected prefixes/task contribution；不接收 frontend hosting profile、package host kind或完整 public options。
    - 流程：`composeProductChannelLayer(...)` 创建 Fastify server → 创建 trusted identity/context projection和 module-owned resolvers/adapters → 按下表只执行一个Web/auth分支 → 注册 task channel → 返回 server/readiness；cron runtime 随后在同一 server 注册 callback route。shared channel entry只调用local-auth contribution，不 import `@nextagent/agent-channel-web-auth-local`。
    - 输出：server/registration readiness handles 给 cron/lifecycle；`composeProductChannelLayer(...)` 在完整 create result 返回前失败时由自身关闭尚未交接的 server，完整返回后 root 立即把唯一 server cleanup 登记到 failure scope并接管失败 ownership；其后的 cron registration 或 with-frontend finalization 失败不得自行再次关闭 server，只触发 runner rollback。成功 commit 后 server close ownership 转交 app lifecycle。

| channel auth profile / input | 固定 Web/auth 顺序 | trusted extension/workbench | 后续固定顺序 |
|---|---|---|---|
| `DEFAULT_WEB` + custom `webChannelRegistration` | 只调用custom registration；不注册builtin Web | 保持现状：不再调用trusted extension | task → cron → optional frontend hosting |
| `DEFAULT_WEB` + 无custom registration | 注册builtin trusted-identity Web | builtin Web后调用trusted extension；extension failure终止composition | task → cron → optional frontend hosting |
| `LOCAL_CONFIGURED_AUTH` | 忽略caller custom Web registration，要求local-only typed contribution；contribution校验config、构造auth、在protected scope注册builtin Web，再注册auth plugin | contribution在同一protected scope调用trusted extension并合并readiness | task → cron → optional frontend hosting |

三行都保持 explicit override/default 与既有错误优先级。local auth 与 default/custom Web 互斥；task 永远在选定 Web/auth 分支之后，cron 在 channel result 之后，frontend hosting/SPA fallback仅在`WITH_FRONTEND` finalizer中最后注册。workbench unavailable只允许按local adapter既有规则降级，不能吞掉 Web/auth/task/cron/frontend failure。

19. **Cron — `cron/cron-runtime-composition.ts`**
    - 前置：preparation 已从 frozen config 投影 `deploymentSelection: DISABLED | LOCAL | REMOTE`；平台基础设施随后提供 optional selected cron task gateway；runtime/channel 阶段再提供 projector、runtime submit/store、credential resolver、server、default language 及分支专属 factory/input。配置和启动贡献阶段不得接收或检查 callback credential、registration 或 scheduler factory。
    - capability 流程：`deploymentSelection` → `DISABLED` 返回 `{ enabled: false }`；`LOCAL | REMOTE` 在消费点要求 selected cron task gateway，随后构造 cron capability port 与 mutation observation，并返回 `{ enabled: true, deployment, cronTasks, capabilityPort, observation }`。该 typed union 是 runtime 的唯一分支输入；capability entry 不知道 scheduler、server、credential 或 callback registration。
    - runtime 流程：先按 typed capability result switch；disabled 直接返回 empty result且不创建 delivery/verifier/scheduler/route。LOCAL 分支只要求 scheduler factory，并按现有顺序创建 delivery → scheduler；REMOTE 分支只按现有顺序要求 callback credential reference → 创建 verifier/delivery/handler → 要求 callback registration → 注册 callback route。未选中分支的专属输入被忽略，不得触发错误或副作用。
    - 失败顺序：enabled 分支缺 selected cron gateway 时保持 `CRON_TASK_GATEWAY_UNAVAILABLE`，并因平台/capability消费发生在runtime前而优先于scheduler/callback prerequisite；LOCAL 创建 scheduler 时缺 factory保持`CRON_TASK_SCHEDULER_FACTORY_REQUIRED`；REMOTE 创建 verifier 时缺 credential 保持 `CRON_CALLBACK_CREDENTIAL_REQUIRED`，通过后在 route registration 消费点缺 registration 保持 `CRON_CALLBACK_REGISTRATION_REQUIRED`。credential 与 registration 同时缺失时 credential 错误优先。不得导出或由 root 调用 `validateCronRuntimeComposition(...)` 或任何独立 cron prerequisite validator；分支内 `require*` 可以是 module-private helper。
    - 输出与 lifecycle：optional cron capability port、scheduler 或 callback registration 给 capability/lifecycle；LOCAL/REMOTE/DISABLED 互斥。`cronTriggerCallbackRegistration.ready()` 仍由 `NextAgentApp.start()` lifecycle 顺序调用，不属于 composition prerequisite；ready 异常按 app lifecycle 的 pre-listen 降级规则记录后继续启动。REMOTE prerequisite 后移后，frozen config 可以先产生既有 accepted diagnostic；若随后在 pre-listen 启动贡献阶段失败，app 继续进入 server listen，public request/runtime path 后续按正常 gateway/service 可用性运行。

20. **App lifecycle — `app-lifecycle-composition.ts`**
    - 前置：所有 bindings 已完成，server/runtime/worker/scheduler/job/RAG/gateway/observability handles 已齐备。
    - start 流程：scheduled maintenance → cron scheduler → trajectory worker → memory aging → memory extraction → capability startup validation → Web ready → task ready → cron callback ready → RAG build → runtime recovery → server listen。server listen 前各阶段保持原顺序尝试，但只作为启动贡献或 bounded recovery；外挂 gateway/service 暂不可用时记录一次 stage-scoped degraded diagnostic 并继续后续阶段，不作为启动硬依赖。只有 server listen 仍是对外服务 ready 的 fail-closed gate。
    - close 流程：memory aging → memory extraction → trajectory worker → cron scheduler → scheduled maintenance → cron callback registration → server → runtime → RAG resources → cron store → projector host → gateway bindings → metrics → operational log → runtime logger unbind。
    - 输出：幂等 `start/close` 和完整 `NextAgentApp` lifecycle；本 entry 只构造 handles，不调用 `start()`。每个input必须在决策6 completeness map中归类为closable app-owned handle、readiness/start-only依赖或纯fact，不允许未分类input。既有 start failure 保留准确 stage，close finalizer best-effort 且不阻断后续 finalizer；start-phase transactional rollback 明确 deferred，不属于 composition failure scope。

21. **With-frontend host finalization — `entrypoints/with-frontend.ts` 的 app-private helper**
    - 前置：唯一async runner 持有未 commit failure scope、core 返回但尚未公开的完整 app，以及只含 `productVersion`、manifest resolver、index scripts 和 `useDefaultWorkbenchScripts` 的 `ProductHostCompositionInput`。
    - 流程：按当前顺序解析 hosting manifest → 读取并校验 frontend package version → `await app.server.register(frontendHostingPlugin, ...)`；此时 Web/local/task/cron route 已完成，因此 SPA fallback 保持最后注册。普通 runner、shared core 和 channel module 不调用该 helper。
    - 输出：成功后无新 root state，只允许当次async runner commit/return；失败由同一 async runner `rollbackAsync()`，不得自行 close server。独立 candidate-evidence 函数继续走自己的 read-only manifest/version 查询，不复用 app finalizer。

configured sqlite parent、runtime workspace 和 shared data root 的三项目录准备保持一个简单的 app-private helper，在 Agent assembly 校验成功后由 root 调用。它不是模块 composition entry，不返回 stage object，也不与 credential/identity/clock 人为合并成 `startup-foundation-composition.ts`。

#### 4.2 Product/test/package host 与 launcher 流程契约

module entry 之外的装配 surface 同样必须有唯一、连续流程：

1. **Local configured auth host — `composition/create-local-configured-app.ts`**
    - 输入：原始 `CreateNextAgentAppOptions` 或 `CreateComposedAppOptions`、已有 model/provider kind。
    - 流程：从app-private `local-configured-auth-channel-contribution.ts`创建不捕获options/config/server的`LocalConfiguredAuthChannelContribution` → 选择`channelAuthProfile: LOCAL_CONFIGURED_AUTH`与`frontendHostingProfile: NONE` → 把原 options 引用、contribution和显式 model/provider 交给唯一 sync runner。adapter是agent-app中唯一local-auth静态依赖点；contribution只在channel stage被调用并在当时构造auth/plugin、protected Web和extension registration。
    - 输出：runner outcome投影的完整 app；本 facade 不读取 auth config、不复制/capture options、不直接注册 local auth、Web 或 extension，也不 catch composition failure。shared channel/generic entry不依赖local-auth包。

2. **With-frontend host — `entrypoints/with-frontend.ts`**
    - 输入：原始 extended public options。
    - 流程：只读取三个 host fields和 default-workbench scripts 派生事实 → 设置`frontendHostingProfile: WITH_FRONTEND`但不改变channel auth profile → 原对象与typed host input交给唯一async runner → preparation 唯一解析 production fields/local defaults → shared core outcome → typed finalizer → commit → public facade投影app。
   - 输出：完整 app；executable main 只读取 launcher-level config locator并调用该 factory，不再动态构造 local gateway factories。

3. **Local runtime package host — `local-runtime-package/index.ts`**
    - 输入：package root。
    - 流程：manifest/layout → 一次 config read/env resolution/runtime validation/freeze → packaged Agent definition merge → 创建唯一operational writer → 使用该writer按冻结trace契约初始化可选OTLP projector → deployment dispatch；LOCAL 使用同一 prepared host result和fixed local bindings生成一份production input。`backend-only` hosting profile直接调用唯一app-private async runner且不创建frontend host input；`with-frontend` hosting profile由package private start把同一production input引用与单独的package manifest resolver/product version host input直接交给同一app-private async runner，不通过public facade丢失private outcome，也不通过spread/merge复制完整options。两条路径都返回同形`ProductCompositionOutcome`；package随后用`hostFacts.reportAppStartFailure`处理start failure，用`hostFacts.gatewayReadiness`生成既有provider/readiness proof，再执行`app.start()` → health/start/run-state evidence。composition failure由同一async runner rollback；start failure由package host记录safe evidence并调用一次`app.close()`。
    - 输出：`LocalRuntimeStartProof` 与 running app registry；package stop 只关闭已成功返回并启动的 app。model与gateway defaults由 product preparation创建或接受；writer/trace是package-specific bootstrap contribution而不是第二套通用observability pipeline。host在runner接受前负责writer/projector构造失败cleanup，runner接受后完全由failure scope/app lifecycle关闭；hostFacts不返回这些handle，package不得直接关闭或从app public projection重建gateway evidence。

4. **Local gateway/workbench adapter — `local-runtime-package/local-runtime-bindings.ts`**
   - 输入：无全局 app state；动态 local gateway package和 channel entry提供的窄 context。
   - 流程：验证所需 local factory exports → 返回固定 factory set；workbench contribution 在 channel invocation 时动态加载 workbench、构造 read port/access scope并注册。保持“workbench unavailable 不阻断 local runtime”降级语义，但不得吞掉 default Web/local auth/task registration failure。
   - 输出：host preparation消费的 factory set、scripts/prefixes和单个 workbench contribution；不返回 root state或 lifecycle owner。

5. **Test host — `composition/create-test-composition.ts`**
   - 输入：完整 `NextAgentTestAppOptions`。
   - 流程：建立 test credential/isolation → 构造 validated isolated config/default Agent → 投影 deterministic model/observation capture/local gateway defaults和显式 overrides为普通production input → 选择 default Web 或 `LOCAL_CONFIGURED_AUTH` profile → 调用同一sync或async runner → capture map/test lifecycle registration。test host不构造`PreparedCompositionInputs`。
   - 输出：完整 product app。test host 不调用任何 module composition entry，不创建 server registration、不拥有 product rollback；test cleanup 只针对成功返回的 app和测试临时路径。

6. **Public testing facade — `testing.ts`**
   - 输入：production options加 test-only `channelPort`/`observationLogger`，或完整 test-host options。
   - 流程：只构造 test projection/writer wrapper → 调用 product或 test host runner → register test lifecycle。
   - 输出：testing API；不得把 test-only fields加入 production public/prepared contract。

7. **Thin launchers — `entrypoints/backend-only.ts`、`entrypoints/local-configured-auth.ts`、with-frontend executable main**
   - 输入：CLI/process-level profile选择和可选 config locator。
   - 流程：调用唯一公开 factory → `await app.start()`。
    - 输出：运行服务。launcher 不拥有 composition failure cleanup；统一 start-failure close policy继续 deferred。local/remote runtime package另按 package host contract处理 start evidence/close。

8. **Local gateway public facade — `packages/agent-platform-gateway-local/src/entrypoints/local.ts`**
    - 输入：标准`CreateNextAgentAppOptions`。
    - 流程：只对cron/sandbox/maintenance/RAG/background/gateway providers/SkillHub固定字段应用“explicit override优先，否则local default” → 调用一个sync或async agent-app public factory → executable path调用`app.start()`。
    - 输出：原有`NextAgentApp`与`localGatewayCompositionDefaults(...)` public helper；这是agent-app边界外的受控public-options adapter，不读取config、不调用module entry、不拥有server/rollback，也不形成第二个core。

9. **Local gateway testing facade — `packages/agent-platform-gateway-local/src/testing.ts`**
    - 输入：现有production/test options。
    - 流程：应用同一local default precedence → 包装gateway providers以捕获audit → composed testing path补默认in-memory metrics → 调用agent-app testing/product facade → 仅对成功返回app登记capture map。
    - 输出：现有testing APIs、audit/metric readback；不得改变37字段test projection或复制product/test core。

10. **External remote host — `packages/agent-remote-deployment/src/index.ts`**
    - 输入：remote package/deployment facts与remote adapter contribution。
    - 流程：构造窄remote contribution → 调用一个public product factory → 保留现有start/stop/evidence。
    - 输出：既有remote host结果；不解释agent-app module order或composition rollback。

11. **Root process host — `src/main.ts`**
    - 输入：process start flag与默认async product factory。
    - 流程：创建app → 安装uncaught/unhandled fatal boundary → 条件调用`app.start()` → start failure时安全记录、`app.close()`并设置退出状态。
    - 输出：进程运行/退出语义；这是process reliability owner，不套用thin launcher的deferred start-failure close规则，也不参与composition rollback。

12. **Local dev host — `scripts/start-dev-backend.mjs`**
    - 输入：开发启动环境。
    - 流程：动态取得固定local gateway/workbench contribution → 构造一份标准public input → 调用一个async product factory → `app.start()`。
    - 输出：现有local开发服务；不加载第二个config state、不编排module order。

13. **Workflow demo host — `scripts/start-demo-workflow-server.mjs`**
    - 输入：test config/model/workflow override。
    - 流程：调用testing composed facade → 在`app.start()`前添加既有CORS `onRequest` hook → 注册SIGINT/SIGTERM close → start。该hook不新增产品route/plugin，也不改变channel auth/route precedence。
    - 输出：现有demo CORS、workflow mock与signal shutdown行为；不得在start后补产品registration或形成第二个core。

### 5. 只保留五类真实 typed deferred binding

`createCompositionDeferredBindings()` 固定承载：

- lifecycle hook invocation target；
- workflow capability invocation；
- workflow runtime adapters；
- runtime subagent execution；
- background runtime timeline。

每个字段只暴露 typed proxy/lookup 与单次 `bind...Target()`。任一 target 的重复绑定均安全失败。未绑定语义按既有 contract 固定：lifecycle hook invocation 返回 `{ status: "CONTINUE", boundary }`；workflow capability invocation、workflow runtime adapters 和 runtime subagent execution lookup 返回 `undefined`，由实际必需消费者 fail closed；background runtime timeline 的 event emission 直接返回 typed failure。普通上游结果必须通过参数传递；不得新增第六类 field，除非先在本 change 的 design/spec 中证明重排不能消除循环。

### 6. Failure scope 是有意且受限的可靠性修正

新增 app-private `composition-failure-scope.ts`，只记录 `{ stage, cleanup }`，不保存服务、配置或 token。它覆盖本次 composition 已创建，或按既有成功路径 contract 已接受为 app-owned、但尚未 commit 给最终 app lifecycle 的全部 closable resource。是否 injected 不是唯一判断；以当前成功 app `close()` 是否拥有该 handle 为准。既有 caller-owned injection 不得登记，也不得因本 change 改为 app-owned。`composeAppLifecycle(...)` 的每个input都必须进入下表；新增input若未同步分类，compile-time completeness map和architecture test必须失败。

ownership 固定如下，实施不得按“是否 injected”临时判断：

| fact/handle | runner 接受前 | runner 接受后、commit 前 | commit 后 |
|---|---|---|---|
| injected 或 preparation-created `operationalLogWriter` | host 自建时仅负责调用 runner 前失败；通常由 preparation 创建 | app-owned，立即登记 close；host catch 不再关闭 | app lifecycle flush/close |
| injected 或 preparation-created `metricsInfrastructure` | 同上 | app-owned，登记 forceFlush/shutdown；raw `metricsRegistry` 本身不登记 | app lifecycle flush/shutdown |
| raw `metricsExporter` | caller-owned input；尚未形成 infra 时无 app cleanup | preparation 创建的 metrics infrastructure 接管 exporter-associated lifecycle，只登记 infrastructure | infrastructure shutdown |
| injected trace projector / completed projector host | raw projector在 completion 前按其既有 contract处理；没有 close contract则不伪造 cleanup | completion返回的 projector host为 app-owned并登记 | app lifecycle close projector host |
| injected 或 selected `gatewayBindings` | host 自建时仅负责 runner 调用前失败 | app-owned并登记 bindings close；provider definitions/factories不登记 | app lifecycle close bindings |
| scheduled maintenance、cron scheduler、trajectory worker、memory aging/extraction schedulers | module构造中途由本entry清未交接部分 | 完整result返回后立即按每个handle登记`stop`；尚未`app.start()`也按既有`app.close()` contract执行 | app lifecycle按既有顺序stop |
| RAG retrieval/governance、cron store、request runtime、Fastify server、cron callback registration | module 构造中途由本 entry清未交接部分 | 完整 result 返回后立即登记各自具名cleanup；RAG retrieval的cleanup/close保持既有相对顺序 | app lifecycle按既有顺序关闭 |
| runtime logger provider binding | preparation构造失败时由本entry unbind未交接binding | binding完整返回后立即登记`unbind` | app lifecycle最后unbind |
| capability subsystem、Web/task registration readiness、RAG build callable、system config | 无close contract或纯fact | 不登记cleanup；只作为startup/readiness输入 | app lifecycle只调用validate/ready/build/read，不关闭 |
| model service、provider definitions/factories、metrics registry、identity/credential resolver、test sinks、channel contribution callback | caller-owned且无 app close contract | 不登记；只作为依赖使用 | caller继续拥有；app不新增 close |
| workbench read port/contribution | local adapter构造中途遵守 owner factory contract | 当前没有独立 lifecycle handle，不登记；未来若 owner返回 close handle必须先更新本 design | 不由 app凭推测关闭 |

`composeAppLifecycle(...)` 当前21个input的compile-time completeness分类固定如下；字段名按实际input逐一列出，不允许只用类别名称替代：

- app-owned cleanup：`scheduledMaintenance`、`cronTaskScheduler`、`taskTrajectoryWorker`、`memoryAgingSchedulers`、`memoryExtractionSchedulers`、`cronTriggerCallbackRegistration`、`runtime`、`server`、`projectorHost`、`ragRetrieval`、`ragKnowledgeGovernance`、`gatewayBindings`、`closeCronTasks`、`operationalLogWriter`、`runtimeLoggerProviderBinding`、`metricsInfrastructure`；
- start/readiness-only，无独立cleanup：`capabilitySubsystem`、`webChannelRegistration`、`taskChannelRegistration`、`ensureRagKnowledgeBuilt`；
- pure frozen fact，无cleanup：`systemConfig`。

optional field缺省或数组为空仍算已分类，不登记空cleanup；存在值或数组元素时按其现有close/stop/unbind contract逐项登记。该列表由类型级`Record<keyof AppLifecycleCompositionInput, OwnershipClass>`或等价exhaustive mechanism表达，字段增删必须编译失败并同步design/spec/tasks。

host 在调用 runner 前创建 app-owned handle时必须使用局部 try/finally保证“未被 runner 接受则由 host清理”；一旦调用进入 runner，ownership acceptance 即完成，之后 host 不得在 composition catch 中重复关闭。execution runner必须对已接受的 injected app-owned handle和本次创建的 handle同策登记。

规则如下：

- 恰好一个 app-private sync runner 和一个 app-private async runner 可在调用对应 preparation 前创建 scope；当次调用链只能进入其中一个，并在整个 preparation/core 及 optional with-frontend finalization 期间持有该唯一 scope。public/host/test facade 不创建scope。scope 不进入 `PreparedCompositionInputs`，只作为 root control object 显式传给 preparation 和 `composeNextAgentApp(...)`。
- 创建资源的模块在自身构造中途失败时清理本阶段未交接部分；完整 result 返回后由 root 立即注册具名 handle。既有 app-owned injected handle 在 ownership acceptance 点登记；caller-owned handle 不登记。登记集合必须与`composeAppLifecycle(...)` completeness map一致，包括scheduled maintenance、cron scheduler、trajectory worker、全部memory schedulers和runtime logger binding，不得只覆盖server/gateway/observability。
- preparation 创建资源后立即登记；若某个 preparation entry 在完整 handle 登记前失败，只清理该 entry 内尚未交接的部分。shared core 接收同一 scope，只登记后续模块返回的完整 handles，不创建第二个 scope。
- `composeNextAgentApp(...)` 不捕获 composition error，也不执行 commit 或 rollback；它只在 lifecycle handles、完整 `NextAgentApp` 和safe host facts已构造后返回`ProductCompositionOutcome`。sync runner 收到outcome后直接`commit()`并由public facade投影app；async runner仅在持有`ProductHostCompositionInput`时先用`outcome.app`执行`await completeWithFrontendProductComposition(...)`，然后调用一次`commit()`。任何public facade都只在runner commit后把app返回调用方，local package private path只在commit后取得outcome。
- sync runner 在统一 catch 中调用 `rollbackSync()`，按逆序触发 best-effort cleanup 后抛出原始 safe startup failure；若 cleanup 返回 thenable，`rollbackSync()` 必须立即附加 rejection handler，避免 unhandled rejection，但不承诺等待 settle。async runner 在统一 catch 中 `await rollbackAsync()`，按相同逆序逐项等待 settle 后抛出同一个原始 safe startup failure。
- cleanup 至多一次；未到达阶段不注册；cleanup error 不覆盖原始 safe failure，也不泄漏路径、credential、raw provider error。
- `commit()` 只能由当次唯一 execution runner 在 channel/cron registration、lifecycle、完整 `NextAgentApp` 和 optional with-frontend finalization 全部完成后执行；之后正常 close ownership 完全属于既有 app lifecycle。with-frontend 不得在 commit 后追加 hosting registration。
- scope 不定义 retry、timeout、cancellation、`app.start()` failure rollback 或 owner cleanup policy，不启动 worker/scheduler/job，也不改变成功启动和正常 shutdown 顺序。

该行为是 proposal 声明的第一项可靠性修正。第二项是 background runtime timeline 未绑定调用 fail-closed；除此之外不引入其他行为变化。

### 7. Architecture guard 保护边界，不锁死私有实现形态

architecture/dependency rules 验证：

- `create-app.ts` 是唯一跨不同 module composition entry 的 value orchestrator；只存在一个sync runner和一个async runner，两者都调用同一`composeNextAgentApp(...)`；只有async runner可在core后对具体`ProductHostCompositionInput`调用唯一typed host finalizer，不得自行编排其他模块；
- public/host/test facade与恰好两个runner可接收并原样传递完整public options，但只有preparation可逐字段解释production fields；只有 shared core 可以引用并整体接收 `PreparedCompositionInputs`，模块 entry 不引用完整 options/prepared root type，且不存在第二个同形 root input；`PreparedCompositionInputs`和core不得出现`hostKind`、`testMode`、`LOCAL | REMOTE | TEST`或等价宿主分支；
- 四个public factory以及local-auth、with-frontend、testing、local/remote adapter都是facade；每条public/package/test调用链必须恰好抵达一个app-private runner和一个scope，不得通过public-facade-to-public-facade delegation形成嵌套runner、重复preparation或第二个scope；
- guard 的 production/test/host surface discovery 覆盖整个 `packages/agent-app/src`，并对决策1.1列出的local gateway public/testing facade、remote deployment、root process host和两个script host执行定向规则；不能只扫描 `composition/` 或维护 21/67 文件 allowlist。任何新增的完整options解释、app factory调用、provider/default selection、server/plugin/hook registration、closable handoff、profile选择或test product-input assembly都必须归入决策1.1的一个surface并满足对应限制；
- `create-local-configured-app.ts` 只允许选择固定channel auth profile、创建/选择不捕获options/config/server的typed local-auth contribution并转交原 options/model/provider；不得 rest-spread/copy/capture options、读取 auth config、直接调用 `registerWebChannel`/`server.register` 或捕获 composition rollback。`local-configured-auth-channel-contribution.ts`是agent-app中唯一允许静态import local-auth package的文件，且不得接收完整options或调用app factory；shared channel、generic core、backend-only和with-frontend均禁止该依赖；
- `entrypoints/with-frontend.ts` public facade只读取 host fields并投影typed host input，不创建runner；executable main不得动态构造 local gateway defaults。唯一async runner的唯一 finalizer以外，所有 host/facade/core/module path禁止 post-core registration；
- `local-runtime-package/index.ts` 只允许 package preflight、已冻结的writer→optional OTLP trace bootstrap、evidence/dispatch/start-stop编排；LOCAL dispatch必须复用同一个prepared config result，禁止再次读config、直接构造product model/通用observability/gateway selection、从public app重建gateway evidence，或在runner接受后重复关闭app-owned handle。它只通过private outcome消费safe gateway readiness/reporter；`local-runtime-bindings.ts`只允许导出固定local factory/workbench contribution，不调用app factory或管理rollback；
- `create-test-composition.ts` 可以解释完整 37 字段 test options并构造 isolated test projection，但只允许投影为普通 product input 并调用同一 sync 或 async runner，不得直接构造prepared root、value-import/call module composition entries、复制 product config loader/channel registration或持有 failure scope；`testing.ts` facade可以投影 `channelPort`、`observationLogger` 和 lifecycle registration，但不得拥有第二个 preparation/core/module order；
- backend-only、local-configured-auth 和 with-frontend executable launcher只允许 factory调用与 `app.start()`，禁止 app config读取、provider/default construction、server/plugin registration和 composition rollback；package host按单独规则检查；
- local gateway public facade只允许固定字段default projection并保持explicit override优先；其testing facade只允许相同defaults、audit/metric capture和成功app关联。root process host保留fatal boundary与start-failure close；dev host保留一次local contribution投影；workflow demo只允许在start前添加既有非产品CORS hook。四类external surface均禁止module entry调用、第二个config/core或composition rollback；
- `configuration-composition.ts` 是唯一 config evaluate/ready/environment projection 入口，其他 composition entry 不读 config source/`process.env`；
- 每个 module responsibility 只有一个 root 可调用的权威 entry family；私有 helper 可由同模块 entry 使用，但不能被 root 或其他模块当作竞争入口；
- module 不反向 import root，不 value-import其他模块的 composition entry；config/gateway selection 等真正共享纯函数放在非 composition helper；
- cron deployment selection 只能由 preparation 通过 `config/gateway-selection.ts` 投影；root/startup contribution 不得调用 `validateCronRuntimeComposition` 或同义 standalone prerequisite validator。architecture guard 必须发现 exported cron preflight、root-side credential/registration/scheduler 检查，或 capability entry 接收 server/credential/registration 等 runtime-only input；module-private branch prerequisite helper 合法；
- deferred holder 只有固定五类字段；通用 DI/container/service locator、字符串 token、动态 service registry 和第二套 config DTO 被拒绝；
- product host 可以准备窄 Web/local/task contribution；shared core 返回后只允许唯一async runner在持有with-frontend typed host input、scope 未 commit、app 未公开时调用唯一 typed async host finalizer。其他产品宿主、sync runner、facade、module entry 以及 commit/public return 后的任何路径不得调用 `server.register(...)` 或形成第二条 registration/cleanup 路径；workflow demo的既有pre-start CORS hook按决策4.2单独验证，不得注册产品route/plugin；
- 当次唯一sync或async runner是 composition failure scope 及 commit/rollback policy 的唯一 owner；public/host/test facade、preparation、shared core 和 module entry 不创建竞争 scope，不 commit，也不执行 sync/async policy 选择。
- `ProductCompositionOutcome`只允许shared core/package-private runner/local package private start引用；public exports和`NextAgentApp` shape不得出现`hostFacts`。`composeAppLifecycle(...)` input completeness map必须覆盖每个closable/start-only/pure fact分类，新增未分类input时失败。

guard 不维护要求每个模块恰好一个物理文件的静态 allowlist，不断言私有 helper 名称、模块内部调用数量或顶层 `compose*` 数量。它通过职责信号发现新增 surface，并对已分类 host/test/package/launcher路径执行不同约束；已有内聚模块由行为测试和依赖方向保护。

### 8. Product input/output 与功能防丢映射

public options 和 app-private host contribution 必须逐字段进入以下唯一 preparation 投影；字段可以在 preparation 中被完全消费，也可以进入列出的 prepared group，但不得遗漏、改名或进入第二个 root state：

| input fact | 唯一处理位置 | prepared/module 消费 |
|---|---|---|
| `serviceVersion`、`metricsExporter` | observability preload | operational writer/metrics infrastructure；不进入 core 时不得残留副本 |
| `credentialResolver`、`identity`、`configFile`、`systemConfig` | identity/configuration preparation | `identity`、`configuration` |
| `model`、`modelProviderKind`、`modelGatewayProviders` | model preparation | `model` |
| `gatewayProviders`、`gatewayBindings`、`sandboxGatewayFactory`、`sandboxGateway`、`scheduledMaintenanceGatewayFactory`、`cronTaskGatewayFactory`、`ragRetrievalFactory`、`clipCommandRunner` | gateway preparation/projection | `gatewayInput` |
| `riskPolicyEvaluator`、`registeredCustomAdapterTypes`、`capabilityProviderReferenceValidation`、`skillHubAccessFactory`、`backgroundTaskStoreFactory`、`cronTaskIdFactory` | capability preparation | `capabilityRuntimeInput`/`configuration` |
| `lifecycleHooks`、`lifecycleHook`、`lifecycleHookDefinitions`、`workflowExecutionServiceFactory`、`workflowExecutionMode`、`workflowRemoteExecutionGateway` | lifecycle/workflow preparation | `lifecycleWorkflowInput` |
| `pluginRegistrySnapshot` 或 frozen plugin config/config root | config后的plugin preload | 唯一frozen `plugin`：hooks → lifecycle，policies → assembly/capability/request runtime，providers → capability，diagnostics → 既有安全诊断/characterization；下游不reload |
| `operationalLogWriter`、`metricsRegistry`、`metricsInfrastructure`、`traceProjector` | observability preload | `observability` |
| `chatUploadFileConfig` | attachment preload | `attachment` |
| public `webChannelRegistration`、`trustedLocalWebExtensionRegistration`、`trustedLocalWebExtensionProtectedPrefixes`、`taskChannelRegistration` | production preparation逐字段投影 | `channelInput`；按Channel precedence matrix消费 |
| frozen cron deployment config、`cronTaskSchedulerFactory`、`cronTriggerCallbackCredentialRef`、`cronTriggerCallbackRegistration` | cron preparation | `cronInput.deploymentSelection: DISABLED | LOCAL | REMOTE` 与分支专属原始输入；preparation 不产生 runtime readiness 结论 |
| `agentDefinition` | assembly preparation | `assemblyInput` |
| with-frontend `productVersion`、`resolveFrontendHostingManifest`、`indexHtmlScripts` 及由 `trustedLocalWebExtensionRegistration` 是否缺省派生的 `useDefaultWorkbenchScripts` | public host projection + async runner finalization | `ProductHostCompositionInput` → commit 前 async hosting registration；不并入 package public app options 或 `PreparedCompositionInputs` |
| local configured auth `channelAuthProfile` + local-only contribution factory | local-auth facade + production preparation | 固定 `LOCAL_CONFIGURED_AUTH`与typed contribution → `channelInput`；facade不读config/capture options，shared channel不依赖local-auth package |
| local runtime package `packageRoot`、manifest/config sample ref、packaged Agent definition、candidate/service version、package hosting kind | package host preparation | 单一 `PreparedLocalRuntimePackageHost` → injected frozen config/assembly、frontend hosting选择、package evidence/start owner；package kind不进入channel profile或`PreparedCompositionInputs`整包 |
| package-specific operational writer、optional OTLP trace projector | local package preflight | writer先创建，trace后初始化，二者作为app-owned injected handles进入runner；generic path缺省时仍由observability preparation选择defaults |
| `ProductCompositionOutcome.hostFacts` | shared core package-private projection | gateway selection完成后产生safe readiness facts；observability completion产生safe start-failure reporter；只供local package private start，不进入public app |
| test basic/config `serviceVersion`、`workspaceDir`、`agentDefinition`、`identity`、`channelPort`、`localAuthEnabled`、`modelProfiles`、`toolDisclosureMode`、`skillDisclosureMode`、`clipcDisclosureMode`、`capabilityProviders` | `create-test-composition.ts` | validated isolated config/default Agent/channel auth profile → production app input |
| test model `modelSteps`、`modelRequestSink` | test host model preparation | deterministic model + request capture wrapper → explicit product model input |
| test observability `operationalLogWriter`、`observationLogger`、`metricsRegistry`、`metricsExporter`、`traceProjector` | test host/facade | observation wrapper或显式 production observability input；ownership按决策 6 |
| test lifecycle `lifecycleHooks`、`lifecycleHook`、`lifecycleHookDefinitions`、`hooks` | test host | production lifecycle/Agent definition projection |
| test gateway/runtime `sandboxGateway`、`sandboxGatewayFactory`、`scheduledMaintenanceGatewayFactory`、`ragRetrievalFactory`、`backgroundTaskStoreFactory`、`riskPolicyEvaluator`、`clipCommandRunner`、`gatewayProviders`、`skillHubAccessFactory` | test host | explicit override优先，否则 local test defaults → production narrow fields |
| test cron `cronTaskGatewayFactory`、`cronTaskSchedulerFactory`、`cronTaskIdFactory`、`cronDeploymentMode`、`cronTriggerCallbackCredentialRef`、`cronTriggerCallbackRegistration` | test host | cron config/default/override projection → production cron fields |

现有系统事实和 public app projection 必须按下表保持；“模块测试通过”不能替代这些跨层事实的 characterization：

| 现有事实 | 目标 owner/路径 | 必须保持的可观察结果 |
|---|---|---|
| active Agent assembly refresh、Agent/Owner Scope、package/workspace locator | assembly | registry refresh 后仍按可信 active definition 校验，scope 和 workspace policy 不漂移 |
| plugin provider/policy/hook activation | plugin → lifecycle/assembly/capability/runtime | required/optional failure、order、activation 和 frozen snapshot 语义不变 |
| model profiles、provider kind、fallback routes、safe diagnostics | model → context/session/runtime | 单一 registry，`productModelProviderKind` 和 profile selection 不变 |
| audit writer、metrics registry/readiness、trace/log projector、operational active identity | observability → channel/lifecycle | `auditWriter?`、`metricsRegistry`、`metricsReadiness()` 和 safe projection 保持 |
| selected gateway stores、fork cleanup、RAG governance/build、scheduled maintenance | gateway → app services/lifecycle | store selection、cleanup job、RAG build gate 和 close ownership 不变 |
| capability/workflow/memory/background/cron availability | capability/memory/background/cron | enabled/disabled/absent projection、catalog/invocation 和 callbacks 不变；cron selection 只在 preparation 冻结，gateway/capability/runtime 各自校验消费输入；仅非法 background early call 改为 fail-closed |
| attachment config、startup temp cleanup、periodic cleanup、execution cleanup | attachment → runtime/channel/maintenance | sync/async preload 差异保持，runtime 与 cleanup owner 不变 |
| session/question/share/context/health | app services | services availability、question association/frequency、context assembly 和 safe health degradation 不变 |
| recovery Agent id、per-process holder id、timeline listeners、subagent target | request runtime | trusted recovery identity、listener effects、tracked commands 和 deferred target 绑定不变 |
| Web/local auth/workbench/task channel、protected prefixes；cron runtime；frontend hosting | channel → cron → async runner typed finalization | route/profile exclusivity、protected prefix、SPA fallback-last、async registration readiness、task→cron→frontend顺序和 server close ownership不变；cron每个单项缺失的既有safe error保持，多项缺失按gateway→runtime、credential→registration顺序失败，未选中分支输入不生效 |
| with-frontend local gateway/workbench defaults、default-workbench script 条件、candidate evidence | product host preparation/entrypoint | injected override 优先级、默认 gateway/factory/workbench、仅使用默认 workbench 时注入其 frontend scripts，以及 profile/package/version evidence 同形不变 |
| local runtime package config/Agent/defaults/evidence | package host → product preparation → package start owner | 每次 direct/dispatch start只读并验证一次 config；active Agent、gateway/workbench、backend-only/with-frontend profile、service version、startup/health evidence和run-state同形；composition failure资源至多关闭一次 |
| test host 37 字段、default config/Agent、isolated sqlite、observation capture、app registration | test host/testing facade | 所有显式 override和default选择保持；`createNextAgentApp`/`createComposedApp`/async/local-configured test APIs、test cleanup tracking和isolation语义不变，不形成第二条产品 pipeline |
| backend/local-auth/with-frontend launcher | entrypoints | factory/profile选择和成功 `app.start()` 保持；不拥有 app construction；start-failure统一 close继续 deferred |
| local gateway public/testing facades | external adapter → agent-app public/testing runner | `localGatewayCompositionDefaults` export、local defaults与explicit override优先级、SkillHub fallback、audit capture、metrics default和readback保持；每次只调用一个runner |
| root process host | process boundary → async product runner | fatal boundary、start-failure safe log、close与exit status保持，不与composition rollback混合 |
| local dev/workflow demo hosts | script host → product/testing runner | dev local gateway/workbench defaults与成功start保持；demo CORS hook、workflow mock、signal close保持，均无第二个core |
| `NextAgentApp` projection | app lifecycle handoff | `server`、`runtime`、`sessions`、`gateway`、`assemblyRegistry`、`auditWriter?`、`metricsRegistry`、`metricsReadiness`、`health`、`modelProfileRegistry`、`capabilityProviders`、`systemConfig`、`productModelProviderKind`、`start`、`close` 同形同义 |

上述映射是任务 1.x characterization、任务 3.x 模块复核和任务 5.x host/core 集成的共同验收基线。任何字段或事实没有明确消费者时必须先修 design/tasks，不得在实现中静默删除。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | identity、Agent Scope、Owner Scope、credential 和 sandbox authority 不变；配置只从可信入口冻结；safe failure/cleanup diagnostics 不泄密。 | config/secret、sandbox/risk-policy、safe failure、architecture negative tests |
| 可靠性/恢复 | 单一配置和 core 消除入口漂移；local package direct/dispatch复用一次preflight和private host facts；五类 deferred binding 拒绝重复绑定，background timeline 非法提前调用及其他必需消费者 fail closed，同时保留既有 optional/default neutral result；cron prerequisite 在真实消费点 fail closed；失败 scope按lifecycle completeness map清理全部未commit的created/app-owned resources，caller-owned injection不越权且host不重复关闭。 | sync/async/package equivalence、cron branch/error-order tests、binding neutral/negative tests、failure/injection ownership、start/close characterization |
| 可维护性 | root 只展示八个宏观层级；channel/frontend/package维度正交；所有真实 module/host/test/package/process/script wiring归入完整surface map；不重写无装配职责的leaf implementation，不增加 layer wrapper。 | source review、module/host/package tests、architecture rules |
| 可测试性 | 保留现有 public input和全部37个test-host inputs；黑盒验证 availability/readiness/lifecycle、正交profile、private host facts和package evidence，source assertion只保护所有权和依赖方向。 | package/contract/kernel/test-host tests、negative fixtures |
| 性能/容量 | 不引入反射、自动图构建或 request-path lookup；新增对象只存在于固定规模启动路径。 | TypeScript build、tests、code review |
| 审计/可追溯性 | 成功路径的operation/audit/metric/log/trace语义不变；合法cron selection可先记录config accepted、再在REMOTE runtime消费点记录同一safe composition failure，这是明确的stage attribution修正；failure cleanup只记录安全stage/reason。 | observability tests、cron failure-stage assertion、safe diagnostic assertions |

## 验证映射（Verification Map）

| 约束 | Tasks | 验证入口 |
|---|---|---|
| 当前功能、public input/output/host/test/package facts、plugin snapshot fan-out 与 sync/async 行为基线 | 1.1-1.5 | characterization、plugin loader/activation、package/contract/kernel/entrypoint/test-host tests、决策 8 映射 review |
| 单一 config 与显式 prepared input | 2.1-2.7 | config/preparation/local-package tests、type/source guard |
| 所有真实 module/host/test/package/process/script wiring归位且leaf不误改；cron selection/gateway/capability/runtime prerequisite分层唯一 | 3.1-3.23 | 对应 module/host/test tests、cron branch/error-order/source negative tests、surface inventory/diff review |
| 每个权威模块或host entry具有 4.1/4.2 定义的连续内部流程 | 2.1-2.7, 3.1-3.23 | normal/optional/failure tests；逐surface flow review |
| 五类 deferred binding | 4.1-4.2 | unit/negative tests |
| 受限 failure cleanup | 4.3-4.5 | lifecycle-input completeness、runner-owned scope、failure injection、order/once、sync/async rollback tests |
| 八层唯一 root pipeline、private outcome、host-agnostic core、恰好两个runner、完整host/test/package接入与commit前typed finalization | 5.1-5.8 | composition/entrypoint/package/test-host integration、host facts、frontend registration failure/order、architecture guards |
| 外部行为和核心边界不变 | 6.1-6.3 | full backend/OpenSpec gates、semantic review |

## 增量实施顺序（Incremental Delivery）

1. 确认 `add-ts-runtime-operational-log-hardening` 与 `add-otlp-trace-export` 的实现已完成并形成稳定基线、剩余工作仅为验证/归档收尾且不会再并行修改重叠装配路径；在其最终代码上固化 normal/boundary/failure/start/close、public input/output、全部 37 个 test-host inputs、package host、external host、launcher、registration 和 sync/async 等价行为。
2. 由唯一sync runner和唯一async runner建立当次唯一 failure scope，按config → plugin snapshot load/validation/freeze → host defaults/remaining preload顺序收敛plugin/observability/attachment/model/host preparation，并建立字段固定的 prepared input、plugin snapshot消费映射与资源ownership characterization。
3. 按模块移动 `composeBoundApp()` 中仍直接存在的 factory、callback、observer、job 和 branch；同时按决策 1.1 收敛 local-auth typed contribution、with-frontend main、local runtime package、local bindings和test host中真实 wiring，并对local gateway、remote、process、dev/demo host做窄接入或characterization。先让 preparation冻结cron deployment selection、gateway/capability/runtime entry具备最终消费点校验，但暂不删除root早期cron validator；没有 root/module/host/test/package装配职责的文件不改。
4. 集中 background timeline deferred binding，并加入受限 failure scope；完成server、cron scheduler/callback registration及其之前所有app-owned handle的失败登记与逆序、至多一次rollback验证。
5. 在任务4的failure scope证据成立后，删除root早期cron validator及exported standalone entry，把 `composeBoundApp()` 收敛为八段 `composeNextAgentApp()`；返回package-private outcome并保持public app projection；把 local auth/Web/workbench/task registration纳入 channel stage，把 frontend hosting限定为commit前finalizer，把local package限定为一次preflight + 同一runner + safe host facts，并升级职责型architecture guards。
6. 运行完整门禁和模型语义 review，逐项对照 surface inventory、37字段映射和ownership table确认没有遗漏。

本 change 不需要数据、配置或部署迁移。每一步都保持 public contracts 不变，并可按模块独立回滚。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-backend-architecture/spec.md`：合并修改后的 `[TS] App Composition Root 三职责边界`。
- `openspec/designs/architecture/ts-backend-architecture.md`：提炼唯一八层 pipeline、显式依赖、sync/async shared core、deferred binding 和 failure resource ownership。
- `openspec/designs/modules/agent-app.md`：提炼配置入口、模块权威 composition entry、product/test/package host surface、launcher边界、37字段映射、资源 ownership、prepared input 边界和验证关注点。
- `openspec/overview.md`、`openspec/designs/adr/`：无更新。
- `openspec/designs/spec-to-design-map.md`：只核对既有导航，无变化时不修改。

## 待确认问题（Open Questions）

无。宏观层级、完整装配 surface、local package一次preflight、product/test host边界、launcher边界、prepared input字段组、37个test-host inputs、五类循环、逐资源ownership、受限failure cleanup和验证路径均已确定。
