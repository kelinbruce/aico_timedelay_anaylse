## 设计范围

| Function | 本次目标变化 | delta spec | 主要 owner |
|---|---|---|---|
| `FN-10.31 验证系统集成` | TestClaw 独立执行 122 个系统集成与 E2E 用例并输出统一证据 | `ts-system-integration-validation-gate` | `tests/TESTClaw` |

本 change 只设计测试基础设施和用例，不改变产品行为、public contract 或 release verdict。唯一实施路径是“版本化 manifest → TestClaw 自有执行入口 → 本次执行结果归一化 → 安全报告”；源码测试只参与 source-checkout 同步校验，不参与候选包 verdict。

## `FN-10.31 验证系统集成`

### 目标 Requirements

- `TestClaw 系统集成清单具有完整且唯一的 activated 范围`
- `TestClaw 验证不依赖源码测试结果`
- `现有场景逐条同步到 TestClaw`
- `三个新增系统集成用例覆盖外部真实边界`
- `五个新增 E2E 流程覆盖跨边界产品路径`
- `Deferred coverage 保持可见但不冒充通过`
- `TestClaw 门禁命令和报告结论唯一确定`
- `系统集成证据不泄漏敏感内容`
- `系统集成结果支持端到端追踪`
- `重复执行不依赖残留外部状态`

### 当前实现

#### 来源用例

当前源码侧形成三组来源：

| 来源 | 数量 | 当前 owner | 当前执行边界 |
|---|---:|---|---|
| 固定后端 gates | 41 | Alpha 7、product-journey 16、security 5、resilience 3、release-package 4、P1/P2 6 | 源码 workspace runner |
| 独立 backend E2E | 49 | `tests/e2e` 的 20 个源测试文件 | 源码 workspace Vitest |
| browser E2E | 21 | `frontend/agent-web/tests/e2e` 的 7 个 Playwright 文件 | 前端源码与 route fixtures |

这些测试是需求和场景发现输入，但不是候选包黑盒验收证据。固定 gate 的 case identity、backend/browser 测试标题和参数化边界将固化为 source manifest；每次 source checkout 校验只检测漂移。

#### TestClaw 当前边界

- `tests/TESTClaw` 已是候选二进制包黑盒框架，默认候选根为 `tests/TESTClaw/target`，也接受 `NEXTAGENT_PACKAGE_ROOT`。
- 当前 `tests/TESTClaw/tests/suites` 中的其他用例不等于本 Function 的 122 个目标场景。
- Vitest 发现 `tests/suites/**/*.test.ts`；Playwright 从 `tests/suites` 发现非 `.test.ts` 场景。
- TestClaw 当前 dev dependencies 只有 Vitest 和 Playwright，没有可用于外部 consumer declaration build 的固定 TypeScript/Node type toolchain。
- 当前 TestClaw 文档中的部分文件/断言数量已经与可执行目录漂移；本 change 只为新 Function 建立机器清单，不以文档计数代替执行事实。
- 候选运行包包含本地 runtime 依赖闭包，但 remote deployment 和全部远端 package artifacts 不保证在候选根中，因此新增集成用例需要第二个显式输入根。

#### 外部边界现状

| 边界 | 已有证据 | 缺口 |
|---|---|---|
| remote deployment/public exports | source guard、package tests、组合测试 | 无外部 ESM consumer 对 packed artifacts 的独立证据 |
| remote gateways | 注入 client/fetch fixtures 的 adapter tests；稳定 remote Workflow 契约已定义 schema、scope、`inputText`/`inputVariables`、pending input、cancel 和 safe error | 无真实 loopback server 联合验证上述边界的证据 |
| SkillHub | 稳定契约已定义 remote content normalization、下载前 hash、staged validation、provider-neutral installed facts、catalog source metadata 和 governed resource projection | 无真实 HTTP 下载到受控文件系统并闭合后续执行的独立组合证据 |
| remote 产品流程 | Fastify injection 或局部组合 | 无候选进程 HTTP/SSE 主链和真实外部边界 |
| 三种浏览器宿主 | route fixture UI 测试 | 无三宿主连接同一真实候选后端的 canonical truth 证据 |
| 性能与容量 | `ts-performance-test-gate` 已独立定义 Submit/Cancel/Retry、Lane 和 TTFT 门禁；其他系统级容量目标仍分散或未定义 | performance verdict 属于独立 gate，不得复制为本 Function 结果；未定义范围不得生成占位 case |
| 本地 operational diagnostic | 稳定日志契约允许受控本地 Tool/执行异常诊断，并禁止向 public/observation/audit/metric/trace 边界扩散 | TestClaw 尚未区分 restricted diagnostic root 与可导出 evidence root |

