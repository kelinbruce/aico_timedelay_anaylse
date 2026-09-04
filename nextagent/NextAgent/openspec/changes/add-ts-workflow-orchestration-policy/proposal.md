## 背景与问题（Why）

NextAgent 当前已有 workflow 最小 contract、单实例 execution engine、基础 gateway、routing 和 package composition 的 active changes，但这些 change 都刻意保持小范围：它们没有定义 Agent 请求在“预置 workflow”和“模型驱动 loop”之间如何稳定选择，也没有定义智能体开发者如何提供可治理的 routing policy、模型如何把复杂任务规划为可确定执行的 workflow，如何从多次成功的 model loop 轨迹中自学习沉淀 workflow，以及 YAML DSL 与模型生成 TS workflow 如何收敛到同一个执行引擎。

电信网络场景同时存在两类问题：高频典型问题要求低延迟、高准确率和可审计执行路径，例如告警定位、指标查询、配置核查和标准化恢复建议；泛化问题则需要模型探索、上下文组装和工具 loop。若只依赖模型 loop，会牺牲典型场景的性能和确定性；若只依赖预置 workflow，又无法覆盖复杂、长尾和动态任务。现在需要一个上层 orchestration policy，把两种模式纳入同一 Agent Scope / Owner Scope、安全观测和验证边界。

## 变更范围（What Changes）

- 新增 workflow orchestration policy：Agent Core 在请求进入业务处理前选择 `WORKFLOW` 或 `MODEL_LOOP`，并保留 fail-closed 与 fallback 规则。
- 扩展 routing policy 能力：支持开发者通过受控规则选择 workflow 或 loop，也支持在 Agent package 中提供完整 policy 实现；完整 policy 必须通过受控 SPI 执行，不得读取不可信身份、raw prompt、raw model output 或 capability args 作为 authority。
- 新增 model-planned workflow 能力：模型在复杂任务中可产出 workflow plan，经 schema validation、security review、DAG validation 和 compilation 后交给同一 workflow engine 执行。
- 新增 loop-to-workflow learning 能力：对多次执行且路径稳定的 model loop，通过智能体自学习生成 workflow candidate；candidate 经治理、校验和发布后，后续相似请求可直接路由到 workflow。
- 新增 workflow DAG optimization 边界：在不改变语义的前提下对 DAG 做静态校验、拓扑排序、无效边拒绝、可并行节点识别和安全执行计划生成。
- 统一 workflow authoring 与 execution：预定义 workflow 使用 YAML DSL；YAML 在启动期或首次使用前编译成 canonical TS workflow module；模型生成 workflow 使用 TS code 形态；两者都必须通过同一 canonical workflow contract 和同一 engine 执行。
- 不新增 Web API 或 runtime command。若后续需要对外暴露 recipe 管理、workflow 生成或调试 API，必须另起 OpenSpec change。
- 不新增 workflow durable store、workflow event durable table、snapshot/recovery 或 distributed scheduler。它们仍由后续独立 change 决定。

## Capability 影响（Capabilities）

### 新增 Capability
- `workflow-orchestration-policy`: 定义 workflow 与 model loop 双模式、routing policy、model-planned workflow、loop-to-workflow learning、DAG optimization、YAML/TS 统一执行的行为边界。

### 修改的 Capability
- `agent-routing-core`: 扩展 Agent 内部 routing policy，使其可选择预置 workflow、模型生成 workflow 执行计划或 model-driven loop，并约束 policy 输入、输出和 fallback。

## 影响范围（Impact）

- `agent-core`：拥有请求 routing policy、mode selection、fallback orchestration 和模型规划 workflow 的受控入口；不得把业务路由前置到 runtime/channel。
- `agent-workflow`：承载 YAML DSL loader/compiler、TS workflow canonicalizer、DAG validator/optimizer 和 engine adapter；不拥有 request lifecycle 或 terminal commit。
- `agent-memory` / task trajectory 相关能力：承载自学习输入和可复用执行轨迹摘要；不得阻塞 request terminal commit，不得把 raw prompt、raw model output 或 raw capability payload 作为 workflow 学习事实。
- `agent-contracts/core` 与 `agent-common`：按需扩展 workflow orchestration、routing policy 与 workflow source vocabulary 的最小 public contract。
- `agent-app`：负责从可信 Agent package composition 注入预置 YAML workflow、developer routing rules、developer policy implementation 和 workflow compilation sandbox 配置。
- `agent-model`：只负责模型调用和安全错误映射；模型生成 workflow 的 schema validation、policy 评估和 sandbox compilation 不归 `agent-model`。
- `agent-platform-gateway-*`：动态 TS workflow 编译和执行中的非可信代码必须通过 sandbox gateway boundary；不得直接使用宿主进程权限。
- 测试：需要 contract、architecture、integration、安全 negative case、DAG optimizer characterization 和 model-planned workflow validation。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/workflow-orchestration-policy/spec.md`：新增双模式、policy routing、model-planned workflow、loop-to-workflow learning、DAG optimization、YAML/TS 统一执行契约。
- `openspec/specs/agent-routing-core/spec.md`：提炼 routing decision 和 policy input/output 扩展。

长期背景：
- `openspec/overview.md`：补充电信高频典型问题走预置 workflow、长尾复杂问题走 model loop 的产品目标。

设计视图：
- `openspec/designs/architecture/workflow-orchestration-policy.md`：承载跨模块流程、policy 边界、模型规划 workflow、自学习沉淀 workflow、安全与质量属性。
- `openspec/designs/architecture/workflow-contracts.md`：补充 YAML/TS 到 canonical workflow 的统一 execution boundary。
- `openspec/designs/modules/agent-core.md`：补充 workflow/mode routing policy owner 和 fallback owner。
- `openspec/designs/modules/agent-workflow.md`：补充 workflow compiler、DAG optimizer、canonicalizer 和 engine adapter 职责。
- `openspec/designs/modules/agent-memory.md`：补充 loop-to-workflow learning 的安全轨迹摘要和自学习职责边界。
- `openspec/designs/modules/agent-app.md`：补充 Agent package composition 中 workflow 与 routing policy 的 startup wiring。
- `openspec/designs/adr/workflow-yaml-ts-unified-engine.md`：记录“YAML DSL 编译为 TS workflow，模型生成 TS workflow，两者通过同一 engine 执行”的长期决策。
- `openspec/designs/spec-to-design-map.md`：补充新 capability 到设计文档和验证入口的导航。

验证入口：
- `openspec validate --all --strict`
- `npm run build`
- `npm run test:contract`
- `npm test -- --run workflow`
- `npm run lint:architecture`
