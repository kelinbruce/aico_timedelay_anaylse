import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWatermarkEnabled, createWatermarkConfigProvider } from '../src/composition/watermark-composition.js';
import type { DefaultSystemConfig } from '../src/config/component-config.js';

function makeConfig(agentsRoot: string, activeAgentId: string): DefaultSystemConfig {
  return {
    paths: { agentsRoot, sqliteFile: ':memory:', uploadTempDir: join(agentsRoot, 'tmp'), downloadTempDir: join(agentsRoot, 'dl') },
    activeAgentId,
    deployment: { mode: 'REMOTE' },
  } as unknown as DefaultSystemConfig;
}

describe('readWatermarkEnabled', () => {
  let tempDir: string;

  it('returns true when config.json has watermarkEnabled: true', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), JSON.stringify({ watermarkEnabled: true }), 'utf-8');
    expect(readWatermarkEnabled(makeConfig(tempDir, 'agent-1'))).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when config.json has watermarkEnabled: false', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), JSON.stringify({ watermarkEnabled: false }), 'utf-8');
    expect(readWatermarkEnabled(makeConfig(tempDir, 'agent-1'))).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when config.json does not have watermarkEnabled field', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), JSON.stringify({ otherField: 'value' }), 'utf-8');
    expect(readWatermarkEnabled(makeConfig(tempDir, 'agent-1'))).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when config.json does not exist', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(agentDir, { recursive: true });
    expect(readWatermarkEnabled(makeConfig(tempDir, 'agent-1'))).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when agent package directory does not exist', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    expect(readWatermarkEnabled(makeConfig(tempDir, 'nonexistent-agent'))).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false when watermarkEnabled is non-boolean (string 'true')", () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), JSON.stringify({ watermarkEnabled: 'true' }), 'utf-8');
    expect(readWatermarkEnabled(makeConfig(tempDir, 'agent-1'))).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when config.json is invalid JSON', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-test-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), '{ invalid json }', 'utf-8');
    expect(readWatermarkEnabled(makeConfig(tempDir, 'agent-1'))).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('WatermarkConfigProvider', () => {
  let tempDir: string;

  it('returns false when config file does not exist, then true after file is created', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-prov-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(agentDir, { recursive: true });
    const provider = createWatermarkConfigProvider(makeConfig(tempDir, 'agent-1'));
    expect(provider.get()).toBe(false);
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), JSON.stringify({ watermarkEnabled: true }), 'utf-8');
    expect(provider.get()).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns cached value when file fingerprint is unchanged', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-prov-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    writeFileSync(join(agentDir, 'config', 'config.json'), JSON.stringify({ watermarkEnabled: true }), 'utf-8');
    const provider = createWatermarkConfigProvider(makeConfig(tempDir, 'agent-1'));
    expect(provider.get()).toBe(true);
    expect(provider.get()).toBe(true);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reloads value when config file changes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-prov-'));
    const agentDir = join(tempDir, 'agent-1');
    mkdirSync(join(agentDir, 'config'), { recursive: true });
    const configPath = join(agentDir, 'config', 'config.json');
    writeFileSync(configPath, JSON.stringify({ watermarkEnabled: true }), 'utf-8');
    const provider = createWatermarkConfigProvider(makeConfig(tempDir, 'agent-1'));
    expect(provider.get()).toBe(true);
    writeFileSync(configPath, JSON.stringify({ watermarkEnabled: false }), 'utf-8');
    expect(provider.get()).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when agent id is empty', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'wm-prov-'));
    const provider = createWatermarkConfigProvider(makeConfig(tempDir, ''));
    expect(provider.get()).toBe(false);
    rmSync(tempDir, { recursive: true, force: true });
  });
});
