## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 从单一测试入口运行固定 HarnessBench 基线的全部 task，使用真实模型输出逐 task 结论、框架效果得分和安全证据 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本设计为开发者和质量负责人提供独立于现有 release E2E gate 的外部能力评测路径。该路径必须复用当前 NextAgent 产品入口和 HarnessBench 原生评分，不改变被测生产代码或公共契约。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`评测运行固定版本与任务边界`
- `ADDED`：`全量任务通过真实 NextAgent 产品边界评测`
- `ADDED`：`计分运行验证真实模型调用`
- `ADDED`：`计分运行验证 grader 前置条件`
- `ADDED`：`统一计算逐任务分数与框架效果得分`
- `ADDED`：`评测失败提供安全诊断`
- `ADDED`：`评测基础设施失败有界恢复`
- `ADDED`：`定向回归运行不得计分`
- `ADDED`：`评测报告可追溯且可恢复`
- `ADDED`：`评测报告不泄露敏感信息`

影响实现和验收的边界如下：评测实现只能位于 `tests/harnessbench/**`；运行期缓存与报告位于已忽略的 `test-output/harnessbench/**`；被测 `packages/**`、根配置、产品默认 Agent、公共 API 和 HarnessBench 上游源码保持不变。

### 当前实现

- `tests/harnessbench/` 已具备固定 106 项 catalog、全量入口、HarnessBench `generic_cli` adapter、真实模型 usage 证据、固定分母计分器和双格式报告。
- 现有 `FN-10.8 验证门禁` 和 `tests/e2e/**` 继续验证仓库已定义产品旅程；HarnessBench 保持独立按需运行，不进入默认 release gate。
- `@nextagent/agent-app/local-runtime-package` 公开导出 local runtime package 的 staging、启动和停止能力；实际候选包能够承载独立配置与 Agent package。
- Web channel 已公开 IR Session/Request/SSE 路径：创建 session、提交 request、订阅 stream 并观察 terminal result。该路径无需新增测试专用 API。
- `@nextagent/agent-runtime` 的 public export 包含 execution workspace resolver；现有 E2E 测试已使用可信 Agent Scope、Owner Scope、session id 和 run id 定位每次请求的受控 workspace。
- 产品默认 Agent 没有启用通用文件、shell 和 Python 工具，不能直接承担 HarnessBench 工作区任务；现有 local sandbox gateway 已提供这些工具所需的受控执行边界。
- HarnessBench commit `1025086a446653702b80cfb48babbeec35db6b2c` 包含 `generic_cli` adapter、usage proxy、task oracle、过程评分与安全评分，允许通过外部 CLI 接入且不修改上游源码。
- 当前测试实现已经具备全量入口、候选模型 preflight、固定分母报告和中断恢复，但 grader 仍依赖 HarnessBench 的隐式 `RUBRIC_*`/`OPENAI_*` fallback，报告也不汇总 rubric/process 覆盖。
- 当前失败分类会把大多数异常收敛为 `agent execution failed`，且没有固定定向 regression profile 或只针对零副作用基础设施失败的自动恢复。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 固定版本和任务边界 | 固定 commit、完整 catalog、支持矩阵和不可变 manifest 已成立 | 本增量保持现有行为，只允许定向 profile 引用完整 catalog 中的固定 task id |
| 真实 NextAgent 产品执行 | local runtime、IR API、受控 workspace 和 CLI bridge 已成立 | 失败 terminal 只保留通用文本，无法按安全阶段聚类 |
| 真实模型证据 | candidate preflight 和逐 task usage proxy 已接通 | grader 仍依赖隐式配置，candidate/grader 前置条件没有独立结论 |
| grader 完整性 | 候选模型 preflight 已成立，但 grader 依赖上游隐式环境变量和默认 model | 缺少显式 grader 安全引用、独立预检和 fail-closed 行为 |
| HarnessBench 原生评分与整体框架汇总 | 固定分母和零分规则已成立 | 缺少 rubric/process 覆盖汇总，退化评分仍会表现为可比较总分 |
| 失败诊断与恢复 | 上游结果、adapter stderr 和 terminal 事实可用，但报告只保留通用 reason | 缺少 failure phase/reason code、attempt ledger 和只针对零副作用基础设施失败的有界重试 |
| 安全且可追溯的报告 | benchmark 私有报告、原子写入和敏感字段拒绝已成立 | 缺少评分有效性、失败阶段、原因码和 attempt ledger 汇总 |
| 不修改生产代码 | architecture test 已锁定 `tests/harnessbench/**` owner 与 public import | 本增量继续复用现有 public boundary，不需要扩大到 `packages/**` |

