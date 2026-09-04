## 1. Watch 入口与编排脚本

- [x] 1.1 在根 `package.json` 新增 `dev:watch` 脚本，并创建 `scripts/dev-watch.mjs` 作为唯一 watch mode 编排入口。
  验证：新增或更新脚本/manifest 测试，断言根脚本存在且指向 `node scripts/dev-watch.mjs`。
  来源：Source watch dev mode starts from one command；Design D1。

- [x] 1.2 在 `scripts/dev-watch.mjs` 中实现前端 Vite 进程启动计划：工作目录为 `frontend/agent-web`，命令为 `npm run dev`，并注入 `VITE_PROXY_TARGET=http://localhost:3000`；Vite dev server 默认通过 `127.0.0.1:5173` 暴露本地开发入口，并允许 `VITE_DEV_HOST` 覆盖 host。
  验证：dev-watch command plan tests 断言前端进程 cwd、命令、参数和 env；Vite config test 断言默认 host、`VITE_DEV_HOST` 覆盖入口和 5173 端口。
  来源：Source watch dev mode starts from one command；Source watch frontend uses Vite HMR；Design D4。

- [x] 1.3 在 `scripts/dev-watch.mjs` 中实现子进程生命周期清理：用户终止、Vite 异常退出、TypeScript watch 无法启动或 backend-only 异常退出时，关闭所有已启动子进程并让 `dev:watch` 整体失败退出。
  验证：dev-watch lifecycle tests 覆盖信号清理和必需子进程失败路径。
  来源：Source watch dev mode starts from one command；Design D5。

- [x] 1.4 验证 `dev:watch` 不自动运行根目录或 `frontend/agent-web` 的依赖安装。
  验证：negative orchestration test 实际执行 dev-watch plan 并断言不会调用 `npm install`。
  来源：Source watch dev mode starts from one command；proposal scope。

## 2. 前端 Vite proxy

- [x] 2.1 补齐 `frontend/agent-web` Vite `/api` proxy 对 WebSocket upgrade 的支持。
  验证：Vite config test 断言 `/api` proxy 启用 WebSocket upgrade，并保持现有 SSE proxy header 处理。
  来源：Source watch frontend uses Vite HMR；Design D4。

- [x] 2.2 验证 `dev:watch` 下前端 REST、SSE stream 和 WebSocket stream 都通过 Vite `/api` proxy 指向 backend-only 后端。
  验证：Vite proxy configuration tests 或 dev-watch command plan tests 覆盖 REST/SSE/WS proxy 目标。
  来源：Source watch frontend uses Vite HMR。

## 3. 后端 TypeScript watch 与自动重启

- [x] 3.1 在 `scripts/dev-watch.mjs` 中使用现有 `typescript` devDependency 的 solution builder watch API 监听根 `tsconfig.json`，首次成功编译后启动 `node packages/agent-app/dist/entrypoints/backend-only.js`。
  验证：backend watch lifecycle tests 使用测试替身触发首次成功编译，并断言启动 compiled backend-only entry。
  来源：Source watch backend restarts after successful TypeScript compilation；Design D2、D3。

- [x] 3.2 实现后续成功编译触发 backend-only Node 进程重启。
  验证：backend watch lifecycle tests 触发第二次成功编译，断言旧 backend-only 进程被关闭且新进程启动。
  来源：Source watch backend restarts after successful TypeScript compilation；Design D2。

- [x] 3.3 实现编译失败不重启到坏产物，并输出可观察诊断。
  验证：compile failure characterization test 触发 TypeScript watch 失败，断言 backend-only 进程未重启且诊断被输出。
  来源：Source watch backend restarts after successful TypeScript compilation；Design D2。

- [x] 3.4 验证后端重启不新增 runtime lifecycle、stream migration、in-flight request migration 或 gateway persistence 语义。
  验证：code review 检查点，确认改动仅限 dev-watch 编排、Vite proxy 和测试；不修改 runtime/channel/gateway public contract 或 stream projection 语义。该约束是架构边界，不能通过功能测试完整覆盖。
  来源：Source watch backend restarts after successful TypeScript compilation；proposal non-goals。

## 4. Packaged fullstack 边界回归

- [x] 4.1 添加或更新测试，证明 `dev:watch` 不调用前端静态 artifact build、`@nextagent/agent-web` artifact package 生成/安装、`with-frontend` 入口或前端静态托管插件注册。
  验证：fullstack packaging boundary regression tests。
  来源：Source watch mode preserves packaged fullstack boundary。

- [x] 4.2 保持 `dev:fullstack` 既有 packaged static hosting bootstrap 顺序和禁止 watch/HMR/Vite proxy 的语义不变。
  验证：现有 `tests/fullstack-packaging-boundary.test.ts` 或等效测试继续断言 `dev:fullstack` 顺序和负向边界。
  来源：Source watch mode preserves packaged fullstack boundary；既有 fullstack-packaging-boundary stable spec。

- [x] 4.3 验证 `dev:watch` 不改变 `VITE_TRANSPORT_KIND` runtime transport 切换语义，并移除脚本级 `.env.websocket` / `dev:ws` transport override。
  验证：frontend dev profile tests 确认 `.env.websocket` 和 `dev:ws` 不存在，runtime config / stream transport tests 保持通过。
  来源：proposal non-goals。

- [x] 4.4 对齐前端 backend dev profile 和本地运行数据 hygiene：`.env.backend` 指向 `http://localhost:3000` 且默认 SSE，根 `.gitignore` 忽略 `data/`。
  验证：frontend dev profile tests 覆盖 `.env.backend` 和 `data/` ignore 断言；`git check-ignore -v data/system/nextagent.sqlite data/system/test-data/example.sqlite` 通过。
  来源：Frontend backend dev profile targets the default backend；Local runtime data stays out of version control。

## 5. 验证和收尾

- [x] 5.1 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-dev-watch-mode --strict`。
  来源：OpenSpec delta validity。

- [x] 5.2 运行相关单元/契约测试，覆盖 dev-watch 编排、Vite proxy 和 fullstack packaging 边界。
  验证：`npm test -- <相关测试文件>`。
  来源：design verification map。

- [x] 5.3 运行根构建，确认新增 dev-watch 脚本和测试不破坏 TypeScript project references。
  验证：`npm run build`。
  来源：AGENTS.md 验证门禁；Design quality attributes。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/fullstack-packaging-boundary/spec.md`，合入 `dev:watch` 行为契约。
- 更新 `openspec/designs/architecture/fullstack-packaging-boundary.md`，提炼 watch mode topology、backend-only auto restart 和 `dev:watch` / `dev:fullstack` 分工。
- 如实现新增 app-level public entry/helper，再更新 `openspec/designs/modules/agent-app.md`；否则不更新模块文档。
- 更新 `openspec/designs/spec-to-design-map.md` 的 `fullstack-packaging-boundary` 验证入口。
- 不新增 ADR，不更新 `openspec/overview.md`。
