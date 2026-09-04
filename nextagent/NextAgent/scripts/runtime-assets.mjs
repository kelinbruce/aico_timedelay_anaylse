import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function copyRuntimeAssets(repoRoot) {
  const skillSource = join(repoRoot, 'packages', 'agent-capability', 'src', 'builtins', 'skills');
  const skillTarget = join(repoRoot, 'packages', 'agent-capability', 'dist', 'builtins', 'skills');
  await rm(skillTarget, { recursive: true, force: true });
  await mkdir(dirname(skillTarget), { recursive: true });
  await cp(skillSource, skillTarget, { recursive: true });

  const ctxEngineRoot = join(repoRoot, 'packages', 'agent-context-engine');
  const promptTemplateSource = join(ctxEngineRoot, 'prompt-templates');
  const promptTemplateTarget = join(ctxEngineRoot, 'dist', 'prompt-templates');
  await rm(promptTemplateTarget, { recursive: true, force: true });
  await mkdir(dirname(promptTemplateTarget), { recursive: true });
  await cp(promptTemplateSource, promptTemplateTarget, { recursive: true });
  await rm(join(ctxEngineRoot, 'dist', 'prompt-configs'), { recursive: true, force: true });

  const coreRoot = join(repoRoot, 'packages', 'agent-core');
  const builtinAgentSource = join(coreRoot, 'src', 'builtin-agents');
  const builtinAgentTarget = join(coreRoot, 'dist', 'builtin-agents');
  await rm(join(repoRoot, 'packages', 'agent-app', 'dist', 'assembly', 'builtin-agents'), { recursive: true, force: true });
  await rm(builtinAgentTarget, { recursive: true, force: true });
  await mkdir(dirname(builtinAgentTarget), { recursive: true });
  await cp(builtinAgentSource, builtinAgentTarget, { recursive: true });
}

export function copyRuntimeAssetsSync(repoRoot) {
  const skillSource = join(repoRoot, 'packages', 'agent-capability', 'src', 'builtins', 'skills');
  const skillTarget = join(repoRoot, 'packages', 'agent-capability', 'dist', 'builtins', 'skills');
  rmSync(skillTarget, { recursive: true, force: true });
  mkdirSync(dirname(skillTarget), { recursive: true });
  cpSync(skillSource, skillTarget, { recursive: true });

  const ctxEngineRoot = join(repoRoot, 'packages', 'agent-context-engine');
  const promptTemplateSource = join(ctxEngineRoot, 'prompt-templates');
  const promptTemplateTarget = join(ctxEngineRoot, 'dist', 'prompt-templates');
  rmSync(promptTemplateTarget, { recursive: true, force: true });
  mkdirSync(dirname(promptTemplateTarget), { recursive: true });
  cpSync(promptTemplateSource, promptTemplateTarget, { recursive: true });
  rmSync(join(ctxEngineRoot, 'dist', 'prompt-configs'), { recursive: true, force: true });

  const coreRoot = join(repoRoot, 'packages', 'agent-core');
  const builtinAgentSource = join(coreRoot, 'src', 'builtin-agents');
  const builtinAgentTarget = join(coreRoot, 'dist', 'builtin-agents');
  rmSync(join(repoRoot, 'packages', 'agent-app', 'dist', 'assembly', 'builtin-agents'), { recursive: true, force: true });
  rmSync(builtinAgentTarget, { recursive: true, force: true });
  mkdirSync(dirname(builtinAgentTarget), { recursive: true });
  cpSync(builtinAgentSource, builtinAgentTarget, { recursive: true });
}