### 修改方案

`tests/harnessbench/` 是本 Function 的唯一实现 owner。所有提交内容使用 Node.js ESM、静态 JSON/YAML 和 Vitest；不在根 `package.json` 增加默认 gate。标准入口为：

```text
node tests/harnessbench/run.mjs
```

唯一端到端路径如下：

```text
run.mjs preflight
  -> 获取或复用固定 commit 的 HarnessBench cache
  -> 读取 full-suite profile，校验其与完整 task catalog 一致并冻结 run-manifest.json
  -> 分别 preflight candidate model 与 grader model；任一失败则 fail closed
  -> 生成 HarnessBench generic_cli 配置
  -> 对 execute task 由 HarnessBench 调用 nextagent-cli.mjs；unsupported task 直接形成零分终态
  -> nextagent-cli.mjs 创建隔离 local runtime candidate
  -> 通过 IR Session/Request/SSE 执行 task
  -> 导出 execution workspace 到 HarnessBench workspace
  -> HarnessBench oracle + proxy rubric 生成逐任务原生分数
  -> report.mjs 汇总 grading coverage；只有完整评分以全量 task 为分母发布 frameworkEffectScore
  -> 原子写入 report.json 与 report.md
```

#### 目录与职责

| 路径 | 单一职责 |
|---|---|
| `tests/harnessbench/run.mjs` | 参数解析、预检、run manifest 冻结、上游全量评测启动、退出码和中断收尾 |
| `tests/harnessbench/nextagent-cli.mjs` | `generic_cli` 的单 task 命令；启动/停止隔离 runtime、工作区桥接、IR 请求和 terminal 等待 |
| `tests/harnessbench/report.mjs` | 读取固定上游结果、应用零分与汇总公式、拒绝敏感报告、原子输出 JSON/Markdown |
| `tests/harnessbench/profiles/full-suite.json` | 默认全量评测配置；对固定上游 106 个 task 逐项声明 `execute` 或携带原因的 `unsupported` |
| `tests/harnessbench/profiles/*-regression.json` | 固定的非计分诊断任务集合；只引用 `full-suite` catalog，不拥有支持结论或计分口径 |
| `tests/harnessbench/fixtures/harnessbench-agent.yaml` | 评测候选包专用 Agent，绑定 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python` |
| `tests/harnessbench/tests/*.test.ts` | preflight、工作区桥接、计分、报告安全、产品路径和 architecture negative case |
| `tests/harnessbench/README.md` | 环境要求、真实模型配置、运行命令、费用提示、报告解释和扩展任务清单的方法 |

无参数运行入口固定使用 `full-suite.json`，并要求该 profile 与固定 commit 的全部 106 个 task 恰好一一对应。浏览器、图像和办公应用任务不会被静默过滤；缺少真实产品能力或运行依赖时必须以非空原因标记为 `unsupported`，并以零分进入框架效果得分。`--smoke` 只运行 `001-file`、`002-exec` 以低成本验证集成链路，输出必须标记为 `nonScoring`，不得包含 `frameworkEffectScore`。新增上游 task 或改变支持结论都必须通过 `full-suite.json` diff 显式审查。

#### 上游获取与运行隔离

- 唯一上游为 `https://github.com/Qihoo360/harness-bench.git`，默认 commit 为 `1025086a446653702b80cfb48babbeec35db6b2c`。profile 可以选择其他 40 位 commit，但报告必须记录实际值；更新默认 commit 是可审查的测试配置变更。
- cache 位于 `test-output/harnessbench/cache/<commit>/`。已有 cache 必须同时通过 `remote.origin.url` 和 `HEAD` 校验；不一致时 fail closed，不在脏目录上 checkout 或 reset。
- 每次运行使用 `test-output/harnessbench/runs/<runId>/`，其中分别保存 candidate、NextAgent workspace root、生成的 HarnessBench 配置、上游原始结果和最终报告。task 之间不复用 candidate、session、workspace 或 SQLite 数据。
- 上游任务、fixtures、oracle 和 rubric 从固定 cache 只读使用。适配只使用上游 `generic_cli` 的 `command` 与占位参数，不向上游仓库写入 adapter 文件。

#### 私有 profile 与 run manifest

`profile` 是版本控制内的私有 JSON，禁止未知字段。字段如下：

| 字段 | 类型与约束 | trusted source / 用途 |
|---|---|---|
| `profileId` | required string；固定为 `full-suite` | 版本控制配置；标识框架效果得分的全量范围 |
| `upstreamUrl` | required string；固定为官方 HTTPS URL | 版本控制配置；校验 remote |
| `upstreamCommit` | required string；`^[0-9a-f]{40}$` | 版本控制配置；固定上游 |
| `taskSupport` | required object；key 必须与上游完整 task catalog 恰好一致，value 为 `execute` 或 `{status:"unsupported",reason:<non-empty>}` | 版本控制配置；形成固定全量分母和支持结论 |
| `modelId` | required non-empty string | CLI 非敏感输入；写入报告 |
| `providerBaseUrlRef` | required string；只允许 `env:<NAME>`，解析值必须是 HTTPS URL | 版本控制配置；仅 runner 解析并注册 proxy upstream route |
| `credentialRef` | required string；只允许 `env:<NAME>` | 版本控制配置；由 NextAgent 既有 resolver 解析 |
| `graderModelId` | required non-empty string | 版本控制配置；显式固定 grader model，不使用 HarnessBench 隐式默认值 |
| `graderProviderBaseUrlRef` | required string；只允许 `env:<NAME>`，解析值必须是 HTTPS URL | 版本控制配置；只用于 grader preflight 与上游 rubric 环境 |
| `graderCredentialRef` | required string；只允许 `env:<NAME>` | 版本控制配置；只用于 grader preflight 与上游 rubric 环境 |
| `taskTimeoutSeconds` | required integer，范围 1–1800，默认 profile 为 600 | 版本控制配置；传给上游和 terminal deadline |

预检从 profile、完整上游 task catalog 和当前 Git 状态生成 `run-manifest.json`。profile 与 catalog 存在缺项、多项或重复时 fail closed。manifest 在第一个 task 前以独占创建方式写入，后续进程只读。除解析后的 commit、全部 task 支持状态、非敏感模型标识和 timeout 外，它还记录 `runId`、UTC 开始时间、NextAgent commit，以及工作树是否 dirty；不记录 diff 内容。dirty 工作树允许评测，但报告必须显示 `nextAgentDirty=true`，避免把结果误认为纯 commit 基线。

#### 评测候选包与工作区桥接

- `nextagent-cli.mjs` 只从 public package exports 使用 local runtime package API 和 execution workspace resolver；禁止导入 `packages/*/src/**`、`@nextagent/*/testing` 或 private subpath。
- 每个 task 从当前 build 产物 staging 一个 backend-only local runtime candidate。runner 只在该临时候选包中安装 `harnessbench-agent.yaml` 并生成 runtime config：可信 local identity、active Agent、隔离 workspace root、SQLite 路径、动态端口、真实模型 profile 和现有 local gateway。它不改写仓库内默认 Agent 或配置。
- `harnessbench-agent` 只启用现有 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python` 工具，保持现有 sandbox gateway；不新增工具、不绕过 sandbox、不继承宿主进程任意文件权限。
- task 开始前，runner 将 HarnessBench workspace 内容复制到 resolver 得到的本次 execution workspace；拒绝 symlink、junction、绝对路径和任何解析后越过 task workspace 的成员。task 结束后，无论 terminal 成功或失败，都将该 execution workspace 的普通文件复制回 HarnessBench workspace，再由上游 oracle 评分。
- runner 读取上游 `prompt_file`，通过 IR create session、submit request 和 SSE stream 提交。它只把 prompt 文本作为用户输入，不把 HarnessBench workspace 绝对路径、identity、Agent Scope 或 credential 放入请求体。收到成功或失败 terminal event 后停止等待；达到同一 `taskTimeoutSeconds` 时先请求取消，等待有界 terminal 收尾后退出非零。

