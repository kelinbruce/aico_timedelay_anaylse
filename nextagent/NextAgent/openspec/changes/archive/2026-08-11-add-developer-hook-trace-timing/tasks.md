- [x] 1. Update OpenSpec delta for developer hook trace timing metadata.
- [x] 2. Add model result timing fields to runtime lifecycle boundary types.
- [x] 3. Emit first-model-feedback and E2E model latency from the core model invocation path.
- [x] 4. Add developer hook trace print timestamp and promoted model timing fields in SDK and generated artifact.
- [x] 5. Cover SDK formatter/artifact and core model timing with tests.
- [x] 6. Run targeted validation.
- [x] 7. Redefine first-token latency as the first model stream feedback, including tool-call rounds.
- [x] 8. Keep all developer trace lifecycle payloads and model timing only in `boundary` to remove duplicate log data.
- [x] 9. Remove the packaged `config/default-agent.yaml` duplicate and resolve the active Agent from `agents/` only.
- [x] 10. Verify that developer hook trace remains executable when model timing metadata is absent.
- [x] 11. Verify that the generated plugin artifact remains executable without an `agent-app` timing integration change.
## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `developer-hook-trace-logging` 中找不到 delta 要修改的 `SDK developer hook trace logging is caller-owned` Requirement。
- **解除条件：**先建立 delta、stable target、Function 与长期设计的原子映射，并确认 Requirement 正文、元数据、Scenario 与迁移两端均完整同步。
