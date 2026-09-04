const allPackages = [
  'agent-common',
  'agent-local-file-roll',
  'agent-log',
  'agent-contracts',
  'agent-runtime',
  'agent-session',
  'agent-attachment-runtime',
  'agent-context-engine',
  'agent-memory',
  'agent-core',
  'agent-model',
  'agent-channel-common',
  'agent-channel-web',
  'agent-dev-workbench',
  'agent-channel-task',
  'agent-channel-web-auth-local',
  'agent-app-frontend-hosting',
  'agent-platform-gateway-local',
  'agent-platform-gateway-remote',
  'agent-remote-deployment',
  'agent-capability',
  'agent-observability',
  'agent-workflow',
  'agent-app',
  'agent-plugin-sdk',
  'agent-test-kit',
];

const implementationPackages = [
  'agent-log',
  'agent-runtime',
  'agent-session',
  'agent-attachment-runtime',
  'agent-context-engine',
  'agent-memory',
  'agent-core',
  'agent-model',
  'agent-channel-common',
  'agent-channel-web',
  'agent-dev-workbench',
  'agent-channel-task',
  'agent-channel-web-auth-local',
  'agent-app-frontend-hosting',
  'agent-platform-gateway-local',
  'agent-platform-gateway-remote',
  'agent-capability',
  'agent-observability',
  'agent-workflow',
  'agent-app',
];

const nonAppImplementationPackages = implementationPackages.filter((packageName) => packageName !== 'agent-app');

const contractSubpathAllowlist = {
  'agent-runtime': ['agent-assembly', 'runtime', 'session', 'gateway', 'observability', 'capability', 'context'],
  'agent-session': ['agent-assembly', 'capability', 'context', 'gateway', 'model', 'runtime', 'session'],
  'agent-attachment-runtime': ['attachment', 'gateway'],
  'agent-context-engine': ['agent-assembly', 'context', 'capability', 'model', 'gateway', 'session', 'runtime', 'system-reminder'],
  'agent-memory': ['capability', 'channel', 'context', 'gateway', 'model'],
  'agent-core': ['agent-assembly', 'runtime', 'context', 'model', 'capability', 'observability', 'session', 'core'],
  'agent-model': ['agent-assembly', 'model', 'runtime', 'observability'],
  'agent-channel-common': ['channel', 'runtime'],
  'agent-channel-web': ['channel', 'runtime', 'observability'],
  'agent-dev-workbench': ['gateway'],
  'agent-channel-task': ['channel', 'runtime', 'observability'],
  'agent-channel-web-auth-local': [],
  'agent-app-frontend-hosting': [],
  'agent-platform-gateway-local': ['gateway', 'capability'],
  'agent-platform-gateway-remote': ['gateway', 'model', 'capability', 'observability'],
  'agent-capability': ['agent-assembly', 'capability', 'gateway', 'model', 'observability'],
  'agent-observability': ['context', 'gateway', 'observability'],
  'agent-workflow': ['agent-assembly', 'core', 'capability', 'context', 'model', 'gateway', 'observability'],
};

const agentAppCompositionContractSubpaths = [
  'agent-assembly',
  'app',
  'capability',
  'channel',
  'context',
  'gateway',
  'core',
  'model',
  'observability',
  'runtime',
];

const businessPackages = [
  'agent-common',
  'agent-contracts',
  'agent-runtime',
  'agent-session',
  'agent-attachment-runtime',
  'agent-context-engine',
  'agent-memory',
  'agent-core',
  'agent-model',
  'agent-capability',
  'agent-workflow',
];

const workspacePackage = (packages) => `^packages/(${packages.join('|')})/src`;
const npmDependencyTypes = ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-unknown', 'npm-no-pkg', 'unknown'];

const implementationFirewallSourcePath = (packageName) =>
  packageName === 'agent-memory'
    ? '^packages/agent-memory/src(?!/memory-tools\\.ts$)'
    : packageName === 'agent-platform-gateway-local'
      ? `^packages/${packageName}/src(?!(?:/entrypoints/|/testing\\.ts$))`
      : `^packages/${packageName}/src`;