#### 真实模型与 usage proxy

HarnessBench runner 在每个 task 外层启动并拥有 usage proxy。`nextagent-cli.mjs` 从 `providerBaseUrlRef` 解析真实 provider URL，在 `HARNESSBENCH_LLM_PROXY_ROUTES` 中注册唯一 `/nextagent/model` upstream route，并把 candidate 的模型 base URL 设为 `HARNESSBENCH_LLM_PROXY_URL + /nextagent/model`。真实 provider URL 不进入 candidate 配置或报告；credential 仍由 `credentialRef` 在 NextAgent 进程环境中解析并作为请求认证头经 proxy 转发。task 输入无法覆盖 route、模型或 credential。

在冻结 manifest 后、第一个 task 前，runner 通过同一 proxy route 执行一次有界模型 preflight；provider 不可达、认证失败或响应不符合 OpenAI-compatible 边界时，本次全量运行直接失败且不产生总分。preflight 成功只证明评测环境有效，不进入任何 task 分数或 token 汇总。

runner 还必须从 profile 的独立安全引用解析 grader provider、credential 和 model id，并用最小 rubric 请求验证返回内容可解析为评分对象。通过后只向 HarnessBench 子进程注入 `RUBRIC_BASE_URL`、`RUBRIC_API_KEY` 和 `RUBRIC_MODEL`；不复用隐式 `OPENAI_*` fallback，不把解析值写入 manifest 或报告。任一 grader preflight 失败时在首个 task 前退出。

