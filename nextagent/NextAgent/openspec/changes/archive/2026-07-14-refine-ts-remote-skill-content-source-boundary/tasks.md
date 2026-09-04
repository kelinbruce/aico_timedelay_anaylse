## 1. 规格和配置边界重整

- [x] 1.1 更新 active change proposal/design/spec，明确通用能力是 Remote Skill Content Source，而不是 SkillHub ZIP package source；同时确认 provider kind 继续使用既有 `SKILL_HUB`，用户配置类型继续使用 `skill-hub`。
  验证：文档 review；`openspec validate refine-ts-remote-skill-content-source-boundary --strict`
  来源：design D1, D2；spec `SkillHub Source MUST Be A Gateway-Backed Remote Skill Content Source`

- [x] 1.2 调整 provider/gateway 配置目标规格：`SKILL_HUB` provider options 只引用 `gatewayId` 和 managed install/cache reference，具体 URL、credential resolution、HTTP path 和 wire DTO 属于 remote gateway adapter 或部署 overlay。
  验证：配置 spec/design review；`openspec validate refine-ts-remote-skill-content-source-boundary --strict`
  来源：design D2, D3；spec Scenario `Provider references gateway without service URL`

- [x] 1.3 调整 default-system 文档目标形状，确保仓库默认配置目标态不包含真实 URL、endpoint、credentialRef、token、tenant/subject 私有数据或 raw remote payload；实际配置修改由 4.1 承载。
  验证：文档 review；`openspec validate refine-ts-remote-skill-content-source-boundary --strict`
  来源：design D8；spec `Default Configuration MUST Remain Structural`

- [x] 1.4 实施前完成 `agent-contracts/capability` 契约确认：确认继续使用 `SKILL_HUB` provider kind、SkillHub provider options 收敛为 `gatewayId` + managed install/cache reference、RemoteSkillContentAccessPort 的 owner/export 位置，以及 access port 返回 normalized staged Skill folder 而不是 endpoint、package bytes、archive kind 或 service-private payload。
  验证：代码确认 `packages/agent-contracts/src/capability/index.ts` 中 `SkillHubOptions` 为 `gatewayId` + `managedInstallRef`，`packages/agent-capability/src/skillhub/skillhub-types.ts` 中 `SkillHubRemoteAccessPort.fetchContent` 返回 `stagingRoot` + `stagedFolder`；`npm run build`
  来源：AGENTS.md Push/Commit 约束；design D2, D4, D5；spec `Remote Skill Content Access MUST Return Normalized Skill Folders`

## 2. Remote Skill Content Source 实现重构

- [x] 2.1 将 `agent-capability` 中 SkillHub-specific source internals 重构为 provider-neutral remote Skill content source owner；保留 legacy SkillHub compatibility wrapper 只作为适配层入口。
  验证：`npm test -- packages/agent-capability/tests/skillhub-source.test.ts`; focused remote skill source tests
  来源：design D1, D6

- [x] 2.2 调整 `agent-contracts/capability` 与 `agent-capability` 使用的 SkillHub provider options / capability-owned remote content access port：继续使用 `SKILL_HUB` provider kind，但 options 不再要求 `endpoint`，`agent-capability` 只调用 `listCandidates` 和 `fetchContent`，不接触 endpoint、HTTP client、SkillHub wire DTO 或 concrete gateway implementation。
  验证：`npm run build`; `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts packages/agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=4`
  来源：design D3, D4；spec Scenario `Capability package depends only on injected access port`

- [x] 2.3 将 `downloadPackage` / `packageBytes` 通用语义替换为 normalized staged Skill folder 语义；archive kind、archive bytes、single-file payload 和 service-private response shape 由 gateway adapter 消化，`agent-capability` 只做 folder intake validation、root `SKILL.md` validation、managed install 和 catalog governance。
  验证：`npm run build`; `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts --maxWorkers=4`
  来源：design D4, D5；spec `Remote Skill Content Access MUST Return Normalized Skill Folders`

- [x] 2.4 增加 single `SKILL.md` normalization 正路径测试，证明远端 gateway 将单文件内容归一化为 staged Skill folder 后，不需要 capability 感知 ZIP extraction 也能产生 governed Skill descriptor。
  验证：`packages/agent-capability/tests/skillhub-source.test.ts` 中 `installs a single SKILL.md content artifact without ZIP extraction`; `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts --maxWorkers=4`
  来源：spec Scenario `Single SKILL.md remote content installs without ZIP`