### GAP

| 目标 | 当前事实 | GAP |
|---|---|---|
| 122 个 activated 用例可独立执行 | 114 个来源场景分散，8 个新场景不存在 | 缺少 TestClaw manifest、用例实现和统一 runner |
| 来源与 TestClaw 一对一 | 没有 source identity 到 TestClaw execution 的映射 | 缺少唯一映射与漂移校验 |
| 不依赖源码结果 | TestClaw 与源码测试分别执行 | 缺少显式 negative gate 防止读取源码报告、private/testing imports、skip |
| 两类 package 输入明确 | TestClaw 只有候选运行包根 | 缺少 external packages root 及 preflight |
| 统一安全报告 | 既有 runner/report shape 不统一 | 缺少 122 结果归一化、确定性 verdict 和 evidence 安全扫描 |
| 失败后可重跑 | helpers 各自清理 | 缺少本门禁 run scope、进程登记和 finally cleanup |

### 修改方案

#### 1. TestClaw 单一 owner 与目录

```text
tests/TESTClaw/
├─ testcases/add-ts-system-integration-validation-gate/
│  ├─ 122个独立验证用例清单.md
│  ├─ e2e-test-analysis.md
│  ├─ 系统集成验证用例.md
│  ├─ E2E生成逻辑分析.md
│  ├─ E2E用例推导方法论.md
│  ├─ E2E用例源码依赖关系.md
│  ├─ 模块不可测节点总表.md
│  └─ specs/                         # 设计骨架，不被 runner 发现
├─ tests/suites/add-ts-system-integration-validation-gate/
│  ├─ case-manifest.ts
│  ├─ source-sync/
│  ├─ integration/                    # TC-SI-112..114，一 case 一文件
│  ├─ e2e/backend/                    # TC-SI-001..090、115..118，一 case 一文件
│  ├─ e2e/browser/                    # TC-SI-091..111、119..122，一 case 一文件
│  └─ helpers/
└─ scripts/run-system-integration-gate.mjs
```

`tests/TESTClaw/package.json` 新增唯一公开命令 `test:system-integration`；Vitest/Playwright 定向执行命令作为 runner 私有实现。根 workspace 不新增平行 runner。

#### 2. 两个显式输入根

| 输入 | 解析规则 | 用途 |
|---|---|---|
| candidate root | `NEXTAGENT_PACKAGE_ROOT`，缺省 `tests/TESTClaw/target` | 本地候选进程、frontend artifact、候选文件系统 |
| external packages root | `NEXTAGENT_EXTERNAL_PACKAGES_ROOT`，无缺省 | 只读安装根；必须含 remote package public artifacts 及 `dist/dev/agent-web-test-hosts` 的公开 hosting export。后者只承载 local dev/test 入口；正式候选前端仍只含 immersive `index.html` 与 collaborative PIU assets |

runner 在执行前只读校验 manifest、package exports、声明文件和可执行入口。缺失输入不改变产品打包，也不从源码 workspace 回退解析；受影响 case 记录 `UNAVAILABLE`。

TestClaw 自身新增固定版本的 `typescript` 和匹配 Node LTS 的 `@types/node` dev dependencies，作为外部 consumer 的验证工具链。consumer 在临时根中创建，在 Windows 以 directory junction、其他平台以 directory symlink 只读关联 external packages root 的 `node_modules`；不得联网安装，也不得向 external packages root 写入文件。无法建立隔离关联时 `TC-SI-112` 为 `UNAVAILABLE`。

