import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { getLogger } from '@nextagent/agent-common';
import type { DefaultSystemConfig } from '../config/component-config.js';

/**
 * Reads the watermark enabled flag from the active agent package's
 * config/config.json. Returns false when the file is missing, the
 * field is absent, or the value is not a boolean. Never throws.
 */
export function readWatermarkEnabled(systemConfig: DefaultSystemConfig): boolean {
  const agentsRoot = systemConfig.paths.agentsRoot;
  const agentId = systemConfig.activeAgentId;
  if (agentId.trim().length === 0) {
    return false;
  }
  const agentPackageRoot = resolve(agentsRoot, agentId);
  if (agentPackageRoot !== agentsRoot && !isPathInside(agentsRoot, agentPackageRoot)) {
    return false;
  }
  try {
    if (!statSync(agentPackageRoot).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    const raw = readFileSync(join(agentPackageRoot, 'config', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }
    const enabled = (parsed as Record<string, unknown>).watermarkEnabled;
    return typeof enabled === 'boolean' && enabled;
  } catch {
    return false;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path);
}

/**
 * Port for lazily reading the watermark enabled flag at request time.
 * Uses a statSync fingerprint (size + mtimeMs) to cache the result and
 * only re-reads when the config file changes. Returns false when the
 * file is missing, never throws.
 */
export interface WatermarkConfigProvider {
  get: () => boolean;
}

const logger = getLogger({ component: 'agent-app', source: 'watermark-composition' });

export function createWatermarkConfigProvider(systemConfig: DefaultSystemConfig): WatermarkConfigProvider {
  return new DefaultWatermarkConfigProvider(systemConfig);
}

class DefaultWatermarkConfigProvider implements WatermarkConfigProvider {
  private cachedFingerprint?: string | undefined;
  private cachedValue = false;

  constructor(private readonly systemConfig: DefaultSystemConfig) {}

  get(): boolean {
    const configPath = resolveWatermarkConfigPath(this.systemConfig);
    if (configPath === undefined) {
      this.cachedFingerprint = undefined;
      this.cachedValue = false;
      return false;
    }
    const fingerprint = computeFingerprint(configPath);
    if (fingerprint === undefined) {
      this.cachedFingerprint = undefined;
      this.cachedValue = false;
      return false;
    }
    if (fingerprint === this.cachedFingerprint) {
      return this.cachedValue;
    }
    const value = readWatermarkEnabled(this.systemConfig);
    this.cachedFingerprint = fingerprint;
    this.cachedValue = value;
    logger.info({ event: 'watermark.enabled.evaluated', enabled: value });
    return value;
  }
}

function resolveWatermarkConfigPath(systemConfig: DefaultSystemConfig): string | undefined {
  const agentsRoot = systemConfig.paths.agentsRoot;
  const agentId = systemConfig.activeAgentId;
  if (agentId.trim().length === 0) {
    return undefined;
  }
  const agentPackageRoot = resolve(agentsRoot, agentId);
  if (agentPackageRoot !== agentsRoot && !isPathInside(agentsRoot, agentPackageRoot)) {
    return undefined;
  }
  return join(agentPackageRoot, 'config', 'config.json');
}

function computeFingerprint(configPath: string): string | undefined {
  try {
    const stat = statSync(configPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return undefined;
  }
}