const implementationAllowedDependencies = {
  'agent-log': ['agent-local-file-roll'],
  'agent-observability': ['agent-local-file-roll'],
  'agent-platform-gateway-local': ['agent-local-file-roll'],
  'agent-channel-web': ['agent-channel-common'],
  'agent-channel-task': ['agent-channel-common'],
};

const implementationDependencyFirewallRules = nonAppImplementationPackages.map((packageName) => {
  const allowed = implementationAllowedDependencies[packageName] ?? [];
  return {
    name: `no-${packageName}-to-implementation-packages`,
    severity: 'error',
    from: { path: implementationFirewallSourcePath(packageName) },
    to: { path: workspacePackage(implementationPackages.filter((candidate) => candidate !== packageName && !allowed.includes(candidate))) },
  };
});

const unauthorizedContractSubpathPattern = (allowedSubpaths) => {
  if (allowedSubpaths.length === 0) {
    return '^packages/agent-contracts/src/[^/]+/';
  }
  return `^packages/agent-contracts/src/(?!(${allowedSubpaths.join('|')})(/|$))[^/]+/`;
};

const contractSubpathAllowlistRules = Object.entries(contractSubpathAllowlist).map(([packageName, allowedSubpaths]) => ({
  name: `no-${packageName}-unauthorized-contract-subpaths`,
  severity: 'error',
  from: { path: `^packages/${packageName}/src` },
  to: { path: unauthorizedContractSubpathPattern(allowedSubpaths) },
}));

