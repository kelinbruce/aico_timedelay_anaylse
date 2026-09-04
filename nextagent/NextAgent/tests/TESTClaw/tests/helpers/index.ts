export {
  PACKAGE_ROOT,
  BIN_DIR,
  CONFIG_DIR,
  DATA_DIR,
  LOGS_DIR,
  RUN_DIR,
  WORKSPACES_DIR,
  BACKEND_DIR,
  MANIFEST_PATH,
  PACKAGE_JSON_PATH,
  SYSTEM_CONFIG_PATH,
  AGENT_CONFIG_PATH,
  START_SCRIPT,
  STOP_SCRIPT,
  SELFCHECK_SCRIPT,
  LAYOUT_CHECK_PATH,
  CONFIG_VALIDATION_PATH,
  STARTUP_PROOF_PATH,
  HEALTH_READINESS_PATH,
  PID_FILE_PATH,
  REQUIRED_DIRS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  BASE_URL,
} from './package-root.js';
export { isRunning, stopNextAgent, startNextAgent, waitForReady } from './process-manager.js';
export {
  readSystemConfig,
  writeSystemConfig,
  readAgentConfig,
  writeAgentConfig,
  backupConfig,
  restoreConfig,
  backupAllConfigs,
  restoreAllConfigs,
  cleanupBackups,
  deepMergeConfig,
} from './config-manager.js';
export {
  readManifest,
  readLayoutCheck,
  readConfigValidation,
  readStartupProof,
  readHealthReadiness,
  readPidFile,
  validateEvidenceChain,
  isLayoutCheckPassed,
  isStartupProofOk,
  isHealthReadinessPassed,
} from './evidence-reader.js';
export { httpRequest, httpGet, httpPost, isServerHealthy, waitForServer } from './http-client.js';
export { runSelfCheck, getPackageVersion, readRootPackageJson, measureTime, retryUntil } from './test-utils.js';
export { createSecretCanary, createSensitiveCanary, expectNoCanaryLeak, type CanaryToken } from './canary.js';
