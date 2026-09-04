# Proposal: 统一 Agent Web 前端诊断输出

## Why

Agent Web 生产源码中存在分散的 `console.warn`、`console.error` 和 `console.debug` 调用，覆盖 AICOConfig 校验、PIU 集成、多宿主启动、Mermaid 渲染、stream envelope 防御路径，以及 `agent-web-mock-server` 的 server、route 和 data stream 输出。开发者和维护者当前只能在各个组件里直接向浏览器控制台或 mock server 进程标准输出写诊断，缺少统一 owner；这类调试调用也容易在后续功能中继续扩散，不符合正式交付前应避免直接使用 `console` 的编码要求。

本次不改变既有业务降级、请求处理或渲染结果：诊断仍用于开发定位，不作为用户界面内容。变化是把浏览器端与本地 mock server 的诊断输出分别收敛为可测试的 runtime-owned reporter，避免业务源码直接依赖 `console`。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Agent Web 浏览器生产源码中的 warning、error 和 debug 诊断通过同一前端诊断 reporter 输出。
- `agent-web-mock-server` 运行时源码中的 info、warning 和 error 诊断通过该 mock server 自己的 reporter 输出。
- reporter 保留现有 warning/error/debug 级别的开发可见输出，不吞掉失败事实，不改变组件控制流和用户可见行为。
- local、immersive、collaborative 三种宿主和 AICO/PIU 定制路径使用同一诊断原则，不形成宿主专属诊断语义。
- 通过测试锁定业务源码不再直接调用 `console.*`，并锁定 reporter 的级别分发。

**非目标：**

- 不把诊断消息渲染为客户端 UI，不新增通知组件或用户设置。
- 不把浏览器诊断上报到后端、SSE、WebSocket、audit、metric 或 trace。
- 不记录 prompt、模型输出、stream delta、附件内容、credential 或其他敏感原文。
- 不清理测试和 Node CLI scripts 中的 `console.*`；测试需要 spy/呈现验证结果，CLI 需要进程 stdout/stderr 输出，不属于浏览器或 mock server 运行时源码边界。
- 不改变后端 `agent-observability` / `agent-log` 的结构化日志 owner。

## What Changes

- 新增 Agent Web 诊断契约：浏览器业务源码 MUST 通过前端 reporter 输出 warning、error 和 debug 诊断；mock server 运行时源码 MUST 通过自身 reporter 输出 info、warning 和 error 诊断，且 MUST NOT 直接调用 `console.*`。
- reporter 按诊断级别复用浏览器开发控制台的既有可见性，不引入新的配置、网络上报或持久化。
- 将现有 AICOConfig、PIU、多宿主启动、Mermaid 和 stream 防御路径的直接 `console.*` 调用迁移到该 reporter。
- 将 `agent-web-mock-server` 运行时源码的直接 `console.*` 调用迁移到 mock server 专用 reporter，保留启动横幅、请求日志、stream 生命周期日志和错误输出。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.6 前端定制` → `specs/agent-web-multi-host-modes/spec.md`
  - 功能边界：local、immersive、collaborative、AICO/PIU 定制相关浏览器生产源码与本地 mock server 运行时源码分别使用所属诊断 reporter，禁止业务/route/data/server 源码直接调用 `console.*`。
  - 系统质量属性：可维护性、可测试性。
  - 映射说明：canonical spec；本 change 不修改其他既有 Requirements。

## 影响范围（Impact）

- Agent Web 开发者：仍可在浏览器开发控制台看到既有 warning/error/debug 诊断；业务行为、降级策略和页面交互不变。
- Mock server 使用者：仍可看到原有启动说明、请求与 stream 日志、warning/error；HTTP/WS/SSE 行为不变。
- 前端与 mock server 源码/测试：新增两个 runtime-owned 诊断工具及级别测试，迁移运行时源码调用点，并增加架构断言防止业务/route/data/server 源码重新直接调用 `console.*`。
- 不改变公共 Web API、stream event、runtime command、capability contract、gateway contract、persistence、身份与 scope 边界。
