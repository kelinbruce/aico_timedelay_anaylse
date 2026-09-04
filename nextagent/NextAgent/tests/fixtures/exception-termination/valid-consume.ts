async function validBoundary(logger: { error(fields: object): void }): Promise<void> {
  try {
    await Promise.reject(new Error('failure'));
  } catch (error) {
    logger.error({ err: error, event: 'execution.terminated' });
  }
}

void validBoundary;
