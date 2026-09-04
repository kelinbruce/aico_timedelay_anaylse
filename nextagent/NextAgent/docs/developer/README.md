# 智能体开发者文档

面向基于 NextAgent 平台进行智能体开发的开发者。本目录提供从入门到进阶的完整指南，覆盖 NextAgent TypeScript 后端框架下的环境搭建、架构理解、Agent 装配、能力扩展、运行时治理和工程实践。

> **仓库外二开者**（拿到运行包 / 插件 SDK 分发而非源码仓库）：从 [对外二次开发指南](./26-external-development-guide.md) 进入；需要把 NextAgent 接入自己系统的集成方看 [外部系统集成指南](./27-integration-checklist.md)。

## 阅读路径

### 新手入门

1. [快速上手](./01-quickstart.md) — 环境搭建 + 编译启动 + 验证第一个 Agent
2. [架构概览](./02-architecture.md) — 理解分层架构与 20 个 package 的核心组件职责
3. [教程与示例](./13-tutorials-examples.md) — 端到端开发示例

### 核心开发

4. [Agent 配置参考](./03-agent-configuration.md) — `agent.yaml` 完整配置手册
5. [Skill 与 Tool 开发](./04-skill-tool-development.md) — 自定义能力实现指南
6. [能力扩展](./05-capability-extension.md) — Capability / Hook / Policy 扩展全景
7. [提示工程](./06-prompt-engineering.md) — 提示模板编写与缓存优化

### 深入理解

8. [会话与状态管理](./07-session-state-management.md) — 会话生命周期与请求模型
9. [上下文管理](./08-context-management.md) — 上下文窗口与 compaction
10. [流式事件](./09-streaming-events.md) — SSE / WebSocket 事件协议
11. [API 参考](./10-api-reference.md) — REST API 与流式事件参考

### 工程实践

12. [测试与调试](./11-testing-debugging.md) — Skill / Tool / Hook 测试方法
13. [部署说明](./12-deployment.md) — 配置与部署指南
14. [常见问题排查](./14-troubleshooting-faq.md) — 排错手册
15. [最佳实践](./15-best-practices.md) — 推荐模式与反模式
16. [Inspector 本地代理](./16-inspector-proxy.md) — LLM Debug Proxy 配置与 URL 规范
17. [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) — 请求生命周期治理扩展点开发与 Agent 配置
18. [业务二次开发指南](./18-business-secondary-development.md) — 面向交付的业务 Agent 落地手册
19. [Agent Plugin 开发指南](./19-agent-plugins.md) — 受控本地插件、Tool / Policy / Hook authoring、developer hook trace 与部署边界
20. [Remote Gateway 开发指南](./20-remote-gateway-development.md) — remote gateway provider、binding 配置与外仓 entrypoint 接入
21. [Channel 开发指南](./21-channel-development.md) — 外仓自定义 channel、RuntimeCommandPort 注入与启动装载
22. [Observability Metrics 指标清单](./22-observability-metrics.md) — 运行时、模型、能力、网关、健康检查和可观测自身指标列表
23. [Lifecycle Hook 细化开发指南](./23-lifecycle-hook-authoring-details.md) — Hook 作者实操手册、能力选择、编写建议与测试建议
24. [Recipe 转换到 Skill 开发指南](./nextagent-recipe-to-skill/references/development-guide.md) — recipe 内置转换与无 recipe 的描述+工具生成策略
25. [OTEL Trace 事件与上报指南](./25-otel-trace-reporting.md) — Trace 配置、事件清单、消息类型、OTLP JSON 示例与扩展检查项
26. [对外二次开发指南](./26-external-development-guide.md) — 仓库外二开者总入口：分发形态、环境要求、四层二开路径与版本支持
27. [外部系统集成指南](./27-integration-checklist.md) — 对接 checklist：索取项、连通性验证、通道选型、错误读取与验收清单

已有 Agent 项目升级到 canonical model authoring 格式时，从目标 NextAgent release/tag 的源码复制单文件[模型资产迁移工具](../../migration/model-authoring-v2/README.md)，以 `--root` 指向 Agent 项目进行 dry-run，再显式写入；该工具不包含在 runtime 运行包中。

## 文档导航

