## Function

- **所属 Function**：`FN-10.6 前端定制`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Agent Web diagnostics use runtime-owned reporters

Agent Web 浏览器生产源码与 `agent-web-mock-server` 运行时源码中的 info、warning、error 与 debug 诊断 MUST 分别通过所属 runtime 的诊断 reporter 输出；业务源码、route、data stream 与 server 模块 MUST NOT 直接调用 `console.log`、`console.warn`、`console.error` 或 `console.debug`。reporter MUST 保持既有浏览器开发控制台或 mock server stdout/stderr 可见性，并 MUST NOT 改变触发诊断的原业务控制流、用户可见结果或后端请求行为。

**需求类别**：系统质量属性

**质量属性**：可维护性、可测试性
**适用范围**：该 Function

#### Scenario: 浏览器业务源码不直接依赖 console

- **WHEN** Agent Web 浏览器生产源码需要输出 warning、error 或 debug 诊断
- **THEN** 该源码 MUST 调用前端诊断 reporter
- **AND** 该源码 MUST NOT 直接调用 `console.*`

#### Scenario: Mock server 运行时源码不直接依赖 console

- **WHEN** `agent-web-mock-server` 的 server、route 或 data stream 模块需要输出 info、warning 或 error 诊断
- **THEN** 该模块 MUST 调用 mock server 诊断 reporter
- **AND** 该模块 MUST NOT 直接调用 `console.*`

#### Scenario: 诊断不改变业务结果

- **WHEN** AICOConfig 校验、PIU 集成、多宿主启动、Mermaid 渲染、stream envelope 防御或 mock server request/stream 路径触发诊断
- **THEN** reporter MUST 输出对应级别的事实
- **AND** 原有降级、渲染、请求处理或拒绝行为 MUST 保持不变

#### Scenario: 诊断不进入产品输出或外部边界

- **WHEN** reporter 输出 diagnostic
- **THEN** 输出 MUST 仅面向对应 runtime 的浏览器开发控制台或 mock server stdout/stderr
- **AND** MUST NOT 渲染用户界面通知、发送网络请求或写入 persistence、audit、metric 或 trace

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：前端定制相关能力在多宿主、AICO/PIU 与本地 mock server 路径中统一输出 runtime-owned 诊断，业务实现不直接依赖 `console`。
- **依据 Requirements**：`Agent Web diagnostics use runtime-owned reporters`

### 规格

- **规格项**：浏览器诊断输出方式
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：Agent Web 浏览器生产源码与 mock server 运行时源码分别通过所属诊断 reporter 输出；业务/route/data/server 源码禁止直接调用 `console.*`
- **依据 Requirements**：`Agent Web diagnostics use runtime-owned reporters`