`nextagent-cli.mjs` 退出前读取 proxy 为当前 HarnessBench session 生成的 usage 汇总。至少一个成功 upstream request 且 `totalTokens > 0` 才写入 `modelEvidence=verified`。否则写入机器可识别的 `model_evidence_missing` adapter result 并退出非零。上游 runner 仍完成结果收集，最终汇总按零分处理。过程与安全评分继续由固定 HarnessBench commit 的 proxy trace rubric 完成，NextAgent 侧不解析 trace 内容。

#### 计分与失败分类

`report.mjs` 只消费 `run-manifest.json` 与固定上游输出。对每个 task，它优先保留 HarnessBench 的四个分数字段；`unsupported` 或缺少、超出 `[0,1]` 的 `combined_score` 统一归零并附原因。整体计算只实现 spec 的 `frameworkEffectScore` 公式，不复制 HarnessBench 的 outcome/process/security 算法。

内部 task 终态使用闭合集合：`scored`、`unsupported`、`agent_failed`、`model_evidence_missing`、`timed_out`、`grading_failed`。只有 `scored` 可以保留非零 `taskScore`；其他终态均为 0 且保持在 `benchmarkTaskCount` 中。`not_completed` 只用于部分报告，不是可发布总分的终态。每个失败 task 额外记录闭集 `failurePhase`、安全 `failureReasonCode`、run-relative evidence ref、模型请求和工作区产物观测值，但不改变 terminal status 或 `taskScore`。

runner 只在 `failurePhase=harness_process`、没有上游 result、模型请求数为零且没有工作区产物时进行一次自动重试，并以 run-relative attempt ledger 记录两次尝试。terminal、grading、已有模型调用或已有工作区结果的失败不自动重试。

