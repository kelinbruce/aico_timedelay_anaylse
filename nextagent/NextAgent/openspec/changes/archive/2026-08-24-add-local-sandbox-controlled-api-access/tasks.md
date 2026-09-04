## 1. `FN-6.3 沙箱执行命令`

- [x] 1.0 确认前置 change `harden-default-sandbox-executable-policy` 已落地，且当前默认 executable policy 仍允许 `curl`、`python`、`python3` 进入 restricted local sandbox；本 change 不重复修改该名单。
  来源：proposal `规范上下文 / 前置依赖` + design `FN-6.3 沙箱执行命令 / 目标与规范依据`
  验证：运行 `openspec status --change harden-default-sandbox-executable-policy --json` 并执行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/config-assembly.test.ts tests/contract/memory-configuration-contracts.test.ts`；预期前置 change 的 executable policy tasks 已完成或对应提交已进入实施基线，且三项 executable 默认名单断言通过。
  完成证据：2026-08-13 运行 change status 显示 artifacts complete；release 配置实际收集 `tests/agent-kernel/config-assembly.test.ts` 并完成 68/68，默认名单断言通过。

- [x] 1.1 为 trusted `allowedApis` 配置建立目标行为测试：合法 HTTP(S) prefix 可加载，非法 scheme、credentials、query、fragment、非 `/` 结尾或规范化重复值使配置 `BLOCKED`，缺失值规范化为空名单且不可信输入不能覆盖；在实现前确认新增断言失败。
  来源：`FN-6.3` + `Local 模式从受信配置限制 API 目标` + `空名单默认拒绝网络访问`、`不可信输入不能覆盖名单`；design `FN-6.3 沙箱执行命令 / 修改方案 / 配置与 composition`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/configuration-composition.test.ts packages/agent-app/tests/gateway-composition.test.ts tests/contract/memory-configuration-contracts.test.ts tests/local-runtime-package.test.ts`；实现前目标断言失败，实现后合法配置为 `READY`、非法配置为 `BLOCKED`，且 provider/fallback factory 收到同一冻结名单。
  完成证据：2026-08-13 新增配置断言后先因 schema 不识别 `allowedApis` 失败；实现后聚焦组合测试通过。

- [x] 1.2 实现 app-owned `allowedApis` schema、规范化和 trusted composition，并通过 `LocalGatewayProviderOptions` 与 app-internal sandbox factory input 把同一冻结名单投影到 restricted local sandbox；不得修改 `SandboxExecutionRequest`、`GatewayProviderSandboxConfig` 或 remote sandbox 行为。
  来源：design `FN-6.3 沙箱执行命令 / 修改方案 / 配置与 composition`
  验证：运行 `npm run build` 和 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/configuration-composition.test.ts packages/agent-app/tests/gateway-composition.test.ts packages/agent-platform-gateway-local/tests/local-gateway-provider.test.ts tests/local-runtime-package.test.ts`；预期 typecheck/build 与两条创建入口的聚焦 tests 全部通过，并人工核对 `git diff -- packages/agent-contracts/src/gateway` 为空。
  完成证据：2026-08-13 `npm run build` 通过，相关组合/provider/runtime package 聚焦测试通过，`packages/agent-contracts/src/gateway` 无 diff。

- [x] 1.3 为 curl 受控 API normal/boundary/negative paths 编写黑盒测试：唯一末项受控 URL、相似 hostname、scheme/port/path mismatch、空名单、多 URL、URL glob、非 HTTP(S) 末项以及 spec 穷尽 forbidden route options 均有可观察断言；同时证明其他普通 curl option 不被本策略解析或误拒绝；实现前确认新增正常路径失败或未授权路径仍会启动。
  来源：`FN-6.3` + `Local 模式从受信配置限制 API 目标` + `合法受控 API 目标继续执行`、`URL origin 相似但不相同`、`URL path 越过受控 prefix`；`Local curl 只执行目标确定的受控请求` + `受控网络 URL 通过校验`、`curl 参数不能确定唯一目标`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；实现前至少一个目标拒绝断言失败，实现后仅唯一匹配请求启动，全部禁止形态在启动前返回安全 rejection。

- [x] 1.4 实现 local curl 单遍末项 URL classifier、结构化 URL matcher和少量 forbidden route option 集，并让同步、streaming 和 background execution 共用同一 pre-spawn 校验；不得复制完整 curl grammar，除 safe message 的未授权 URL 安全投影外不记录 URL 或 argv。
  来源：`FN-6.3` + `Local curl 只执行目标确定的受控请求` + `受控网络 URL 通过校验`、`curl 参数不能确定唯一目标`；design `FN-6.3 沙箱执行命令 / 修改方案 / curl 分类`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-capability/tests/bash-capability.test.ts`；预期 curl normal/negative、同步/streaming/background 和既有 sandbox tests 全部通过。

