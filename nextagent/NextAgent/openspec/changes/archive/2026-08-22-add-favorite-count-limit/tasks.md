## 1. Gateway 收藏计数上限校验

- [x] 1.1 在 `agent-platform-gateway-local` `sqlite-gateway-core.ts` 的 `saveAnnotation` 事务内新增收藏计数上限校验：固定常量 `MAX_FAVORITES_PER_USER_SCOPE = 100`；INSERT 路径当 `record.isFavorited === true` 时、UPDATE 路径当 `existing.is_favorited !== 1 && updatedIsFavorited === true` 时，执行 scope `(tenantId, subjectId)` 内 `SELECT COUNT(*) ... WHERE is_favorited = 1` 计数（去掉 `agent_id` 条件，跨所有 agent 共享配额），计数 >= 100 时返回 `annotationSafeError("FAVORITE_LIMIT_EXCEEDED", "VALIDATION", ..., false)`；校验位于幂等重放解析与净新增判定之后、INSERT/UPDATE 之前
  验证：`npm test -- ...agent-platform-gateway-local` 收藏上限相关测试通过
  来源：spec「收藏数量上限」、design D1/D2/D3/D4/D7
- [x] 1.2 新增收藏上限 characterization 测试：构造同一 scope 连续收藏至 100（第 100 个被接受），随后第 101 个以 `FAVORITE_LIMIT_EXCEEDED` 被拒绝
  验证：测试实际触发并断言稳定错误码、category `VALIDATION`、`retryable=false`
  来源：spec scenario「第 100 个收藏被接受」「第 101 个收藏被拒绝」
- [x] 1.3 负例测试：超限拒绝无任何 side effect——不插入新行、scope 内 `is_favorited=1` 行数不变、既有行不被修改
  验证：测试断言上述状态在超限拒绝后保持不变
  来源：spec scenario「第 101 个收藏被拒绝」
- [x] 1.4 放行测试：取消收藏（true→false）在已达上限时接受；已收藏行重新收藏（true→true）不触发计数校验；已收藏行单独更新 sentiment 不触发计数校验
  验证：测试断言这些操作在 100 收藏上限下均成功且不报超限错误
  来源：spec scenario「取消收藏不受上限影响」「已收藏行重新收藏不触发上限」「已收藏行更新 sentiment 不触发上限」
- [x] 1.5 跨 agent 共享配额测试：scope `(T1,U1)` 达 100 后（分布在 agent A1 和 A2 的 run 上），agent A2 的新收藏以 `FAVORITE_LIMIT_EXCEEDED` 被拒绝
  验证：测试断言配额按用户聚合，不按 agent 隔离
  来源：spec scenario「跨 agent 共享配额」
- [x] 1.6 supersede 清理释放配额测试：达 100 后 supersede 清理删除一个被收藏 run 的标注，随后新收藏被接受
  验证：测试断言清理后计数回退、新收藏成功
  来源：spec scenario「supersede 清理释放配额」
- [x] 1.7 幂等重放优先级测试：达 100 后，以相同 idempotency key 重放已 accepted 的收藏，返回首次结果且不报超限错误
  验证：测试断言重放返回原结果且无新行
  来源：spec scenario「幂等重放不受上限影响」、design D5

## 2. Web channel 安全错误透传

- [x] 2.1 验证 `POST /api/v1/sessions/:sessionId/runs/:runId/annotations` 超限响应透传 safe error（稳定 code `FAVORITE_LIMIT_EXCEEDED`、HTTP 400、`retryable=false`），且不包含 tenant、subject、storage、SQL、stack trace 等敏感细节；若现有 channel 错误映射已覆盖则只补测试，不改代码
  验证：`npm run test:contract` 或 channel 错误映射测试实际断言响应体字段与状态码
  来源：spec scenario「超限安全错误的 Web 投影」、design D4

## 3. agent-web 超限回滚与提示

- [x] 3.1 `frontend/agent-web` 在 `TurnBlock.callAnnotationApi` 收到 `FAVORITE_LIMIT_EXCEEDED` 错误后，回滚乐观收藏状态至操作前，并以 message 提示展示专门的数量超限文案（i18n key `turn.favoriteLimitError`，zh-CN「收藏已达上限，请先取消部分收藏后再收藏」及 en-US 对应文案）；非超限错误保留通用 `turn.annotationError` 文案
  验证：`cd frontend/agent-web && npm test -- ...` 相关组件测试通过
  来源：spec scenario「local 前端超限回滚与提示」、design D6
- [x] 3.2 i18n 资源补充：zh-CN 与 en-US 新增 `turn.favoriteLimitError` 文案
  验证：i18n 资源文件 diff 检查；前端测试断言文案
  来源：design D6
- [x] 3.3 前端负例测试：非 `FAVORITE_LIMIT_EXCEEDED` 错误仍展示通用 `turn.annotationError` 文案；超限错误展示专门文案且收藏图标恢复操作前状态
  验证：`cd frontend/agent-web && npm test -- ...` 断言两种错误路径
  来源：AGENTS.md 负例验证要求、design D6
- [x] 3.4 `frontend/agent-web` remote 宿主（`immersive`/`piu` 模式）前置检查：在 `TurnBlock` 净新增收藏（`isFavorited` 从 false→true）前，先调用 `annotationService.listFavoriteTurns(0, 100)`，若 `entries.length >= 100` 则不发 upsert 请求，回滚乐观状态并展示 `turn.favoriteLimitError` 提示；local 宿主不做前置查询，依赖 gateway enforce + 错误回滚
  验证：`cd frontend/agent-web && npm test -- src/features/chat/components/TurnBlock.favoriteLimit.test.tsx`，remote 前置检查组件测试通过
  来源：spec scenario「remote 前端前置检查」、design D7
- [x] 3.5 remote 前置检查负例测试：`entries.length < 100` 时正常发送 upsert 请求；取消收藏不触发前置查询；local 模式不触发前置查询
  验证：`cd frontend/agent-web && npm test -- src/features/chat/components/TurnBlock.favoriteLimit.test.tsx`，断言上述路径
  来源：AGENTS.md 负例验证要求、design D7

## 4. 验证和收尾

- [x] 4.1 后端常规验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：四条命令全部通过
  来源：AGENTS.md 验证门禁
- [x] 4.2 前端验证：`cd frontend/agent-web && npm run build` 及相关 `npm test -- ...`；确认 local、immersive、collaborative 三宿主复用同一收藏提示逻辑，无平行业务语义
  验证：构建与测试通过；code review 检查三宿主入口未各自实现提示逻辑
  来源：AGENTS.md 验证门禁与前端边界约束
- [x] 4.3 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁
- [x] 4.4 清理检查：确认本 change 未引入配置项、未使用的 helper/export 或 test-only 残留；gateway 权威上限保持单一常量来源，remote 前置检查的 100 为已文档化受控例外
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的「归档前更新基线」处理：

- `openspec/specs/conversation-annotation/spec.md`：合并「收藏数量上限」requirement。
- `openspec/overview.md`：稳定基线描述补充收藏上限一句。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充上限常量与事务内 enforce 语义。