报告按 execute task 汇总 `gradingCoverage`，并据此产生 `evaluationValidity`：rubric/process 全覆盖为 `valid`；运行完成但存在 rubric skipped/process 缺失为 `degraded`；前置条件或完整性无法成立为 `invalid`。`degraded` 报告保留 `diagnosticFrameworkEffectScore`，但不发布 `frameworkEffectScore`。

#### 报告写入与安全

报告为本 Function 私有测试 artifact，不进入 `agent-contracts`、release `ReleaseCheckResult` 或产品 API。完整 JSON 报告的必需顶层字段为：`schemaVersion`、`runId`、`profileId`、`startedAt`、`finishedAt`、`harnessBenchCommit`、`nextAgentCommit`、`nextAgentDirty`、`modelId`、`graderModelId`、`benchmarkTaskCount`、`statusCounts`、`gradingCoverage`、`evaluationValidity`、`manifest`、`tasks`、`evidenceRefs`。只有 `evaluationValidity=valid` 的完整计分运行包含 `frameworkEffectScore`；退化运行使用 `diagnosticFrameworkEffectScore` 和 `scoreUnavailableReason`。每个 task 记录 id、支持状态、终态或 `not_completed`、失败阶段、安全原因码、四个 HarnessBench 分量、`taskScore`、请求数、token 汇总、耗时、工作区产物观测值和相对 evidence refs；不可用数值使用 `null`，不得用字符串占位。

JSON 先写同目录临时文件，完成 schema 校验和敏感字段扫描后 rename 到最终路径；Markdown 只从已验证 JSON 渲染，不单独读取原始 trace。中断处理器把未结束 task 标记为 `not_completed` 后复用同一写入路径。扫描器检查字段名和字符串值，拒绝 credential/token header、完整 prompt/output 字段、task 文件内容字段以及绝对路径；原始 proxy trace 和上游结果留在本地私有运行目录，只在最终报告中以 run-relative evidence ref 引用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `评测报告不泄露敏感信息`；`全量任务通过真实 NextAgent 产品边界评测` 的功能性边界 | 临时候选包、既有 sandbox、路径 containment、拒绝 symlink/junction、task 不可信输入不可覆盖 identity/model/credential；最终报告敏感字段扫描 | 越界路径、private import、mock/伪造结果、task 覆盖安全配置和敏感报告必须失败 |
| 可靠性/恢复 | `评测基础设施失败有界恢复`、`评测报告可追溯且可恢复` | task 隔离、timeout 取消、有界收尾、部分报告、原子最终报告、同一不可变 manifest 的连续完成前缀恢复，以及仅限 process start 的一次安全重试 | terminal 或已有执行证据的失败不重试；process start 最多两次；中断不丢失已知结果 |
| 可测试性 | `评测运行固定版本与任务边界`、`统一计算逐任务分数与框架效果得分` 的功能性边界；无新增黑盒质量目标 | 小型纯函数承担 profile/catalog 校验、状态归一和公式；真实模型 smoke 只验证集成链路 | unit 覆盖全量 catalog/公式/边界，integration 覆盖真实产品路径，architecture 覆盖目录与 import 边界 |
| 审计/可追溯性 | `评测失败提供安全诊断`、`评测报告可追溯且可恢复` | 不可变 manifest、固定 commit、评分覆盖、failure phase/reason code、逐 task usage/score/evidence、JSON 单一事实源 | 两种报告一致、dirty 标识、失败仍进分母、原因码安全且中断证据完整 |

#### 备选方案（Alternatives Considered）

