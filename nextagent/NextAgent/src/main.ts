import { getLogger } from '@nextagent/agent-common';
import { classifyAppStartupFailure, createNextAgentAppAsync } from '@nextagent/agent-app';
import { createProcessFatalBoundary } from './process-fatal.js';

export const app = await createNextAgentAppAsync().catch(() => {
  try {
    process.stderr.write('{"event":"app.start.failed","failureStage":"APP_STARTUP"}\n');
  } catch {
    // stderr can already be detached; startup must still terminate deterministically.
  }
  process.exit(1);
});

if (process.env['NEXTAGENT_START'] === '1') {
  const logger = getLogger({ component: 'nextagent-deployment', source: 'process-boundary' });
  const fatal = createProcessFatalBoundary({
    logger,
    flush: async () => app.close(),
    exit: (code) => process.exit(code),
  });
  process.once('uncaughtException', fatal.uncaughtException);
  process.once('unhandledRejection', fatal.unhandledRejection);
  try {
    await app.start();
  } catch (error) {
    logger.error({
      err: error,
      event: 'app.start.failed',
      failureStage: classifyAppStartupFailure(error),
    });
    await app.close();
    process.exitCode = 1;
  }
}