| # | 文档 | 主题 | 状态 |
|---|------|------|------|
| 1 | [快速上手](./01-quickstart.md) | Getting Started / Quickstart | ✅ |
| 2 | [架构概览](./02-architecture.md) | Architecture Overview | ✅ |
| 3 | [Agent 配置参考](./03-agent-configuration.md) | Agent Configuration | ✅ |
| 4 | [Skill 与 Tool 开发](./04-skill-tool-development.md) | Skill / Tool Development | ✅ |
| 5 | [能力扩展](./05-capability-extension.md) | Capability Extension | ✅ |
| 6 | [提示工程](./06-prompt-engineering.md) | Prompt Engineering | ✅ |
| 7 | [会话与状态管理](./07-session-state-management.md) | Session & State Management | ✅ |
| 8 | [上下文管理](./08-context-management.md) | Context Management | ✅ |
| 9 | [流式事件](./09-streaming-events.md) | Streaming & Events | ✅ |
| 10 | [API 参考](./10-api-reference.md) | API Reference | ✅ |
| 11 | [测试与调试](./11-testing-debugging.md) | Testing & Debugging | ✅ |
| 12 | [部署说明](./12-deployment.md) | Deployment | ✅ |
| 13 | [教程与示例](./13-tutorials-examples.md) | Tutorials / Examples | ✅ |
| 14 | [常见问题排查](./14-troubleshooting-faq.md) | Troubleshooting / FAQ | ✅ |
| 15 | [最佳实践](./15-best-practices.md) | Best Practices | ✅ |
| 16 | [Inspector 本地代理](./16-inspector-proxy.md) | Inspector LLM Debug Proxy | ✅ |
| 17 | [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) | Lifecycle Hook Development | ✅ |
| 18 | [业务二次开发指南](./18-business-secondary-development.md) | Business Secondary Development | ✅ |
| 19 | [Agent Plugin 开发指南](./19-agent-plugins.md) | Agent Plugin Development | ✅ |
| 20 | [Remote Gateway 开发指南](./20-remote-gateway-development.md) | Remote Gateway Development | ✅ |
| 21 | [Channel 开发指南](./21-channel-development.md) | Channel Development | ✅ |
| 22 | [Observability Metrics 指标清单](./22-observability-metrics.md) | Observability Metrics Inventory | ✅ |
| 23 | [Lifecycle Hook 细化开发指南](./23-lifecycle-hook-authoring-details.md) | Lifecycle Hook Authoring Details | ✅ |
| 24 | [Recipe 转换到 Skill 开发指南](./nextagent-recipe-to-skill/references/development-guide.md) | Recipe to Skill Migration | ✅ |
| 25 | [OTEL Trace 事件与上报指南](./25-otel-trace-reporting.md) | OTEL Trace Reporting | ✅ |
| 26 | [对外二次开发指南](./26-external-development-guide.md) | External Development Guide | ✅ |
| 27 | [外部系统集成指南](./27-integration-checklist.md) | Integration Checklist | ✅ |

## 前端开发

- [前端文档总入口](../frontend/README.md) — `agent-web` 宿主形态、内容状态与阅读导航
- [前端开发指南](../frontend/development.md) — 启动、Mock、构建、测试与调试
- [前端用户工作流](../frontend/user-workflows.md) — 会话、请求控制、分享和恢复等用户可观察流程
- [agent-web 实现架构](../../frontend/agent-web/ARCHITECTURE.md) — package-local entry、state、network 与 rendering owner

## 相关资源

- [OpenSpec 总览](../../openspec/overview.md) — 产品范围、稳定基线与长期背景
- [稳定行为契约](../../openspec/specs/) — 归档后的稳定 capability 行为契约
- [稳定设计文档](../../openspec/designs/) — 归档后的稳定架构与 ADR
- [agent-web API 清单](../apis/agent-web-api-list.md) — 后端提供给前端的完整 API 字段参考
- [发布文档目录](../release/) — 含 [NextAgent v2.0 Release Doc](../release/NextAgent-v2.0-release.md)
- [开源组件清单](../NextAgent%20开源组件清单.md) — 后端 / 前端直接依赖与版本
- [项目根 README](../../README.md) — 平台定位、技术栈、架构边界与验证命令
- [模型资产迁移工具](../../migration/model-authoring-v2/README.md) — 离线升级 system config、Agent、Prompt Template 与 Skill model metadata
- [开发约束](../../AGENTS.md) — 规格优先、架构边界、技术约束与验证门禁