仓库命令 `npm run build:testclaw-host-artifact` 生成 `@nextagent/agent-web-test-hosts`。该 package 只导出 hosting manifest 和闭合 local browser bundle，TestClaw 通过其 `./hosting` public export 装载；它不进入 `@nextagent/agent-web` 正式 artifact，不改变正式 hosting manifest，也不把 source/Vite dev server 带入独立候选执行。`TC-SI-094` 与 `TC-SI-119` 同时声明 candidate 和 external-packages 输入；缺少该 artifact 时不得回退源码。

#### 3. 122 用例 manifest

TestClaw 私有 `TestClawSystemIntegrationCaseDefinition`：

| 字段 | 类型 | 规则 |
|---|---|---|
| `caseId` | `TC-SI-${number}` | 恰好连续 `001..122`，唯一 |
| `title` | string | 非空、安全 |
| `layer` | `INTEGRATION \| E2E` | `112..114` 为 INTEGRATION，其余为 E2E |
| `originKind` | 固定五值 enum | 与编号范围一致 |
| `sourceCaseRef` | string | `001..111`、`120..122` 指向来源文件+case identity；`112..119` 指向本 change Requirement/Scenario |
| `ownerGate` | string | 执行 owner 固定 `testclaw-system-integration`；来源 gate/file identity 由 `sourceCaseRef` 表达 |
| `featureRefs` | string[] | 至少一项 |
| `functionRefs` | string[] | 至少一项 |
| `requirementRefs` | string[] | 至少一项 |
| `externalDependencyRefs` | string[] | 唯一、有序；不适用时为空数组 |
| `executionRef` | string | TestClaw 内唯一，格式为相对 suite 文件路径加顶层测试标题，二者均包含同一 `caseId` |
| `requiredInputRoots` | string[] | 唯一、有序，值只能是 `candidate`、`external-packages`；每个 E2E 至少含 `candidate`，每个 integration 含 `external-packages` |

`DeferredCoverageEntry` 与执行清单分离，只包含逻辑 id、stage、owner、安全原因和重新准入条件，不具有 `executionRef`。

上述 case definition 的所有字段均为 required、non-null、无默认值，数组至少一项且冻结；`externalDependencyRefs` 不适用时是唯一允许的空数组。可信来源只有 TestClaw 版本化 `case-manifest.ts`，owner 是本 Function runner。runner 在启动任何进程前做 runtime validation，并拒绝未知字段、重复数组值、非法 enum、绝对路径、case id 与 executionRef 不一致以及分组计数不匹配。`DeferredCoverageEntry.stage` 只能是 `PLANNED` 或 `EXCLUDED`，其逻辑 id 不得匹配 `^TC-SI-\d{3}$`。

编号和层级固定：

| 范围 | originKind | layer | 数量 |
|---|---|---|---:|
| `001..041` | `FIXED_GATE` | `E2E` | 41 |
| `042..090` | `BACKEND_E2E` | `E2E` | 49 |
| `091..111` | `BROWSER_E2E` | `E2E` | 21 |
| `112..114` | `NEW_INTEGRATION` | `INTEGRATION` | 3 |
| `115..119` | `NEW_E2E` | `E2E` | 5 |
| `120..122` | `BROWSER_E2E` | `E2E` | 3 |

#### 4. 现有 114 个场景的同步策略

每个 `TC-SI-001..111` 和 `TC-SI-120..122` 在本 Function suite 中拥有一个单 case 执行文件。文件重新表达来源场景的公共入口、前置条件、可观察断言和失败边界，并只通过候选包黑盒边界执行。它可以调用 TestClaw 既有 helper 降低重复 setup，但不得调用其他用例、读取其他 reporter result 或共享 verdict。

映射必须是双射：

```text
sourceCaseRef (1) ──> caseId (1) ──> executionRef (1) ──> current result (1)
```

