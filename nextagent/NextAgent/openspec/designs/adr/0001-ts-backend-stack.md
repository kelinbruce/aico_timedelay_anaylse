# ADR 0001: TS 后端技术栈

## 状态

Accepted

## 背景

NextAgent TS 后端需要服务电信网络智能体场景。技术栈必须支持长任务、stream、schema validation、结构化日志、可观测、package boundary、整模块替换和企业后端长期维护。

## 决策

| 维度 | 选择 | 理由 | 放弃的方案 |
|---|---|---|---|
| Runtime | Node.js LTS | 企业后端运行时、生态、observability、Fastify、工具链和长期维护风险最低。 | Bun 作为第一阶段生产 runtime |
| Language | TypeScript strict ESM | 类型边界、package exports、project references 和 NodeNext 行为可审查。 | CommonJS、宽松 TS 配置 |
| Workspace | npm workspaces | 与 Node/TS 工具链直接兼容，满足当前内部 package 管理需求。 | pnpm/yarn workspace 作为第一阶段基线 |
| Web framework | Fastify | 性能、schema-first、inject testing、SSE/WS adapter 边界适合后端服务。 | Express、NestJS、tRPC |
| Runtime schema | TypeBox/Ajv | 让 contract skeleton 和 runtime validation 可以共享 schema-first 思路。 | 只依赖 TypeScript 类型 |
| Logging | Pino through `agent-observability` | 结构化 JSON、性能、child logger 和 redaction 策略适合服务端。 | 业务 package 直接 `console.*` |
| Tracing/Metrics | OpenTelemetry through `agent-observability` adapters and `agent-app` composition | 支持企业可观测集成、W3C Trace Context / OTLP traces 标准语义和可替换 sink，同时保证 SDK 类型不泄漏到 core/contracts。 | 业务 package 直接依赖 OTel SDK |
| Testing | Vitest | ESM、TS、workspace 和快速 smoke tests 支持较好。 | Jest 作为第一阶段基线 |
| Architecture lint | dependency-cruiser | 可重复执行 forbidden dependency、private import 和 framework leakage 检查。 | 只靠 code review |
| Local persistence adapter | Kysely/SQLite confined to gateway adapter | 本地运行包需要持久化占位，但 driver/schema 不泄漏到上层。 | runtime/session 直接依赖 SQLite |

## 版本基线

版本基线以根 `package.json` 的声明范围为准，`package-lock.json` 固化当前解析版本。

| 技术 | 声明范围 | 当前 lock 解析版本 | 备注 |
|---|---:|---:|---|
| Node.js | `>=22.0.0` | 不适用 | 使用内置 `fetch`、`AbortController`、Web Streams 和 AsyncLocalStorage。 |
| TypeScript | `^5.9.3` | `5.9.3` | strict ESM、NodeNext、project references。 |
| Fastify | `^5.6.2` | `5.8.5` | 仅限 Web adapter 和 auth-local adapter 内部。 |
| TypeBox | `^0.34.41` | `0.34.49` | JSON Schema 和静态类型共源。 |
| Ajv | `^8.17.1` | `8.20.0` | runtime validation。 |
| Pino | `^10.1.0` | `10.3.1` | 通过 `agent-observability` 暴露 structured logging helper。 |
| OpenTelemetry API | `^1.9.0` | `1.9.1` | SDK 类型不进入 core contracts。 |
| Kysely | `^0.28.8` | `0.28.17` | 只允许在 platform gateway adapter 内部使用。 |
| Vitest | `^4.0.14` | `4.1.7` | unit、contract、architecture smoke tests。 |
| dependency-cruiser | `^17.3.1` | `17.4.2` | package boundary 和 forbidden dependency 检查。 |
| @types/node | `^24.10.1` | `24.12.4` | TypeScript 编译期 Node 类型。 |

## 约束

- Fastify、Kysely、SQLite、provider SDK、PaaS SDK、OTel SDK 类型不得进入 `agent-contracts` 或核心业务 package public contract。
- 跨 package import 必须通过 package name 或 public subpath。
- 替换 package 通过 public contract、package exports 和 `agent-app` 显式装配接入。
- 动态插件加载、运行时热插拔和远端实现包加载不是第一阶段能力。

## 后果

- package 边界可以通过 TypeScript project references、package exports 和 dependency-cruiser 自动验证。
- adapter/provider 外部库升级不会强迫 core/runtime/contracts 改动。
- 后续若评估 Bun、NestJS、Vercel AI SDK、LangChain 或其他 SDK，必须作为新 OpenSpec change 明确边界和泄漏规则。

## 验证

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run test:contract`
