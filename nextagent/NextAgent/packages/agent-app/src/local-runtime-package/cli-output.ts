import { isIP } from 'node:net';

const selfCheckEvidenceRefByCode = {
  'missing-directory': 'run/layout-check.json',
  'missing-package-ref': 'run/layout-check.json',
  'invalid-config-sample': 'run/config-validation-evidence.json',
  MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE: 'run/config-validation-evidence.json',
  'self-check-failed': 'run/layout-check.json',
} as const;
const maxSelfCheckDiagnostics = 16;
const hostnamePattern = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/u;

type SelfCheckDiagnosticCode = keyof typeof selfCheckEvidenceRefByCode;

export function writeLocalRuntimeReadyNotice(input: { readonly host?: string | undefined; readonly port?: number | undefined }): void {
  const host = safeDisplayHost(input.host);
  const port = input.port;
  if (host === undefined || port === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return;
  }
  writeCli(process.stdout, `\nNextAgent is running. Login page: http://${host}:${port}\n\n`);
}

export function writeLocalRuntimeSelfCheckFailure(diagnostics: ReadonlyArray<{ readonly code: string }>): void {
  const safeDiagnostics = diagnostics.slice(0, maxSelfCheckDiagnostics).map((diagnostic) => {
    const code = isSelfCheckDiagnosticCode(diagnostic.code) ? diagnostic.code : 'self-check-failed';
    return { code, evidenceRef: selfCheckEvidenceRefByCode[code] };
  });
  writeCli(process.stderr, `${JSON.stringify({ status: 'failed', diagnostics: safeDiagnostics })}\n`);
}

function safeDisplayHost(host?: string): string | undefined {
  if (host === undefined) {
    return undefined;
  }
  if (host === '0.0.0.0' || host === '::') {
    return 'localhost';
  }
  const ipVersion = isIP(host);
  if (ipVersion === 6) {
    return `[${host}]`;
  }
  return ipVersion === 4 || hostnamePattern.test(host) ? host : undefined;
}

function isSelfCheckDiagnosticCode(code: string): code is SelfCheckDiagnosticCode {
  return Object.hasOwn(selfCheckEvidenceRefByCode, code);
}

function writeCli(stream: NodeJS.WriteStream, text: string): void {
  try {
    stream.write(text);
  } catch {
    // CLI presentation failure must not change runtime or self-check behavior.
  }
}
