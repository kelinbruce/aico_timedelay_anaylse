import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the package root from environment or default
export const PACKAGE_ROOT = process.env.NEXTAGENT_PACKAGE_ROOT ?? resolve(__dirname, '../../target');

// Key directory paths
export const BIN_DIR = resolve(PACKAGE_ROOT, 'bin');
export const CONFIG_DIR = resolve(PACKAGE_ROOT, 'config');
export const DATA_DIR = resolve(PACKAGE_ROOT, 'data');
export const LOGS_DIR = resolve(PACKAGE_ROOT, 'logs');
export const RUN_DIR = resolve(PACKAGE_ROOT, 'run');
export const WORKSPACES_DIR = resolve(PACKAGE_ROOT, 'workspaces');
export const BACKEND_DIR = resolve(PACKAGE_ROOT, 'backend');

// Key file paths
export const MANIFEST_PATH = resolve(PACKAGE_ROOT, 'candidate-manifest.json');
export const PACKAGE_JSON_PATH = resolve(PACKAGE_ROOT, 'package.json');
export const SYSTEM_CONFIG_PATH = resolve(CONFIG_DIR, 'default-system.json');
export const AGENT_CONFIG_PATH = resolve(CONFIG_DIR, 'default-agent.yaml');

// Entrypoint paths
export const START_SCRIPT = resolve(BIN_DIR, 'nextagent-start');
export const STOP_SCRIPT = resolve(BIN_DIR, 'nextagent-stop');
export const SELFCHECK_SCRIPT = resolve(BIN_DIR, 'nextagent-self-check');

// Evidence file paths
export const LAYOUT_CHECK_PATH = resolve(RUN_DIR, 'layout-check.json');
export const CONFIG_VALIDATION_PATH = resolve(RUN_DIR, 'config-validation-evidence.json');
export const STARTUP_PROOF_PATH = resolve(RUN_DIR, 'startup-proof.json');
export const HEALTH_READINESS_PATH = resolve(RUN_DIR, 'health-readiness-proof.json');
export const PID_FILE_PATH = resolve(RUN_DIR, 'nextagent.pid');

// Required directories per the package layout
export const REQUIRED_DIRS = ['bin', 'config', 'backend', 'data', 'logs', 'run', 'workspaces'] as const;

// Default server configuration
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;
export const BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
