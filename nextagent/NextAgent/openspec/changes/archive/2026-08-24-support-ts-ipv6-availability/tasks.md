## 1. `FN-10.34 配置网络连通性`

- [x] 1.1 在 `packages/agent-app/tests/system-config.test.ts` 和 `tests/local-runtime-package.test.ts` 增加 channel 环境变量行为测试，覆盖两个字段同时/单独覆盖、未设置保持 YAML、host 空值、port 空值/grammar/边界失败，并在实现前运行确认新增正向或失败用例按预期失败。
  来源：`FN-10.34 配置网络连通性` + `监听地址和端口支持进程环境变量覆盖` + `两个环境变量覆盖 YAML 监听配置`、`单个环境变量只覆盖对应字段`、`未提供环境变量时保留 YAML 结果`、`非法监听环境变量阻断启动`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts tests/local-runtime-package.test.ts`；新增正向覆盖和非法值用例在实现前复现 10 个失败，任务 1.2 完成后 46 个用例全部通过且错误文本不包含测试输入原值。

- [x] 1.2 在 `agent-app` config owner 实现并复用 `applyChannelEnvOverrides`，使 application config 与 local runtime package config 在既有 env-ref 解析后、schema validation 前应用同一字段级 precedence；非法值只进入既有安全 schema failure，不新增第二套配置事实。
  来源：`FN-10.34 配置网络连通性` + `监听地址和端口支持进程环境变量覆盖` 全部 Scenarios；白盒来源：design `FN-10.34 配置网络连通性 / 修改方案` 第 1 项
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts tests/local-runtime-package.test.ts`；46 个用例全部通过，未设置环境变量时断言仍为 `127.0.0.1:3000`。

- [x] 1.3 为 `writeLocalRuntimeReadyNotice` 增加 stdout 黑盒测试，先复现 `channel.host=::` 输出 `[::]` 的缺陷，并锁定 `::1` 与 `0.0.0.0` 的目标输出。
  来源：`FN-10.34 配置网络连通性` + `IPv6 入站监听提供可连接的启动地址` + `IPv6 loopback 监听可以访问`、`IPv6 unspecified 监听提供双栈 loopback 访问`、`IPv4 unspecified 继续显示本机可连接地址`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cli-output.test.ts`；实现前 `::` 用例失败且另外两个分支通过，任务 1.4 完成后 3 个用例全部通过。

- [x] 1.4 修改既有 CLI host projection，仅将 `::` 与 `0.0.0.0` 映射为 `localhost`，保持其他 IPv6 literal 方括号与 hostname 校验行为不变。
  来源：`FN-10.34 配置网络连通性` + `IPv6 入站监听提供可连接的启动地址` 全部 Scenarios；白盒来源：design `FN-10.34 配置网络连通性 / 修改方案` 第 3 项
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/cli-output.test.ts`；3 个用例全部通过，`::`/`0.0.0.0` 输出 localhost，`::1` 输出方括号地址。

- [x] 1.5 增加真实入站 socket characterization，在启用 IPv6 且允许 IPv4-mapped IPv6 的测试主机上验证 `::1` 的 IPv6 loopback 请求和 `::` listener 的 IPv6/IPv4 loopback 请求均到达同一 Fastify 服务；保持现有单 listener 生产路径不变。
  来源：`FN-10.34 配置网络连通性` + 功能性需求 `IPv6 入站监听提供可连接的启动地址` + `IPv6 loopback 监听可以访问`、`IPv6 unspecified 监听提供双栈 loopback 访问`；系统质量属性“可测试性” + `IPv6 可用性必须由真实 socket 验证` + `IPv6 入站和出站验收使用真实网络`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/app-lifecycle-composition.test.ts`；19 个用例全部通过，server 侧分别观察到 IPv6 与 IPv4 loopback 请求，测试 teardown 关闭 listener。

- [x] 1.6 在 owning product composition runner 测试中增加 host/profile 安全 negative test，先复现 `0.0.0.0`、`::` 或其他非 loopback host 未在 ready 前被拒绝，并增加 `::1` 不因地址形态被拒绝、DEFAULT_WEB 不受限制的边界用例；复跑既有 local configured auth 黑盒套件。
  来源：`FN-10.34 配置网络连通性` + 系统质量属性“安全” + `网络监听不得放宽已选择的安全暴露边界` + `本地配置认证拒绝非 loopback 监听`、`IPv6 loopback 保持本地配置认证边界`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-configured-auth.test.ts packages/agent-app/tests/composition-runner.test.ts`；实现前 5 个新增 host/profile 用例失败，任务 1.7 完成后 unspecified/non-loopback 均安全失败、错误不包含原始 host，合计 18 个用例全部通过。