不得让多个来源场景共享一个执行结果，也不得通过一次宽泛 smoke test 给多个 case 同时报 `PASSED`。可以共享进程 fixture，但每个 case 必须有独立文件、断言、结果和 evidence。该目录和文件规则消除“复用其他 case 或另建 case”的实施选择，是本 change 的唯一落地路径。

source-sync 校验从版本化 source manifest 对照仓库测试文件和标题。它只在源码 checkout 的维护 CI 中运行，用于发现来源增删/重命名/参数化边界漂移；独立候选运行不访问源码，直接执行已版本化的 122 manifest。

#### 5. 新增三个系统集成用例

- `TC-SI-112` 在临时 consumer project 中安装/链接 external packages root 的 packed artifacts，运行 TypeScript ESM build 和 Node import，只允许 package exports。
- `TC-SI-113` 在随机 loopback 端口启动 sandbox、RAG、Workflow RAG、问题推荐响应器，通过 public remote gateway APIs 验证正常、非法 schema、远端失败、取消、trusted scope/correlation 以及 Workflow `inputText`/`inputVariables` 分离；不使用 adapter-private fixture。
- `TC-SI-114` 启动真实 SkillHub loopback HTTP，向隔离 Skill root 下载 package，先校验 hash，再规范化 archive/folder 并校验 staged folder，最后原子提交 provider-neutral installed fact；非法 entry、hash 不匹配、取消、错误响应和失败替换均不得发布半成品或破坏先前已提交 Skill。用例结束删除安装根。

#### 6. 新增五个 E2E 流程

- `TC-SI-115`：候选 remote deployment 进程 + HTTP/SSE session/request/history。
- `TC-SI-116`：电信诊断请求 + loopback RAG/sandbox + terminal/history/audit 安全一致性。
- `TC-SI-117`：SkillHub HTTP 获取 + staged 安装 + catalog source metadata/localized display name 可见 + governed Skill disclosure/resource projection + 后续候选请求执行；`SKILL.md` 正文不得进入模型可读资源投影。
- `TC-SI-118`：非法响应、远端失败、超时、主动取消四个分支，各自产生至多一个安全 terminal，并保持取消传播、stream 与 history/replay 一致。
- `TC-SI-119`：TestClaw Playwright 通过 external local test-host public artifact、候选 immersive artifact 和候选 collaborative PIU 依次运行三种宿主，连接同一候选后端，比较 canonical session/stream/pending/active-run replay/refresh 结果；宿主 UI 布局差异不参与业务事实比较。

#### 7. 当前稳定规格追踪

新增场景不得在 TestClaw 中重新定义产品语义。`requirementRefs` 使用下列稳定规格作为产品行为判定来源，并额外引用本 change 中定义 case 范围、结果和 evidence 的 Requirement：

| TestClaw 范围 | 稳定规格依据 |
|---|---|
| `TC-SI-113` | `workflow-remote-execution-mode` 的 Remote Execution Gateway Port、Remote Response Schema Validation、Remote Cancellation Propagation、Remote Scope Integrity、User Input And Recipe Variable Separation |
| `TC-SI-114` | `skillhub-source` 的 normalized Skill folders、provider-neutral installed facts、runtime acquisition consumption、下载包完整性校验 |
| `TC-SI-117` | `skillhub-source` runtime acquisition、`skill-catalog-query` source metadata/localized fallback、`skill-resource-access` governed projection 和 `SKILL.md` internal-body boundary |
| `TC-SI-118` | `workflow-remote-execution-mode` safe error/schema/cancellation，以及 `ts-stream-history-consistency`、`ts-stream-resume-replay` 的 terminal/recovery 一致性 |
| `TC-SI-119` | `ts-web-sse-ws-transports`、`ts-stream-history-consistency`、`ts-stream-resume-replay` 的 transport、history、active-run replay 和 refresh 契约 |
| performance deferred entry | `ts-performance-test-gate`；只证明该范围已有独立 owner，不把其 verdict 复制到本门禁 |
| restricted diagnostic boundary | canonical `runtime-logging`；TestClaw 验证其本地边界时只导出安全判定，不复制原始诊断 |