- [x] 1.5 为固定 Unix Socket 编写黑盒安全测试：两种 `/opt/sidecar/ir/http.sock` option 形式与受控 URL 同时匹配时继续执行；其他、重复或 abstract socket及未受控 URL在启动前拒绝；实现前确认目标断言失败。
  来源：`FN-6.3` + `Local curl 只执行目标确定的受控请求` + `固定 Unix Socket 与受控 API 同时匹配`、`Unix Socket 路径不匹配`；design `FN-6.3 沙箱执行命令 / 修改方案 / curl 分类`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；预期只有固定路径与唯一受控 URL组合进入 spawn，其他路径全部返回 safe rejection。

- [x] 1.6 实现 adapter-owned 固定 Unix Socket 常量及其与同一受控 URL 的联合校验，不引入 socket path 配置、stat/symlink 策略或 fallback；socket 缺失保持 curl 普通执行失败。
  来源：`FN-6.3` + `Local curl 只执行目标确定的受控请求` + `固定 Unix Socket 与受控 API 同时匹配`、`Unix Socket 路径不匹配`；design `FN-6.3 沙箱执行命令 / 修改方案 / curl 分类`
  验证：运行 `npm run build` 和 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；预期固定路径 positive/negative cases 与 build 全部通过，配置 schema 不出现 socket path 字段。

- [x] 1.7 为 Python 过渡检查建立目标行为测试：受控与未受控显式 URL、无 URL、动态构造目标、`-m`、inline/existing/Skill script、同步和 background 路径均有可观察断言；实现前确认至少一个未受控显式 URL 仍会启动。
  来源：`FN-6.3` + 系统质量属性“安全” + `Local Python 对可识别网络目标执行过渡检查` + `Python 字面量目标全部受控`、`Python 显式目标未受控`、`Python 动态目标不在过渡检查范围`、`非网络 Python 计算保持可用`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-capability/tests/python-capability.test.ts packages/agent-capability/tests/bash-capability.test.ts`；实现前目标安全断言失败，实现后受控显式目标继续执行、未受控显式目标拒绝，无 URL、动态目标与 module 保持既有路径。

- [x] 1.8 实现有界 Python source/argv URL literal classifier，在既有受治理路径翻译后读取 inline/existing/Skill script，仅拒绝未受控显式 URL，并复用安全 reason 和无内容日志；不得引入 marker 黑名单、AST、monkey patch、import 或强隔离声明。
  来源：`FN-6.3` + 系统质量属性“安全” + `Local Python 对可识别网络目标执行过渡检查` + `Python 字面量目标全部受控`、`Python 显式目标未受控`、`Python 动态目标不在过渡检查范围`、`非网络 Python 计算保持可用`；design `FN-6.3 沙箱执行命令 / 修改方案 / Python 分类`
  验证：运行 `npm run build` 和 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-capability/tests/python-capability.test.ts packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/sandbox-execution-port.test.ts`；预期全部 Python 目标行为、既有 invocation/path policy 与 build 通过。