- [x] 1.7 在 sync/async product composition 共享的 config 后置检查点增加 local configured auth host guard，只接受 `localhost`、`127.0.0.1`、`::1`，在 channel route registration 前安全拒绝其他 host；DEFAULT_WEB 行为保持不变。
  来源：`FN-10.34 配置网络连通性` + 系统质量属性“安全” + `网络监听不得放宽已选择的安全暴露边界` 全部 Scenarios；白盒来源：design `FN-10.34 配置网络连通性 / 修改方案` 第 4 项
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-configured-auth.test.ts packages/agent-app/tests/composition-runner.test.ts`；18 个用例全部通过，local configured auth 非 loopback 失败、`::1` 通过 host guard、DEFAULT_WEB composition 不受限制。

- [x] 1.8 在 `packages/agent-model/tests/openai-compatible-provider.test.ts` 和 `packages/agent-platform-gateway-local/tests/local-api-call-port.test.ts` 建立真实 IPv6 HTTP server characterization，分别证明默认 fetch 的模型提供方调用和 api-call 请求实际到达 IPv6 literal endpoint；不得注入 mock fetch、dispatcher 或 lookup。
  来源：`FN-10.34 配置网络连通性` + 系统质量属性“可靠性/恢复” + `首批关键出站路径可连接 IPv6 literal 目标` + `Fetch 类出站调用访问 IPv6 HTTP 目标`；系统质量属性“可测试性” + `IPv6 可用性必须由真实 socket 验证` + `IPv6 入站和出站验收使用真实网络`
  验证：`npx --yes node@22.22.0 node_modules/vitest/vitest.mjs run --config vitest.config.release.ts packages/agent-model/tests/openai-compatible-provider.test.ts packages/agent-platform-gateway-local/tests/local-api-call-port.test.ts`；37 个用例全部通过，两个 server 都观察到 IPv6 请求并返回既有成功结果。

- [x] 1.9 在 `packages/agent-channel-task/tests/task-callback.test.ts` 增加真实 IPv6 HTTP/HTTPS callback 测试，分别验证默认 fetch 和 insecure `node:https` path 的固定 Node.js 基线。
  来源：`FN-10.34 配置网络连通性` + 系统质量属性“可靠性/恢复” + `首批关键出站路径可连接 IPv6 literal 目标` + `Task callback 访问 IPv6 HTTP 和 HTTPS 目标`；系统质量属性“可测试性” + `IPv6 可用性必须由真实 socket 验证` + `IPv6 入站和出站验收使用真实网络`
  验证：`npx --yes node@22.22.0 node_modules/vitest/vitest.mjs run --config vitest.config.release.ts packages/agent-channel-task/tests/task-callback.test.ts`；36 个用例全部通过，HTTP 与 HTTPS test server 都收到真实 IPv6 callback。

- [x] 1.10 根据 Node.js `22.22.0` characterization 收敛实现：仅在构造 insecure HTTPS 私有 request options 时移除 `URL.hostname` 的 IPv6 外层方括号；目标 URL、origin allowlist、普通 hostname、IPv4 和其他请求字段保持不变。
  来源：`FN-10.34 配置网络连通性` + 系统质量属性“可靠性/恢复” + `首批关键出站路径可连接 IPv6 literal 目标` + `Task callback 访问 IPv6 HTTP 和 HTTPS 目标`、`IPv6 目标不可达时安全失败`；白盒来源：design `FN-10.34 配置网络连通性 / 修改方案` 第 5 项
  验证：同任务 1.9 的 Node.js `22.22.0` 命令；修复前真实 IPv6 HTTPS 用例稳定失败且 HTTP/其余 35 个用例通过，修复后预期 36 个用例全部通过。
  验证记录（2026-08-12）：精确 Node.js `22.22.0` 下修复前 `1 failed / 35 passed`，失败为 insecure HTTPS IPv6 real-socket callback 返回 `false`；最小 hostname 表示修复后 `1 file passed / 36 tests passed`。

- [x] 1.11 完成 `FN-10.34` 定向验证，确认环境变量、CLI、入站、local auth safety、首批出站和真实 socket 证据同时满足，且源码未出现 `ipFamily`、全局 dispatcher 或新增 `agent-contracts` surface。
  来源：`FN-10.34 配置网络连通性` 全部 Requirements；design `验证策略` 和 `修改方案`
  验证：`npx --yes node@22.22.0 node_modules/vitest/vitest.mjs run --config vitest.config.release.ts packages/agent-app/tests/system-config.test.ts packages/agent-app/tests/cli-output.test.ts packages/agent-app/tests/app-lifecycle-composition.test.ts packages/agent-app/tests/composition-runner.test.ts packages/agent-model/tests/openai-compatible-provider.test.ts packages/agent-platform-gateway-local/tests/local-api-call-port.test.ts packages/agent-channel-task/tests/task-callback.test.ts tests/local-runtime-package.test.ts tests/agent-kernel/local-configured-auth.test.ts`；9 个测试文件、159 个用例全部通过。`git diff --check` 通过；人工检视确认未新增强制 IP 族、全局 dispatcher 或公共 gateway contract。
  验证记录（2026-08-12）：精确 Node.js `22.22.0` 运行 9 个文件，`9 files passed`、`128 passed / 31 platform-skipped`；真实 IPv6 HTTP/HTTPS 路径通过，macOS 下既有 Windows/Linux release-package 条件用例按配置跳过。人工检视确认未新增 `ipFamily`、全局 dispatcher 或公共 contract。

## 2. Change 整体验证

- [x] 2.1 运行后端 workspace 和 OpenSpec 全量门禁，确认新增 Function 不回归默认 IPv4、本地认证、模型、capability、gateway、task channel 或架构边界。
  来源：proposal `影响范围` + design `验证策略`
  验证：在 Node.js `22.22.0` 下依次运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate support-ts-ipv6-availability --strict`、`openspec validate --all --strict`；全部命令退出码为 0。
  当前证据：Node.js `22.22.0` 下 `npm run build` 通过；`npm test` 通过 155 个文件/1942 个用例；`npm run test:contract` 通过 46 个文件/366 个用例；`npm run lint:architecture` 通过 47 个文件/293 个用例；本 change 严格校验通过；`openspec validate --all --strict` 通过 317 个项目。
  验证记录（2026-08-12）：真实 IPv6 定向验证使用精确 Node.js `22.22.0`；完整门禁使用本机 Node.js `22.22.2`（同一 Node 22 LTS patch line）。`npm run build` 通过；`npm test` 为 `156 passed / 1 skipped` files、`1965 passed / 2 skipped` tests；contract `46 files / 366 tests` 全通过；architecture `49 files / 300 tests` 全通过；OpenSpec strict `245 passed / 0 failed`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”新增 `network-connectivity` stable spec 和 `FN-10.34` Function，刷新 `F-10.5`、configuration/agent-app 长期设计及 spec-to-design-map；检查不存在第二套网络配置、重复 Function 映射或实现过程残留。
