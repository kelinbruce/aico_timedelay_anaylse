## Why

NextAgent 当前已有 41 个固定后端 gate cases、49 个独立 backend E2E 场景和 24 个 browser E2E 场景，但这些场景分散在源码测试、多个 runner 和前端目录中。它们不能由 `tests/TESTClaw` 面向候选包独立重放，因而平台集成方无法用一个与源码实现解耦的入口验证完整既有覆盖。

外部 ESM consumer、remote gateway loopback、SkillHub HTTP/文件系统也缺少真实跨边界组合证据；remote deployment、远端 RAG/sandbox、SkillHub 获取到执行以及三宿主真实后端流程仍存在 E2E 空白。需要把完整用例同步到 TestClaw，由 TestClaw 对候选运行包和外部 package artifacts 独立执行并形成统一结论。

## 术语

- **同步用例**：从现有固定 gate、backend E2E 或 browser E2E 提取相同用户可观察目标，并在 TestClaw 中提供独立执行入口；源码测试结果或报告不得替代其执行。
- **系统集成用例**：通过已发布 package public exports，并跨越真实协议或文件系统边界验证组合结果。
- **E2E 流程用例**：从候选包真实产品入口进入，经过真实 transport、runtime composition 及场景要求的持久化、外部服务、文件系统或浏览器边界，验证系统可观察结果。
- **activated 用例**：行为已有稳定或明确 active OpenSpec 输入，且当前 TestClaw 输入边界可独立执行；缺失或失败会阻断门禁。
- **deferred coverage**：缺少稳定行为、真实消费方或可执行 artifact 的 planned 范围，以及已有独立验证 owner 或不属于本 Function 验收边界的 excluded 范围；它保持可见但不计入 122 个 activated 用例。

## 目标与非目标

**目标：**

- 将 41 个固定后端 gate cases、49 个独立 backend E2E 场景和 24 个 browser E2E 场景逐条同步到 TestClaw。
- 在 TestClaw 新增 3 个系统集成用例，覆盖外部 ESM consumer、remote gateway loopback、SkillHub HTTP/文件系统。
- 在 TestClaw 新增 5 个跨边界 E2E 流程，覆盖 remote deployment 主链、远端 RAG/sandbox 诊断、SkillHub 获取到执行、远端失败/取消和三宿主真实后端语义。
- 通过一个 TestClaw 命令独立执行全部 122 个 activated 用例，并输出分层、逐用例、安全且可追踪的机器报告。
- 保留源码测试作为开发期回归来源，同时禁止复用源码测试结果充当 TestClaw 通过证据。

**非目标：**

- 不删除或迁移现有源码测试，不改变其 case id、runner 或 owner。
- 不把 TestClaw 当前其他 contract/architecture 用例自动纳入本门禁；本门禁只执行清单中映射的 122 个用例。
- 不新增或修改模型、RAG、sandbox、SkillHub、Workflow、浏览器宿主、runtime、gateway 或持久化的产品行为。
- 不修改 `agent-contracts`，不新增公共 release `checkId`，不改变 release qualification verdict。
- 不从 TestClaw 导入仓库源码、private path 或 `@nextagent/*/testing`，不以 mock route、source assertion、旧报告或 skipped case 冒充独立通过。
- 不在 AICO Service 可执行 artifact 缺失时声明真实 AICO consumer E2E 已通过。

## What Changes

- 在 TestClaw 建立 122 个 activated 用例的受版本控制清单：
  - `TC-SI-001` 至 `TC-SI-041`：41 个固定后端 gate cases；
  - `TC-SI-042` 至 `TC-SI-090`：49 个独立 backend E2E 场景；
  - `TC-SI-091` 至 `TC-SI-111`、`TC-SI-120` 至 `TC-SI-122`：24 个 browser E2E 场景；
  - `TC-SI-112` 至 `TC-SI-114`：3 个新增系统集成用例；
  - `TC-SI-115` 至 `TC-SI-119`：5 个新增 E2E 流程用例。
- 为每个现有场景建立一对一、不可重复的 `sourceCaseRef → TestClaw caseId → executionRef` 映射；只有 TestClaw 本次实际执行结果参与门禁。
- TestClaw 以候选运行包根和外部 packages 根作为显式输入，使用真实进程、HTTP/SSE/WS、浏览器和文件系统边界独立验证。
- 新增不进入正式发布包的 `@nextagent/agent-web-test-hosts` 外部验证 artifact，为 local dev/test 宿主提供闭合 browser bundle；immersive 和 collaborative 仍只消费候选正式前端 artifact。
- 新增 TestClaw 标准系统集成验证入口和带隔离 run identity 的机器报告。
- 将候选本地 operational diagnostic 放入本次运行的 restricted diagnostic root；TestClaw 只导出安全判定、hash 或 opaque evidence ref，不把允许保留本地执行细节的候选日志复制到报告、stdout/stderr 或 evidence artifact。
- 新增 source-checkout 同步校验，防止现有 114 个来源场景发生增删或重命名后清单静默漂移；该校验不参与独立候选包的运行时证据。
- 把 planned/excluded 能力放入独立 deferred coverage 清单，不伪装为 TestClaw case，也不参与 122 个用例计数。

## Feature 影响

### 修改的 Feature

- `F-10.8 验证门禁`：在既有 contract/architecture/E2E gates 之上增加 TestClaw 独立系统集成验证，完整承接现有 114 个场景并补齐 8 个跨边界场景。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-10.31 验证系统集成` → `specs/ts-system-integration-validation-gate/spec.md`
  - 功能边界：TestClaw 根据受版本控制的 122 用例清单，对候选运行包和外部 package artifacts 独立执行系统集成与 E2E 流程，输出统一结论、逐条追踪和安全 evidence refs。
  - 系统质量属性：安全、可靠性/恢复、可测试性、审计/可追溯性。

### 修改的 Function

无。

## 影响范围

- TestClaw 成为本门禁唯一执行 owner；源码测试只保留原有回归职责和同步漂移输入。
- TestClaw 的安装、执行时间和临时资源会增加；新增远端 package 输入缺失时必须显式失败为 `UNAVAILABLE`。
- 本 change 不修改产品 package、public contract 或现有 release verdict；是否纳入 release qualification 另行决策。
