## 1. Spec

- [x] 1.1 更新 Bash 与 sandbox specs，使命令权限由 sandbox gateway 的 denylist 策略拥有，而不是 Bash capability。路径、文件系统、环境和文件类型校验从 gateway 移除。
  验证：`openspec validate --all --strict` 退出码为 0。

## 2. 实现

- [x] 2.1 修改 Bash capability，通过 sandbox token 化并提交命令，不使用 tool 拥有的 executable allowlist 或按命令的参数授权。
  验证：`npm test -- packages/agent-capability/tests/bash-capability.test.ts` 退出码为 0。
- [x] 2.2 把受限 local sandbox 从 executable allowlist 改为 denylist。从 `validateRequest` 移除路径参数校验、文件系统 root 限制、环境 allowlist 检查和文件类型检查。
  验证：`npm test -- packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts` 退出码为 0，并覆盖 denylist 拒绝、非拒绝执行和无法解析可执行文件时的 fail-closed。
- [x] 2.3 在 component-config、validation、create-app、tool-catalog-projection 和 bash-schemas 中用 `deniedExecutables` 替换 `builtinExecutables` 配置。
  验证：`npm run build` 退出码为 0。
- [x] 2.4 保持 Python 行为不变并经 sandbox 路由。
  验证：`npm test -- packages/agent-capability/tests/python-capability.test.ts` 退出码为 0。

## 3. 验证

- [x] 3.1 运行 Bash、Python 和受限 local sandbox 的聚焦测试。
  验证：`npm test -- packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/python-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts` 退出码为 0。
- [x] 3.2 运行 build 和 OpenSpec 校验。
  验证：`npm run build` 和 `openspec validate --all --strict` 退出码为 0。