- [x] 2.5 保留 ZIP normalization / folder intake 安全测试，但将 ZIP 下载、解码、解压限定为 gateway-owned compatibility boundary；`agent-capability` 对归一化后的 staged folder 继续对 unsafe path/link/type/budget fail closed。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts packages/agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts --maxWorkers=4`
  来源：spec Scenario `Archive formats are normalized before capability intake`; Scenario `Invalid staged folder fails closed`

- [x] 2.5a 增加 invalid staged folder negative test：gateway 返回越界 staging root、指向 committed install directory、unsafe link/path、缺失 root `SKILL.md`、多 descriptor entry 或预算超限时必须 fail closed，且不得贡献 descriptor 或 provider-private active fact。
  验证：`packages/agent-capability/tests/skillhub-source.test.ts` 中 `rejects staged folders outside the controlled staging root without publishing descriptors or active facts` 及既有 unsafe package/budget negative tests；`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts --maxWorkers=4`
  来源：spec Scenario `Invalid staged folder fails closed`; Scenario `Gateway cannot publish directly to committed install`; Scenario `New SkillHub service format does not change capability core`

- [x] 2.6 将 provider-private index/loading facts 调整为 provider-neutral content facts；唯一 key 仍为 trusted owner/agent/provider/skill；服务格式私有的一致性事实必须在进入 capability installed fact 或 managed index 前归一化为 content consistency。
  验证：index merge tests；legacy `skillhub-index.json` upgrade tests；catalog discovery tests；边界检查确认新 installed fact / managed index 不保留 concrete adapter 的服务格式事实
  来源：design D6；spec `Provider-Private Installed Facts MUST Be Provider-Neutral`

- [x] 2.6a 覆盖 remote Skill content 安装幂等、失败替换保护和升级清理验收点：同一 content consistency token 重复安装不得产生额外 committed directory；publish 失败不得覆盖旧 index 或暴露 partial staging；同一 scope/provider/skill 的 content consistency 变化后必须覆盖 active fact 并 best-effort 清理旧 committed directory。
  验证：remote Skill content reinstall / failed replacement / upgrade cleanup tests；测试应覆盖非 ZIP 单文件内容和 legacy ZIP compatibility 输入最终走同一 content consistency 路径
  来源：spec Scenario `Reinstalling the same content is idempotent`; Scenario `Failed replacement preserves the previously indexed content`; Scenario `Skill upgrade replaces content fact`

## 3. Remote Gateway 适配层

- [x] 3.1 将当前 SkillHub HTTP/ZIP 行为从通用 capability contract 中移出，收敛为 gateway-owned compatibility boundary：URL、credential、`/skills/search`、`/skills/package`、`packageBytesBase64` 和 SkillHub-specific safe errors 不得留在 `agent-capability` 通用 source 内；本 change 不新增完整生产级 concrete remote gateway adapter。
  验证：`rg -n "downloadPackage|packageBytes|contentBytes|contentText" packages/agent-capability/src packages/agent-app/src` 无结果；`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts --maxWorkers=4`
  来源：design D3

- [x] 3.2 增加或调整 fake/single-file gateway boundary 测试，证明不同 SkillHub 服务形状可由 gateway 归一化为同一 staged Skill folder access port；测试使用 fake/compatibility adapter，不要求真实远端服务 adapter 可用。
  验证：`packages/agent-capability/tests/skillhub-source.test.ts` fake remote 将 ZIP/single-file 归一化到 staged folder；`packages/agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts`; focused tests 通过
  来源：spec Scenario `Gateway owns concrete SkillHub service access`

- [x] 3.3 更新 app composition，使 provider `gatewayId` 解析为 selected gateway boundary adapter，并包装为 capability-owned access port 注入；本 change 可解析到 fake/compatibility boundary adapter，真实远端服务 adapter 由后续 change 承载；不得通过 fallback 或隐式注入绕过配置解析。
  验证：`npm run build`; `npx vitest run --config vitest.config.release.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=4`
  来源：design D2, D3

- [x] 3.3a 收窄 app composition 的路径基准：`skill-hub.installDir` 相对 `workspaceRoot` 解析以承载 managed install/cache content；`mcp-server` / `agent-registry` 的相对 `file:` credential 仍按配置根解析，不随 SkillHub installDir 迁移。
  验证：`npx.cmd vitest run --config D:\code\NextAgent\vitest.config.release.ts packages/agent-app/tests/composition.test.ts`（10 tests passed）
  来源：spec Scenario `Skill-hub maps to gateway-backed provider options`; spec `Provider references and credentials are validated during startup`

- [x] 3.4 收拢具体 SkillHub HTTP/ZIP compatibility 的 owner 边界：服务协议、HTTP path、wire DTO、credential resolution、`packageBytesBase64`、archive/package decode 和 normalized staged folder materialization 必须归 `agent-platform-gateway-remote` 的 concrete gateway adapter 或部署 overlay；`agent-capability` 生产代码不得保留 ZIP/packageBytes extraction 职责，只保留 provider-neutral access port consumption、staged folder intake、manifest validation、managed install 和 catalog governance。
  验证：`npx.cmd vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts packages/agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts tests/agent-kernel/config-assembly.test.ts tests/capability-source-configuration/source-config.test.ts --maxWorkers=4`（89 tests passed）；`rg -n "extractZipPackage|packageBytes|packageBytesBase64|skillhub-zip" packages/agent-capability/src` 无输出；`npm.cmd run build`；`npm.cmd test`（377 passed, 1 skipped）；`npm.cmd run test:contract`（193 passed）；`npm.cmd run lint:architecture`（dependency-cruiser/package manifest/architecture tests passed，120 tests passed）；`openspec.cmd validate refine-ts-remote-skill-content-source-boundary --strict`
  来源：design D3, D5, D9；spec `Remote Skill Content Access MUST Return Normalized Skill Folders`

- [x] 3.5 清理 Capability-owned production 命名中的 package/download 遗留语义，确保 Capability 侧以 remote content 或 staged folder 语义表达 intake、budget、fetch failure 和 install publication；具体 gateway adapter 内部映射 legacy SkillHub HTTP/ZIP wire facts 时可保留 adapter-private package/hash 命名，但不得让这些服务格式事实跨入通用 source contract、installed fact 或 managed index。
  验证：边界搜索确认 package/download/ZIP 语义仅停留在 concrete gateway adapter 或测试 fixture；focused source/gateway/config tests 通过；`npm.cmd run build`; `npm.cmd test`；`npm.cmd run test:contract`；`npm.cmd run lint:architecture`；`openspec.cmd validate refine-ts-remote-skill-content-source-boundary --strict`
  来源：design D6, D9；spec `Provider-Private Installed Facts MUST Be Provider-Neutral`

## 4. 默认 Agent 和默认配置

- [x] 4.1 更新 `packages/agent-app/config/default-system.yaml`：gateway/provider 可同文件但分段；provider 只引用 gateway id；默认配置不得包含真实 URL、credentialRef 或其他私有远端事实。
  验证：diff review；config validation tests
  来源：spec Scenario `Gateway and provider are separate sections`; `Default config has no real URL or ref`

- [x] 4.2 检查 default-agent binding 仍是显式 Agent capability binding，并继续经过 provider registration、source authorization、remote gateway access、normalized folder intake validation、manifest validation 和 catalog governance。
  验证：config/composition tests；catalog governance tests
  来源：spec Scenario `Default remote Skill provider remains governed`

## 5. 验证和收尾

- [x] 5.1 运行 focused remote Skill source、fake/compatibility gateway boundary tests 和 legacy ZIP normalization compatibility tests。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts packages/agent-platform-gateway-remote/tests/skillhub-remote-gateway.test.ts tests/agent-kernel/config-assembly.test.ts --maxWorkers=4`（86 tests passed）
  来源：design Verification Map