#### 8. Runner 与结果归一化

runner 执行顺序：

1. 创建 `runId`、隔离 temp/restricted-diagnostic/evidence roots 和进程登记表。
2. 校验 122 manifest、唯一映射和两个输入根。
3. 启动共享候选/loopback fixtures；共享仅降低启动成本，不共享 case verdict。
4. 在固定进程级 deadline 内只执行 manifest 引用且去重后的 Vitest/Playwright 文件；Vitest 固定最多两个 file workers，避免完整候选包复制与只读哈希形成八路 I/O 压力，并为 122-case 规模保留 30 分钟预算。框架 stdout/stderr 只进入有大小上限的内部捕获缓冲，不向调用方透传，超时或输出溢出时 fail closed。
5. 将 reporter 输出按 `executionRef` 归一为恰好 122 个结果；无结果记 `MISSING`，skip/todo 记 `FAILED`；每个 `PASSED` 结果必须解析到本次 output root 下唯一且内容匹配的 `cases/<caseId>.json`，并使用该相对路径替换框架状态占位引用。
6. 扫描 TestClaw 将要导出的 summary stdout、report 和逐 case evidence，命中禁止内容时覆盖对应用例为 `FAILED`；候选本地 operational log 只在 restricted diagnostic root 原位接受其所属稳定日志契约的断言，不进入通用 evidence 扫描输入。runner 不写外部 stderr，setup 失败也只导出固定安全摘要。
7. 按 `FAILED > TIMEOUT > UNAVAILABLE > MISSING > PASSED` 归并层级和总状态；`layers` 固定为无额外嵌套字段的 `{INTEGRATION: result, E2E: result}`，随后原子写入 report。
8. 在 `finally` 停止本次进程、关闭监听器并删除 restricted diagnostic root 与其他非 evidence 临时根。

报告只记录逻辑引用，不包含 endpoint、credential、绝对路径、prompt、完整模型输出、附件/Skill 正文或 raw exception。`failurePhase` 使用稳定安全 enum，例如 `manifest`、`preflight`、`setup`、`execute`、`assert`、`evidence`、`cleanup`。

restricted diagnostic root 与 evidence root 不得重叠。需要验证本地日志契约的 case 只能在运行期间原位读取候选日志，并把安全 reason code、hash 或 opaque ref 写入自己的 evidence；不得复制原始 `toolInput`、`toolOutput`、`rawExceptionData`、prompt、path、command 或业务内容。候选稳定日志契约允许的内容仅存在于 restricted diagnostic root 时不触发本 Function 的 evidence 泄漏失败；相同内容进入 TestClaw stdout/stderr、evidence 或报告时触发 `FAILED`。

#### 9. Planned/excluded 边界

- `PLANNED`：真实 AICO Service consumer；缺少可执行 artifact 或规格仍未闭合的联合发布流程。
- `EXCLUDED`：由独立 `ts-performance-test-gate` 拥有的性能阈值；没有稳定系统级黑盒契约的容量上限、集群部署和 remote Agent/AgentLink。

deferred entry 出现在 coverage 文档和机器清单，但不进入执行调度、122 结果或 verdict。出现新 artifact 只能触发人工复审，不能自动激活。

### 数据流

```text
versioned 122 manifest
        │
        ├── candidate root ──> candidate process / HTTP / SSE / browser / filesystem
        │                         └── restricted diagnostic root ──> in-place assertions ──> safe hash/ref
        │
        └── external packages root ──> public exports / loopback gateways / SkillHub
                                      │
Vitest + Playwright reporters ────────┘
        │
        v
executionRef normalization ──> exported evidence safety scan ──> report.json + exit code
```

source tests 只流向维护期 `source-sync` 校验，不进入上述独立执行数据流。

### 失败与降级

