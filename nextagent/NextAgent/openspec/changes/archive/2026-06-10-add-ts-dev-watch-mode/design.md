## 背景和现状（Context）

当前稳定规格已经把 `dev:fullstack` 定义为 packaged fullstack bootstrap：它构建前端静态产物、生成并安装 `@nextagent/agent-web` artifact package，然后启动 `with-frontend` 产品入口。该入口刻意不支持 HMR、Vite dev server proxy 或长期运行的前端 watch 流程。

前端 `frontend/agent-web` 已经具备 Vite dev server，`npm run dev` 默认使用 `vite --mode backend`，Vite 自身提供前端 HMR。后端当前是 TypeScript project references 编译到 `dist` 后由 Node 运行 ESM 入口，backend-only 产品入口位于 `packages/agent-app/dist/entrypoints/backend-only.js`。

现状缺口是：仓库根没有一个被规格化的 source watch dev entry。开发者如果要同时开发前后端，需要手动启动 Vite、编译后端并重启 Node 进程，容易误用 `dev:fullstack` 作为日常源码开发入口。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 新增仓库根 `npm run dev:watch`，作为日常源码开发入口。
- 前端使用 Vite dev server 和既有 HMR。
- 后端使用 TypeScript watch 编译，并在成功编译后自动启动或重启 backend-only Node 进程。
- Vite `/api` proxy 指向 backend-only 后端，使 REST、SSE 和 WebSocket stream 继续从后端 owner 提供。
- 保持 `dev:fullstack` packaged static hosting 语义不变。

**非目标：**

- 不做后端进程内 HMR。
- 不新增 runtime lifecycle、stream migration、in-flight request migration 或 gateway persistence 语义。
- 不改变 SSE/WebSocket transport 等价性，不新增或重做前端 runtime transport 切换。
- 不保留脚本级 WebSocket convenience profile；WebSocket transport 仍由显式 `VITE_TRANSPORT_KIND=WEBSOCKET` 选择。
- 不新增 `nodemon`、`concurrently`、`tsx` 或其他开发依赖。
- 不修改正式 release/build/package orchestration。

## 设计决策（Decisions）

### D1. 使用根目录 Node 编排脚本作为唯一实现路径

新增 `scripts/dev-watch.mjs`，并在根 `package.json` 暴露 `dev:watch`。该脚本是唯一 watch mode composition surface，负责启动和管理以下进程：

- 前端 Vite dev server：在 `frontend/agent-web` 下执行 `npm run dev`。
- 后端 TypeScript watch：在仓库根使用现有 `typescript` devDependency 的 solution builder watch API 监听 `tsconfig.json`。
- 后端 Node 进程：在编译成功后执行 `node packages/agent-app/dist/entrypoints/backend-only.js`。

选择 Node 编排脚本的原因是：仓库已经使用 Node/TypeScript/npm workspaces，不需要引入额外进程管理依赖；同时可以用程序化方式清理子进程、注入 Vite proxy env，并对编译成功/失败做确定处理。

拒绝方案：

- `dev:fullstack` 增加 watch：会违反已稳定的 packaged static hosting 边界。
- `nodemon` / `concurrently` / `tsx`：会新增依赖，且本 change 的核心问题可以用现有 Node 和 TypeScript 能力解决。
- 后端进程内 HMR：需要可 reload app host、模块缓存失效、Fastify route 替换、stream subscription drain 和 runtime lifecycle 规格，超出本 change。

### D2. 后端 watch 使用编译成功信号驱动进程重启

`scripts/dev-watch.mjs` 使用 TypeScript solution builder watch API 承载后端编译监听。首次 watch 编译成功后启动 backend-only Node 进程；后续 watch 编译成功后重启该进程。

如果编译失败：

- 已运行的旧 backend-only 进程保持不变，直到下一次成功编译触发重启。
- 如果尚未有成功编译，则不启动后端。
- 编译诊断输出给开发者，作为 watch mode 的可观察反馈。

该策略避免把后端重启绑定到脆弱的 shell 输出解析，也避免在坏产物上重启后端。

### D3. 后端服务形态固定为 backend-only

