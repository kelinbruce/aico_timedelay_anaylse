async function invalidBoundary(logger: { error(fields: object): void }): Promise<void> {
  try {
    await Promise.reject(new Error('failure'));
  } catch (error) {
    logger.error({ err: error, event: 'helper.failed' });
    throw error;
  }
}

void invalidBoundary;