- [x] 5.2 运行 OpenSpec change 校验。
  验证：`openspec validate refine-ts-remote-skill-content-source-boundary --strict`
  来源：proposal 验证入口

- [x] 5.3 运行常规工程门禁。
  验证：`npm run build`; `npm test`（377 passed, 1 skipped）；`npm run test:contract`（193 passed）；`npm run lint:architecture`（dependency-cruiser/package manifest/architecture tests passed）；`openspec validate --all --strict`（170 passed）
  来源：AGENTS.md 验证门禁

- [x] 5.4 检查最终 diff 只包含 active change artifacts、remote Skill source boundary / app composition / default config / tests 所需文件；若必须触达具体 gateway adapter 或其他文件，补充原因到 design/tasks。
  验证：`git diff --name-only`
  来源：proposal 影响范围；design scoped implementation path

  实施说明：本 change 触达 `packages/agent-platform-gateway-remote` 的现有 SkillHub HTTP/ZIP compatibility adapter 及其测试，仅用于把 `gatewayId` 纳入 gateway-owned adapter selection 输入，并证明 URL、credential、`/skills/search`、`/skills/package`、`packageBytesBase64` 仍停留在 concrete gateway adapter 边界；`agent-capability` 通用 source 不消费这些 adapter-private facts。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 remote Skill source / SkillHub source 长期 spec。
- 按需更新 `openspec/designs/architecture/capability-spi.md`。
- 按需更新 `openspec/designs/modules/agent-capability.md`。
- 按需更新 `openspec/designs/modules/agent-platform-gateway-remote.md`。
- 按需更新 `openspec/designs/modules/agent-app.md`。
- 按需更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义。