- [x] 1.9 完成 `FN-6.3` 聚焦安全回归：证明 empty policy、hostname/path bypass、ambiguous curl、fixed socket、Python 未受控显式 URL和 background bypass 实际失败；同时证明动态 Python 目标未被错误宣称为已验证，且除 safe message 的未授权 URL 安全投影外，operational log 与 diagnostics 不包含 URL、source 或原始 argv。
  来源：`FN-6.3` + 系统质量属性“安全” + `Local Python 对可识别网络目标执行过渡检查`；design `FN-6.3 沙箱执行命令 / 质量属性影响`、`验证策略`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts tests/contract/gateway-configuration-contracts.test.ts tests/architecture/sandbox-execution-boundary.test.ts`；预期全部安全 negative cases 明确断言 pre-spawn rejection，architecture boundary 与无泄漏断言通过。
  完成证据：2026-08-13 restricted sandbox 聚焦回归 52 passed / 4 skipped；新增测试在实现前有五组安全断言失败，实现后同步、streaming、background、curl、socket 与 Python 显式目标断言全部通过。

- [x] 1.10 在 safe result `message` 返回第一个明确解析的未授权 URL 安全投影，同时清除 credentials、query 和 fragment；歧义拒绝保持通用 message，operational log、reason 和 diagnostics 不记录 URL。
  来源：`FN-6.3` + `Local 模式从受信配置限制 API 目标` + `拒绝消息返回不支持的 URL`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；预期 curl、Python、streaming 和 background 的 message 包含安全 URL，敏感 URL 部分与日志不泄漏，歧义拒绝仍为通用 message。
  完成证据：2026-08-13 新增断言先因 message 仍为通用文本失败；实现后 restricted sandbox 53 passed / 4 skipped，curl、Python、streaming 和 background 均返回安全 URL，歧义形态保持通用 message。

- [x] 1.11 在 `docs/developer` 的应用配置 owner 文档中提供可复制的 local sandbox 配置示例，说明 `allowedApis`、executable policy、固定 Unix Socket、拒绝结果和 Python best-effort 边界。
  来源：proposal `规范上下文`、`目标与非目标` + `FN-6.3` 三项 Requirements
  验证：核对文档示例与 `packages/agent-app/config/default-system.yaml`、配置 schema 和 restricted local sandbox 行为一致，运行 `openspec validate add-local-sandbox-controlled-api-access --strict` 与 `git diff --check`。
  完成证据：2026-08-13 示例写入 `docs/developer/12-deployment.md`，同时说明 minimal overlay、数组整体替换风险与 local best-effort 边界，并通过 strict change validation 和 diff check。

## 3. Bug 修复：remote deployment allowedApis 传递 & curl URL 提取

- [x] 3.1 修复 `agent-remote-deployment/src/index.ts`：在 `createRemoteNextAgentApp` 和 `startRemoteRuntimePackage` 中，`createRemoteSupportLocalGatewayProvider` 调用未传入 `allowedApis`，导致 remote deployment 模式下 sandbox `allowedApis` 始终为空。新增 `resolveDefaultSystemConfig` 导入并在模块顶层解析 `resolvedAllowedApis`，传入两处 provider 创建调用。
  来源：容器联调发现 `allowedApis=[]` 未传递
  验证：构建通过，provider 创建日志确认 `allowedApis` 非空

- [x] 3.2 新增 `agent-app/package.json` 的 `./config` 子路径 export，指向 `dist/config/system-config.js`，使外部包可通过 `@nextagent/agent-app/config` 导入 `resolveDefaultSystemConfig`。
  来源：修改 3.1 需要从外部包导入 config 函数
  验证：构建通过，import 路径解析正确

- [x] 3.3 修复 `restricted-local-sandbox.ts` 的 `validateCurlNetworkTarget`：原实现使用 `args.at(-1)` 取最后一个参数作为 URL，当 curl 命令末尾有 `2>&1` 等 shell 重定向时取到非 URL 参数导致误拒。改为从 args 中过滤出可被 `parseHttpUrl` 解析的参数作为 URL 候选，要求恰好一个可解析 URL。
  来源：容器联调发现 `curl ... http://... 2>&1` 被误拒
  验证：`npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts --config vitest.config.release.ts` 全部通过

- [x] 3.4 同步更新 spec delta：curl URL 提取从 argv 最后一项改为从 argv 过滤可解析 URL，更新 scenario 描述。
  来源：代码行为变更需同步 spec
  验证：`openspec validate add-local-sandbox-controlled-api-access --strict`

## 2. Change 整体验证

- [x] 2.1 完成 OpenSpec、构建、root test、contract 和 architecture 门禁，并确认变更只触及 active change、app config/composition、local gateway adapter 与直接相关测试。
  来源：proposal `影响范围` + design `验证策略`
  验证：运行 `openspec validate add-local-sandbox-controlled-api-access --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `git diff --check`；预期全部通过，并人工确认没有 public Web/API、remote sandbox、`SandboxExecutionRequest` 或 `GatewayProviderSandboxConfig` delta。
  完成证据：2026-08-13 change strict 和全量 OpenSpec 267/267、build、root 2103/2103、contract 387/387、architecture 307/307、`git diff --check` 全部通过；public gateway contracts 和 remote sandbox 无 diff。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 `sandbox-runtime`、`FN-6.3`、`F-6.3`、configuration boundary、两个 module design 和 `spec-to-design-map`；长期文档必须保留“local 过渡性 best-effort、非标准沙箱”的限制，并在标准沙箱替换时由后续 change 删除本策略。