`dev:watch` 启动的后端只使用 compiled backend-only entrypoint。它不导入 `@nextagent/agent-app-frontend-hosting`，不解析 `@nextagent/agent-web/hosting`，不注册前端静态资源 route 或 SPA fallback。

该选择让 watch mode 成为 source development topology：

```text
Browser
  -> Vite dev server (frontend/HMR)
      -> /api proxy
          -> backend-only Fastify app (REST/SSE/WS/control)
```

`with-frontend` 和前端 artifact package 仍归 `dev:fullstack`、正式候选包或后续 packaging flow 管理。

### D4. 前端 dev server 由编排脚本注入后端 proxy target

`dev:watch` 启动 Vite 进程时注入 `VITE_PROXY_TARGET=http://localhost:3000`。该值对齐当前默认后端监听配置 `127.0.0.1:3000`，并优先于 `.env.backend` 中已有值。

前端 backend dev profile 同步对齐为 `VITE_PROXY_TARGET=http://localhost:3000` 和 `VITE_TRANSPORT_KIND=SSE`，避免开发者单独运行 `frontend/agent-web npm run dev` 时指向旧端口。脚本级 `.env.websocket` 和 `dev:ws` 移除；需要 WebSocket transport 时由调用方显式设置 `VITE_TRANSPORT_KIND=WEBSOCKET` 后运行普通 dev entry。

`dev:watch` 使用的 Vite dev server 默认 host 必须是 `127.0.0.1`，使日常开发入口稳定落在 `http://127.0.0.1:5173/`。如果开发者需要显式改变本地绑定地址，可以通过 `VITE_DEV_HOST` 覆盖；该覆盖只影响 Vite dev server host，不改变 backend-only 后端监听配置或 `/api` proxy target。

Vite proxy 配置必须覆盖 `/api/**` 的 REST、SSE 和 WebSocket upgrade。当前 Vite proxy 已覆盖 `/api` 和 SSE header 处理；实现阶段需要补齐 WebSocket upgrade proxy 配置。

### D5. 子进程生命周期由 dev-watch 编排器统一管理

`scripts/dev-watch.mjs` 负责处理 Ctrl+C、进程退出和失败：

- 用户终止 `dev:watch` 时，编排器必须关闭前端 Vite 进程、后端 watch 编译器和 backend-only Node 进程。
- Vite 进程异常退出、TypeScript watch 无法启动或 backend-only 进程异常退出时，`dev:watch` 整体失败退出并清理其他子进程。
- 后端编译失败不是整体进程失败；它是 watch 诊断，等待下一次成功编译。

