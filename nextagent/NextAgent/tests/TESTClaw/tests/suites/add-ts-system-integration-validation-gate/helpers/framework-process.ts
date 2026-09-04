import { spawn, type ChildProcess } from 'node:child_process';

const MAX_CAPTURE_BYTES = 1_048_576;
const TERMINATION_GRACE_MS = 2_000;

export interface FrameworkProcessResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly outputOverflow: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runFrameworkProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly registerChild: (child: ChildProcess) => void;
}): Promise<FrameworkProcessResult> {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  input.registerChild(child);

  const stdout = createBoundedCapture();
  const stderr = createBoundedCapture();
  child.stdout?.on('data', stdout.append);
  child.stderr?.on('data', stderr.append);

  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  const outcome = await waitForExit(exitPromise, input.timeoutMs);
  if (outcome.timedOut) {
    await terminateProcess(child, exitPromise);
  }

  return Object.freeze({
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    outputOverflow: stdout.overflowed() || stderr.overflowed(),
    stdout: stdout.value(),
    stderr: stderr.value(),
  });
}

function createBoundedCapture(): {
  readonly append: (chunk: Buffer | string) => void;
  readonly overflowed: () => boolean;
  readonly value: () => string;
} {
  const chunks: Buffer[] = [];
  let capturedBytes = 0;
  let overflowed = false;
  return {
    append(chunk: Buffer | string): void {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remainingBytes = MAX_CAPTURE_BYTES - capturedBytes;
      if (buffer.length > remainingBytes) {
        overflowed = true;
      }
      if (remainingBytes > 0) {
        const captured = buffer.subarray(0, remainingBytes);
        chunks.push(captured);
        capturedBytes += captured.length;
      }
    },
    overflowed: () => overflowed,
    value: () => Buffer.concat(chunks).toString('utf8'),
  };
}

async function waitForExit(
  exitPromise: Promise<number | null>,
  timeoutMs: number,
): Promise<{ readonly exitCode: number | null; readonly timedOut: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      exitPromise.then((exitCode) => ({ exitCode, timedOut: false })),
      new Promise<{ readonly exitCode: null; readonly timedOut: true }>((resolve) => {
        timer = setTimeout(() => resolve({ exitCode: null, timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function terminateProcess(child: ChildProcess, exitPromise: Promise<number | null>): Promise<void> {
  child.kill();
  if (await settlesWithin(exitPromise, TERMINATION_GRACE_MS)) {
    return;
  }
  child.kill('SIGKILL');
  await settlesWithin(exitPromise, TERMINATION_GRACE_MS);
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