const config = {
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '^(dist|packages/[^/]+/dist|tests/fixtures)',
    },
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
  },
  forbidden: [
    ...implementationDependencyFirewallRules,
    ...contractSubpathAllowlistRules,
    {
      name: 'no-unauthorized-local-file-roll-consumers',
      severity: 'error',
      from: { path: '^packages/(?!agent-log/|agent-observability/|agent-platform-gateway-local/|agent-local-file-roll/)[^/]+/src' },
      to: { path: '^packages/agent-local-file-roll/src' },
    },
    {
      name: 'no-local-file-roll-reverse-dependencies',
      severity: 'error',
      from: { path: '^packages/agent-local-file-roll/src' },
      to: { path: '^packages/(?!agent-local-file-roll/)[^/]+/src' },
    },
    {
      // The RobotRouter guardrail provider is the sole governed egress to the
      // external guard service. Other packages MUST NOT deep-import its
      // internals; they consume it via the platform-gateway-remote public
      // export (and only composition wires it as a gateway provider).
      name: 'no-direct-robotrouter-guardrail-import',
      severity: 'error',
      from: { path: '^packages/(?!agent-platform-gateway-remote/)[^/]+/src' },
      to: { path: '^packages/agent-platform-gateway-remote/src/guardrail/' },
    },
    {
      name: 'no-rolling-lifecycle-outside-foundation',
      severity: 'error',
      from: { path: '^packages/(?!agent-local-file-roll/)[^/]+/src' },
      to: {
        dependencyTypes: npmDependencyTypes,
        path: '(^|/)(node_modules/)?(pino-roll|sonic-boom)(/|$)',
      },
    },
    {
      name: 'no-agent-app-config-to-composition',
      severity: 'error',
      from: { path: '^packages/agent-app/src/config' },
      to: { path: '^packages/agent-app/src/composition' },
    },
    {
      name: 'no-agent-app-composition-modules-to-create-app',
      severity: 'error',
      // create-test-composition is a classified test host, not a module entry; it must call the unique product runner.
      from: {
        path: '^packages/agent-app/src/composition/(?!create-app\\.ts$|create-test-composition\\.ts$|composition-contracts\\.ts$)[^/]*-composition\\.ts$',
      },
      to: { path: '^packages/agent-app/src/composition/create-app\\.ts$' },
    },
    {
      name: 'no-agent-app-composition-sibling-value-imports',
      severity: 'error',
      from: { path: '^packages/agent-app/src/composition/[^/]*-composition\\.ts$' },
      to: {
        path: '^packages/agent-app/src/composition/[^/]*-composition\\.ts$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-agent-app-unauthorized-contract-subpaths',
      severity: 'error',
      from: { path: '^packages/agent-app/src' },
      to: { path: unauthorizedContractSubpathPattern(agentAppCompositionContractSubpaths) },
    },
    {
      name: 'no-product-contract-root-aggregate-imports',
      severity: 'error',
      from: { path: '^packages/(?!agent-contracts/)[^/]+/src' },
      to: { path: '^packages/agent-contracts/src/index\\.ts$' },
    },
    {
      name: 'no-agent-assembly-to-runtime-or-wide-contracts',
      severity: 'error',
      from: { path: '^packages/agent-contracts/src/agent-assembly' },
      to: { path: '^packages/agent-contracts/src/(runtime|app|gateway|channel|model|capability|context|session|observability|core|attachment)(/|$)' },
    },
    {
      name: 'no-cross-package-private-imports',
      severity: 'error',
      from: { path: '^packages/([^/]+)/src' },
      to: {
        path: '^packages/(?!$1/)[^/]+/src',
        dependencyTypesNot: ['aliased', 'aliased-tsconfig', 'aliased-tsconfig-paths'],
      },
    },
    {
      name: 'no-contract-to-implementation',
      severity: 'error',
      from: { path: '^packages/agent-contracts/src' },
      to: { path: workspacePackage(implementationPackages) },
    },
    {
      name: 'no-common-to-contracts',
      severity: 'error',
      from: { path: '^packages/agent-common/src' },
      to: { path: '^packages/agent-contracts/src' },
    },
    {
      name: 'no-runtime-to-adapter-or-app',
      severity: 'error',
      from: { path: '^packages/agent-runtime/src' },
      to: { path: workspacePackage(['agent-channel-web', 'agent-platform-gateway-local', 'agent-platform-gateway-remote', 'agent-app']) },
    },
    {
      name: 'no-channel-to-lifecycle-owners',
      severity: 'error',
      from: { path: '^packages/agent-channel-web/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-model',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-channel-web-to-local-auth',
      severity: 'error',
      from: { path: '^packages/agent-channel-web/src' },
      to: { path: '^packages/agent-channel-web-auth-local/src' },
    },
    {
      name: 'no-channel-web-to-gateway-records',
      severity: 'error',
      from: { path: '^packages/agent-channel-web/src' },
      to: { path: '^packages/agent-contracts/src/gateway' },
    },
    {
      name: 'no-channel-web-to-gateway-adapter',
      severity: 'error',
      from: { path: '^packages/agent-channel-web/src' },
      to: { path: workspacePackage(['agent-platform-gateway-local', 'agent-platform-gateway-remote']) },
    },
    {
      name: 'no-channel-task-to-lifecycle-owners',
      severity: 'error',
      from: { path: '^packages/agent-channel-task/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-model',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-channel-task-to-local-auth',
      severity: 'error',
      from: { path: '^packages/agent-channel-task/src' },
      to: { path: '^packages/agent-channel-web-auth-local/src' },
    },
    {
      name: 'no-channel-task-to-gateway-records',
      severity: 'error',
      from: { path: '^packages/agent-channel-task/src' },
      to: { path: '^packages/agent-contracts/src/gateway' },
    },
    {
      name: 'no-channel-task-to-gateway-adapter',
      severity: 'error',
      from: { path: '^packages/agent-channel-task/src' },
      to: { path: workspacePackage(['agent-platform-gateway-local', 'agent-platform-gateway-remote']) },
    },
    {
      name: 'no-channel-task-to-frontend-hosting',
      severity: 'error',
      from: { path: '^packages/agent-channel-task/src' },
      to: { path: '^packages/agent-app-frontend-hosting/src' },
    },
    {
      name: 'no-local-auth-to-runtime-state',
      severity: 'error',
      from: { path: '^packages/agent-channel-web-auth-local/src' },
      to: {
        path: workspacePackage([
          'agent-channel-web',
          'agent-runtime',
          'agent-session',
          'agent-attachment-runtime',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-model',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-local-auth-to-contracts',
      severity: 'error',
      from: { path: '^packages/agent-channel-web-auth-local/src' },
      to: { path: '^packages/agent-contracts/src' },
    },
    {
      name: 'no-core-to-adapter-or-app',
      severity: 'error',
      from: { path: '^packages/agent-core/src' },
      to: { path: workspacePackage(['agent-channel-web', 'agent-platform-gateway-local', 'agent-platform-gateway-remote', 'agent-app']) },
    },
    {
      name: 'no-context-engine-to-runtime-or-adapter',
      severity: 'error',
      from: { path: '^packages/agent-context-engine/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-attachment-runtime',
          'agent-core',
          'agent-model',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-memory-to-runtime-context-or-adapter',
      severity: 'error',
      from: { path: '^packages/agent-memory/src(?!/memory-tools\\.ts$)' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-attachment-runtime',
          'agent-context-engine',
          'agent-core',
          'agent-model',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-agent-memory-tools-to-non-capability-implementations',
      severity: 'error',
      from: { path: '^packages/agent-memory/src/memory-tools\\.ts$' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-attachment-runtime',
          'agent-context-engine',
          'agent-core',
          'agent-model',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-attachment-runtime-to-lifecycle-or-adapter',
      severity: 'error',
      from: { path: '^packages/agent-attachment-runtime/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-model',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-session-to-runtime-or-adapter',
      severity: 'error',
      from: { path: '^packages/agent-session/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-attachment-runtime',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-model',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-model-to-core-runtime-or-adapter',
      severity: 'error',
      from: { path: '^packages/agent-model/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-attachment-runtime',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-capability',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-capability-to-runtime-core-or-adapter',
      severity: 'error',
      from: { path: '^packages/agent-capability/src' },
      to: {
        path: workspacePackage([
          'agent-runtime',
          'agent-session',
          'agent-attachment-runtime',
          'agent-context-engine',
          'agent-memory',
          'agent-core',
          'agent-model',
          'agent-channel-web',
          'agent-platform-gateway-local',
          'agent-platform-gateway-remote',
          'agent-app',
        ]),
      },
    },
    {
      name: 'no-gateway-adapter-to-channel-runtime-or-app',
      severity: 'error',
      from: { path: '^packages/(agent-platform-gateway-local/src(?!(?:/entrypoints/|/testing\\.ts$))|agent-platform-gateway-remote/src)' },
      to: { path: workspacePackage(['agent-channel-web', 'agent-runtime', 'agent-core', 'agent-app']) },
    },
    {
      name: 'no-app-imported-by-packages',
      severity: 'error',
      from: {
        path:
          '^(?!packages/(?:agent-platform-gateway-local/src/(?:entrypoints/|testing\\.ts$)|agent-remote-deployment/src))packages/(' +
          allPackages.filter((packageName) => packageName !== 'agent-app').join('|') +
          ')/src',
      },
      to: { path: '^packages/agent-app/src' },
    },
    {
      name: 'no-framework-leakage-into-business-packages',
      severity: 'error',
      from: { path: workspacePackage(businessPackages) },
      to: {
        dependencyTypes: npmDependencyTypes,
        path: '(^|/)(node_modules/)?(fastify|pino|kysely|@opentelemetry|better-sqlite3)(/|$)',
      },
    },
    {
      name: 'no-provider-sdk-leakage',
      severity: 'error',
      from: { path: workspacePackage(allPackages.filter((packageName) => packageName !== 'agent-model')) },
      to: {
        dependencyTypes: npmDependencyTypes,
        path: '(^|/)(node_modules/)?(openai|@anthropic-ai|langchain|ai)(/|$)',
      },
    },
    {
      name: 'no-sandbox-runtime-bypass',
      severity: 'error',
      from: { path: workspacePackage(['agent-core', 'agent-capability', 'agent-runtime', 'agent-context-engine']) },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(child_process|worker_threads|vm)$',
      },
    },
    {
      name: 'no-observability-sdk-leakage',
      severity: 'error',
      from: {
        path: workspacePackage(
          allPackages.filter((packageName) => packageName !== 'agent-observability' && packageName !== 'agent-remote-deployment'),
        ),
      },
      to: {
        dependencyTypes: npmDependencyTypes,
        path: 'node_modules/@opentelemetry(/|$)',
      },
    },
  ],
};

Object.defineProperty(config, 'architecturePolicy', {
  value: {
    implementationPackages,
    contractSubpathAllowlist,
    agentAppCompositionContractSubpaths,
    nonAppImplementationPackages,
    implementationAllowedDependencies,
  },
  enumerable: false,
});

module.exports = config;