这样可以避免留下半活后台进程，也让开发者从一个入口判断 watch mode 是否仍有效。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `dev:watch` 不新增 Web API、认证入口或 secret 读取路径；后端继续由 backend-only Web channel 提供 REST/SSE/WS/control。Vite proxy 只转发 `/api/**` 到本地后端，不接管后端 route owner。 | dev-watch script tests、Vite proxy configuration tests、backend-only route/profile regression tests |
| 性能/容量 | watch mode 面向本地开发，不形成生产容量承诺。选择 Vite HMR 和 TypeScript watch，避免每次前端改动触发 artifact build，减少反馈时间。 | orchestration tests 验证不调用 frontend artifact build；人工 smoke 可验证前端改动不触发后端构建 |
| 可靠性/恢复 | 后端编译失败不重启到坏产物；成功编译后进程级重启。重启造成的连接中断不新增迁移语义，仍依赖既有 stream replay 和 runtime recovery。 | backend watch restart tests、compile failure characterization tests、existing stream/recovery tests |
| 可维护性 | 新增单一 `scripts/dev-watch.mjs` 编排面，不引入新依赖，不改变 app composition。watch mode 与 `dev:fullstack` 分离，避免一个脚本承担两种 serving topology。 | script unit tests、fullstack packaging boundary regression tests、code review 检查点 |
| 可测试性 | 编排逻辑应拆成可测试的 command plan / process lifecycle helper，测试断言启动命令、env、失败处理和禁止调用 artifact packaging。 | dev-watch orchestration tests、package script tests |
| 审计/可追溯性 | watch mode 是本地开发入口，不产生候选运行包 evidence 或 release verdict。诊断只输出开发进程状态和编译失败，不新增审计事件契约。 | tests 断言不生成 candidate evidence；code review 检查日志不含 secret/raw prompt |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 根目录提供 `npm run dev:watch` | 1.1 | package script test / source assertion |
| `dev:watch` 启动 Vite dev server 和 backend-only 后端 | 1.2, 3.1 | dev-watch command plan tests |
| `dev:watch` 不自动安装依赖 | 1.4 | script behavior tests 验证不调用 `npm install` |
| Vite `/api` proxy 指向 backend-only，覆盖 REST/SSE/WS | 2.1, 2.2 | Vite config tests |
| 后端编译成功后启动或重启 backend-only Node 进程 | 3.1, 3.2 | backend watch lifecycle tests |
| 后端编译失败不重启到坏产物 | 3.3 | compile failure characterization tests |
| `dev:watch` 不构建前端 artifact、不安装 `@nextagent/agent-web`、不启动 `with-frontend` | 4.1 | fullstack boundary regression tests |
| `dev:fullstack` packaged static hosting 语义不变 | 4.2 | existing `dev-fullstack` packaging tests |
| OpenSpec delta 合法且覆盖 dev profile cleanup | 5.1 | `openspec validate add-ts-dev-watch-mode --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/fullstack-packaging-boundary/spec.md` 承载 `dev:watch` 与 `dev:fullstack` 的外部可验证行为。
- 架构和跨模块设计：`openspec/designs/architecture/fullstack-packaging-boundary.md` 承载 watch mode topology、backend-only watch serving shape、非 HMR 后端重启策略和 `dev:fullstack` 分工。
- 模块设计：默认无新增长期模块职责；若实现新增可复用 helper 且属于 `agent-app` 或 script boundary，归档前再提炼到对应模块文档。
- ADR：无。后端不做 HMR 是本 feature 的范围取舍，不需要单独长期 ADR。
- 导航：`openspec/designs/spec-to-design-map.md` 归档前补充 dev watch 相关验证入口。

## 风险与取舍（Risks / Trade-offs）

- [风险] 后端重启会断开 SSE/WS 连接。 -> 本 change 明确不做 stream migration；前端和后端沿用既有 reconnect/replay/recovery 规格。
- [风险] TypeScript watch API 的信号处理比 shell 命令复杂。 -> 将编排逻辑集中在 `scripts/dev-watch.mjs`，并用 command plan / lifecycle tests 锁定行为。
- [风险] 旧的 `.env.backend` 端口和脚本级 WebSocket profile 让开发入口语义漂移。 -> `.env.backend` 对齐 `3000`，删除 `.env.websocket` / `dev:ws`，保留 runtime config 作为唯一 transport 切换入口。
- [风险] 后续有人把 watch mode 接入 `with-frontend`。 -> spec 和 tests 明确 `dev:watch` 不构建或安装 frontend artifact，不启动 `with-frontend`。

## 迁移计划（Migration Plan）

无数据迁移、API 迁移或发布迁移。实施后新增 `npm run dev:watch`；既有 `dev:fullstack`、`dev`、`dev:mock` 入口保持原状。`dev:ws` 移除，迁移为显式设置 `VITE_TRANSPORT_KIND=WEBSOCKET` 后运行普通 dev entry。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/fullstack-packaging-boundary/spec.md`：合入 `dev:watch` source development entry、Vite HMR、backend-only auto restart、packaged boundary preservation 的行为契约。
- `openspec/designs/architecture/fullstack-packaging-boundary.md`：提炼 watch mode topology、后端进程级重启策略、`dev:watch` 与 `dev:fullstack` 分工。
- `openspec/designs/modules/agent-app.md`：默认无；只有实现新增 app-level public entry/helper 时更新。
- `openspec/designs/spec-to-design-map.md`：补充 dev watch orchestration tests / Vite proxy tests / fullstack regression tests 作为 `fullstack-packaging-boundary` 验证入口。
- `openspec/overview.md`：无。
- `openspec/designs/adr/<id>.md`：无。

## 待确认问题（Open Questions）

无。
