## 1. 后端 Markdown 强制接受

- [ ] 1.1 在 `agent-attachment-runtime` staged upload 路径（`packages/agent-attachment-runtime/src/staged-upload-runtime.ts` 的 `uploadToTemp`）新增 markdown 强制接受逻辑：在 `matchFileExtension` 校验前判断文件扩展名是否为 `.md` 或 `.markdown`，若是则跳过 `matchFileExtension` 校验，直接进入后续 media type 映射和 magic bytes 校验；非 markdown 文件仍走 `matchFileExtension` 校验
  验证：`npm test -- ...agent-attachment-runtime` markdown 强制接受相关测试通过
  来源：spec「Markdown attachment is always accepted regardless of configuration」、design D1
- [ ] 1.2 新增 markdown 强制接受测试：构造 `chatUploadFileType: ["*.pcap"]` 配置，上传 `.md` 文件断言被接受；上传 `.pdf` 文件断言以 `FILE_TYPE_UNSUPPORTED` 被拒绝
  验证：测试实际触发并断言接受/拒绝行为
  来源：spec scenario「Markdown attachment is always accepted regardless of configuration」「Non-markdown attachment still respects configuration」
- [ ] 1.3 负例测试：markdown 文件仍受 magic bytes 校验；伪造 `.md` 文件（实际内容为 PDF magic bytes）以 `MAGIC_BYTES_MISMATCH` 被拒绝
  验证：测试断言 magic bytes 校验不被 markdown 强制接受绕过
  来源：spec scenario「Markdown attachment with mismatched magic bytes is rejected」

## 2. 前端长文本截断与引导提示

- [ ] 2.1 在 `frontend/agent-web` 新增 `LONG_TEXT_THRESHOLD = 2000` 常量，定义在 `src/constants/inputLimits.ts`
  验证：常量定义存在且被 MessageInput 引用
  来源：design D2
- [ ] 2.2 在 `MessageInput.tsx` 的 `handleTextChange` 中新增长文本截断：当 `text.length > LONG_TEXT_THRESHOLD` 时，自动截断至 2000 字符（`text.slice(0, LONG_TEXT_THRESHOLD)`），通过既有 `localNotice` 机制显示 warning 类型 inline notice，提示用户内容已截断并引导使用 .md 文件作为附件上传；不禁用发送按钮；新增 i18n key（zh-CN 和 en-US）
  验证：`cd frontend/agent-web && npm test -- ...` 长文本截断测试通过
  来源：spec scenario「输入超过 2000 字符时自动截断并提示」、design D2
- [ ] 2.3 在 textarea 下方新增字符计数器：当内容超过阈值的 90%（1800 字符）且未超过阈值时显示 `{count} / {threshold}` 计数器，使用 warning 色样式；新增 i18n key
  验证：`cd frontend/agent-web && npm test -- ...` 计数器显示测试通过
  来源：spec scenario「字符数接近阈值时显示计数器」、design D2
- [ ] 2.4 测试：输入超过 2000 字符的文本，断言 textarea 内容被截断至 2000 字符、inline notice 显示且包含截断和引导文案、发送按钮可用
  验证：`cd frontend/agent-web && npm test -- ...` 断言截断行为和提示
  来源：spec scenario「输入超过 2000 字符时自动截断并提示」
- [ ] 2.5 测试：输入不超过 2000 字符的文本，断言 textarea 内容不被截断、inline notice 不显示、发送按钮可用
  验证：`cd frontend/agent-web && npm test -- ...` 断言不触发截断
  来源：spec scenario「输入未超过 2000 字符时不截断不提示」
- [ ] 2.6 测试：截断后用户继续编辑时 inline notice 被清除；若编辑后内容仍超过 2000 字符则再次截断并重新显示提示
  验证：`cd frontend/agent-web && npm test -- ...` 断言提示清除和重新触发
  来源：spec scenario「截断后用户继续编辑时清除提示」
- [ ] 2.7 测试：粘贴超过 2000 字符的文本，断言与手动输入行为一致（截断 + 提示）
  验证：`cd frontend/agent-web && npm test -- ...` 断言粘贴路径行为
  来源：spec scenario「粘贴和手动输入行为一致」

## 3. 验证和收尾

- [ ] 3.1 后端常规验证：仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  验证：四条命令全部通过
  来源：AGENTS.md 验证门禁
- [ ] 3.2 前端验证：`cd frontend/agent-web && npm run build` 及相关 `npm test -- ...`；确认 local、immersive、collaborative 三宿主复用同一长文本截断和 session 删除逻辑，无平行业务语义
  验证：构建与测试通过；code review 检查三宿主入口未各自实现逻辑
  来源：AGENTS.md 验证门禁与前端边界约束
- [ ] 3.3 OpenSpec 验证：运行 `openspec validate --all --strict`
  验证：命令通过
  来源：AGENTS.md 验证门禁
- [ ] 3.4 清理检查：确认本 change 未引入未使用的 helper/export 或 test-only 残留；常量集中定义；无平行的上传或删除逻辑
  验证：diff code review 检查点
  来源：design 非目标、AGENTS.md 实现质量门禁

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的「归档前更新基线」处理：

- `openspec/specs/ts-attachment-intake/spec.md`：合并 markdown 强制接受语义到「Attachment intake enforces deterministic limits and type checks」requirement。
- `openspec/specs/agent-web-composer-input-limit/spec.md`：新增 capability spec。
- `openspec/overview.md`：稳定基线描述补充 markdown 强制接受和前端输入限制引导一句。