- 修改 HarnessBench 增加原生 NextAgent adapter：能减少一层 CLI，但会形成上游 fork 或要求先完成外部贡献，无法在本仓独立固定版本。选择现有 `generic_cli` 保持上游只读。
- 在 `packages/**` 增加 benchmark service/command：复用方便，但会把测试集特有逻辑变成产品能力并改变公共边界。选择测试目录 owner 和现有产品入口。
- 直接让 HarnessBench workspace 成为 NextAgent runtime workspace：会让不可信外部绝对路径进入受信配置并绕开现有 scope resolver。选择 containment 校验后的导入/导出桥接。
- 只采用 oracle `outcome_score`：成本较低，但不满足 HarnessBench 对过程与安全的完整评估。选择 usage proxy trace 和上游原生综合分。

## 验证策略（Verification Strategy）

- unit：验证 profile/manifest schema、完整 catalog 一致性、状态闭集、零分规则、框架效果得分公式、Markdown 渲染和敏感字段扫描。
- integration：以本地伪上游仓库和伪 HarnessBench 输出验证 cache/commit fail-closed、不可变 manifest、原子报告、原子替换短暂占用重试、同一 manifest 连续完成前缀恢复与 generic CLI 参数映射；这些结果不作为能力得分。
- product-path E2E：使用确定性模型经过真实 local runtime、IR Session/Request/SSE、真实 workspace 和 sandbox 验证工作区桥接与 terminal 处理；报告明确 `nonScoring`，不发布 `frameworkEffectScore`。
- live smoke：使用真实模型和固定 `001-file`、`002-exec` 验证端到端链路，断言 usage request 大于 0、token 大于 0、HarnessBench 分量存在；报告必须标记 `nonScoring` 且不得包含 `frameworkEffectScore`。该命令按需运行，不进入无凭据的常规 `npm test`。
- architecture：断言提交范围只在 `tests/harnessbench/**` 和 active change 文档；HarnessBench 实现不得 private import、不得依赖 testing export、不得修改 `packages/**` 或定义 release verdict contract。
- negative case：实际触发错误 commit、catalog 缺项/多项/重复、`unsupported` 缺原因、真实模型 preflight 失败、proxy 无请求、timeout、非法分数、路径越界、symlink/junction、敏感报告、Agent 失败和未完成 task，验证失败语义与全量分母不变。
- 人工审查：对新增/更新 profile 的 task 准入理由、真实工具依赖、模型费用和上游 commit diff 做语义审查。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：新增 `FN-10.13` 唯一主规格。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：新增 Function 黑盒导航与规格摘要。
- `openspec/designs/features/D10-二次开发与平台集成/D10.3-测试与扩展/F-10.13-HarnessBench能力评测.md`：新增 Feature 用户价值视图。
- `openspec/designs/functions/index.md`：增加 `FN-10.13` 导航。
- `openspec/designs/features/index.md`：增加 `F-10.13` 导航。
- `openspec/overview.md`：补充外部能力评测范围与非发布门禁边界。
- `openspec/designs/architecture/e2e-quality-gates.md`：补充 HarnessBench 外部评分与 release E2E 合规 gate 的并列边界。
- `openspec/designs/modules/agent-test-kit.md`：补充 HarnessBench runner 不属于产品 test kit contract 的边界导航。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加 `harnessbench-evaluation` 到 Function、Feature、architecture、测试入口的导航。

## 风险与取舍（Risks / Trade-offs）

- 真实模型与 rubric 调用产生费用且具有随机性。通过固定 model id、commit、任务清单和逐 task usage 保持可比较性；首版不规定发布阈值，也不把单次分数解释为 SLA。
- 全量 106 个 task 的真实模型评测会产生显著费用和时长。默认入口仍必须运行 `full-suite` 才能发布框架效果得分；`--smoke` 仅用于集成诊断并显式标记 `nonScoring`，不得被解释为框架效果。
- 上游 schema 可能随 commit 更新。默认 commit 固定；升级时必须更新 fixtures、解析测试和 profile，并以代码审查显式确认计分语义变化。
- Windows 与 POSIX 工具行为可能影响任务结果。报告记录运行环境摘要；跨平台可比性由相同 profile、commit 和环境约束保证，不在首版自动归一平台差异。

## 待确认问题（Open Questions）

无。
