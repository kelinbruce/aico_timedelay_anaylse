import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import { createExternalConsumerRoot } from './external-consumer-root.js';

export interface ExternalConsumerProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runExternalConsumerScript(input: {
  readonly externalPackagesRoot: string;
  readonly tempBase: string;
  readonly source: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly registerChild: (child: ChildProcess) => void;
}): Promise<ExternalConsumerProcessResult> {
  const consumer = await createExternalConsumerRoot({
    externalPackagesRoot: input.externalPackagesRoot,
    tempBase: input.tempBase,
  });
  try {
    const entry = path.join(consumer.root, 'consumer.mjs');
    await writeFile(entry, input.source, 'utf8');
    const child = spawn(process.execPath, [entry], {
      cwd: consumer.root,
      env: {
        NODE_NO_WARNINGS: '1',
        ...input.environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    input.registerChild(child);
    return await collectProcessResult(child);
  } finally {
    await consumer.cleanup();
  }
}

async function collectProcessResult(child: ChildProcessByStdio<null, Readable, Readable>): Promise<ExternalConsumerProcessResult> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  return {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}
