## 1. 参数注入语义

- [x] 1.1 `executePythonNode` 读取 `param_to_json_str`（`coerceBoolean`，默认 `false`），跳过 `script` 和 `param_to_json_str` 取变量输入
  验证：`npm run build`；单元测试断言 `param_to_json_str` 不出现在注入代码中
  来源：design D1

- [x] 1.2 实现普通模式（`param_to_json_str=false`）类型化字面量：`null`/`undefined`→`None`、`true`→`True`、`false`→`False`、数字原样、数字字符串原样、其他 `JSON.stringify`
  验证：`npm run build`；单元测试覆盖各类型
  来源：design D2

- [x] 1.3 实现 JSON 字符串模式（`param_to_json_str=true`）：所有值 `JSON.stringify` 后用 `r'''...'''` 包裹
  验证：`npm run build`；单元测试断言注入代码格式
  来源：design D3

## 2. 输出处理语义

- [x] 2.1 新增 `resolvePythonResult` helper：从 capability payload 取 `stdout`，按 `\n` 分割并过滤末尾空行，近似 print 输出条数
  验证：`npm run build`；单元测试覆盖 0/1/N 条
  来源：design D4

- [x] 2.2 实现输出解析规则：0 条→`null`；1 条→该条（合法 JSON 对象/数组解析，否则原字符串）；多条→列表分别解析
  验证：`npm run build`；单元测试覆盖 JSON 对象/数组/非 JSON/混合
  来源：design D5

- [x] 2.3 `executePythonNode` 用 `resolvePythonResult` 替换 `expandStdoutJsonFields`；`python_result` 不再含 `exit_code`/`stderr`/`timed_out`/`_trace`
  验证：`npm run build`；集成测试断言 `python_result` shape
  来源：design D5

- [x] 2.4 `expandStdoutJsonFields` 和 `reservedPythonResultKeys` 保留：`knowledge-nodes.ts` 仍引用 `reservedPythonResultKeys`，`workflow-shared-fixes.test.ts` 仍测试 `expandStdoutJsonFields`；仅 `executePythonNode` 不再调用 `expandStdoutJsonFields`
  验证：`npm run build`；`npm run lint:architecture`
  来源：design Delta 3

## 3. 测试更新

- [x] 3.1 更新 `workflow-capability-nodes.test.ts` 中 python 相关用例：断言 `python_result` 为纯结果（无 `exit_code`/`stdout`）
  验证：`npm test`
  来源：design Verification

- [x] 3.2 新增用例：普通模式各类型注入、JSON 字符串模式注入、跳过保留 key
  验证：`npm test`
  来源：spec Scenario Param Injection Normal Mode / JSON String Mode / Reserved Keys

- [x] 3.3 新增用例：0/1/N 条 print 输出处理、JSON 解析、非 JSON 原字符串、结果不含执行元数据
  验证：`npm test`
  来源：spec Scenario Single Print / Multiple Print / No Print / Result Excludes Metadata

## 4. 验证

- [ ] 4.1 `openspec validate --all --strict` 未运行（CLI 不可用，npm `openspec` 为空壳包，GitHub 安装受网络限制）
  验证：`openspec validate --all --strict`
  来源：OpenSpec 门禁

- [x] 4.2 `npm run build` 通过
  验证：`npm run build`
  来源：build 门禁

- [x] 4.3 `npm test` 通过（含 agent-workflow 相关用例）
  验证：`npm test`
  来源：test 门禁

- [x] 4.4 `npm run test:contract` 通过
  验证：`npm run test:contract`
  来源：contract 门禁

- [x] 4.5 `npm run lint:architecture` 通过
  验证：`npm run lint:architecture`
  来源：architecture 门禁
