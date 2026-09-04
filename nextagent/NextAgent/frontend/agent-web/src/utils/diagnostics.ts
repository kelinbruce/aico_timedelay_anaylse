export function reportWarning(message: string, ...details: unknown[]): void {
  console.warn(message, ...details);
}

export function reportError(message: string, ...details: unknown[]): void {
  console.error(message, ...details);
}

export function reportDebug(message: string, ...details: unknown[]): void {
  console.debug(message, ...details);
}