| 条件 | 结果 |
|---|---|
| manifest 缺号、重号、映射不唯一 | 执行前失败 |
| candidate/external package 输入缺失 | 受影响 case `UNAVAILABLE`，总门禁非通过 |
| 测试无 reporter 结果 | `MISSING` |
| skip/todo/mock/private/testing/source-report 依赖 | `FAILED` |
| case 超时 | `TIMEOUT`，继续收集其他可执行 case |
| Vitest 或 Playwright 进程超过固定 deadline | 该框架受影响用例为 `TIMEOUT`，停止子进程并继续生成完整报告 |
| 框架输出超过内部捕获上限或非零退出且没有可用逐 case 结果 | 该框架受影响用例为 `FAILED` |
| `PASSED` 用例缺少、重复或具有非法 case evidence | 对应用例为 `FAILED`，`failurePhase=evidence` |
| TestClaw stdout/stderr、evidence 或 report 泄漏 | `FAILED`，最终报告不复制原文 |
| restricted diagnostic 被复制到导出边界 | `FAILED`，只保留安全 reason/hash/ref |
| cleanup 失败 | 受影响 case 或门禁 `FAILED`，记录安全 cleanup phase |

不存在把 activated case 静默降级为 planned、把缺失边界标为 skipped，或复用上次报告的路径。

## 验证策略

- manifest contract tests：连续编号、122 总数、3/119 分层计数、origin ranges、executionRef 双射、deferred 隔离。
- source-sync characterization：41、49、24 三组精确来源及总数 114。
- independence negative tests：拒绝源码/private/testing imports、source report、mock target boundary、skip/todo、输入根回退。
- TestClaw target tests：每个 case 先建立缺失执行文件或失败断言，再在本 Function suite 的单 case 文件中实现 114 个同步场景。
- 新增 integration/E2E tests：8 个场景分别覆盖 normal、boundary、failure/cancel。
- report tests：122 结果、状态优先级、evidence safety、双向追踪、连续运行隔离和失败清理；evidence safety 同时验证 restricted diagnostic 中允许内容不被误判、相同内容一旦被导出即失败。
- 验收命令：`npm --prefix tests/TESTClaw run test:system-integration`；源码 checkout 追加 `npm --prefix tests/TESTClaw run test:system-integration:sync`。

## 长期基线刷新计划

归档前同步：

- `openspec/specs/ts-system-integration-validation-gate/spec.md`
- `openspec/overview.md`：补充 TestClaw 独立系统集成质量保证摘要
- `openspec/designs/features/index.md`：刷新 `F-10.8` 的 Function 组成和可依赖质量保证
- `openspec/designs/functions/index.md`：新增 `FN-10.31` 导航
- `openspec/designs/modules/testclaw.md`：补充本门禁的唯一执行 owner、输入和验证入口
- `openspec/designs/architecture/e2e-quality-gates.md`：补充 122 用例门禁与现有源码 gates 的边界
- `openspec/designs/spec-to-design-map.md`
- `docs/NextAgent-function-list.md`：新增 `FN-10.31`
- `docs/NextAgent-feature-list.md`：按权威 OpenSpec 特性树将验证门禁收敛到 `F-10.8`，并关联 `FN-10.31`
- `docs/NextAgent测试特性树.md`
- `tests/TESTClaw/README.md`
- `tests/TESTClaw/testcase-document.md`

ADR：不新增或修改。owner 和执行模式延续 TestClaw 既有候选包黑盒边界，本 change 没有新的产品架构决策。

## 风险与取舍

- 122 个场景独立执行会显著增加时间。通过共享只读候选进程和 loopback fixtures 控制成本，但每个 case 的断言、结果和 evidence 仍独立。
- 来源 browser E2E 依赖 route fixtures，移植到真实候选后端时可能暴露产品 fixture 与真实行为差异；此差异应作为用例失败或新的产品 OpenSpec 输入处理，不得在 TestClaw 内补第二套业务语义。
- 外部 packages root 增加调用方准备成本，但避免为了测试把 remote deployment 强塞入本地候选包，也避免从源码回退，边界更清晰。

## 待确认问题

无。是否将本门禁纳入 release qualification 不属于本 change。
