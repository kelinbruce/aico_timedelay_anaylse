import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

type ImportKind = 'type' | 'value';

interface ModuleImports {
  readonly type: readonly string[];
  readonly value: readonly string[];
}

interface PackageGuard {
  readonly packageRoot: string;
  readonly allowedWorkspaceDependencies: readonly string[];
  readonly imports: Readonly<Record<string, ModuleImports>>;
  readonly indexExports: readonly string[];
  readonly exportedDeclarations: Readonly<Record<string, readonly string[]>>;
}

const packageGuards: readonly PackageGuard[] = [
  {
    packageRoot: 'packages/agent-platform-gateway-remote',
    allowedWorkspaceDependencies: ['@nextagent/agent-common', '@nextagent/agent-contracts'],
    imports: {
      '@nextagent/agent-common': {
        value: ['AgentError', 'CRON_TASK_LIMIT_REACHED_CODE', 'cronTaskLimitReachedError', 'getLogger', 'guardrailServiceUnavailableMessage'],
        type: ['AgentId', 'AgentVersion', 'CapabilityId', 'JsonObject', 'SafeError', 'SecretReference', 'SubjectId', 'TenantId'],
      },
      '@nextagent/agent-contracts/capability': {
        type: ['ApiCallPort', 'ApiCallRequest', 'ApiCallResult', 'ApiCallStreamChunk'],
        value: [],
      },
      '@nextagent/agent-contracts/gateway': {
        value: [
          'listFrequentHistoryQuestionsRequestSchema',
          'listFrequentHistoryQuestionsResultSchema',
          'recommendSimilarPresetQuestionsRequestSchema',
          'recommendSimilarPresetQuestionsResultSchema',
          'workflowRagRetrievalResultSchema',
        ],
        type: [
          'BindCronTriggerRunRequest',
          'BindCronTriggerRunResult',
          'ClaimCronTriggerRequest',
          'ClaimCronTriggerResult',
          'ClaimedCronTriggerDeliveryRecord',
          'CronClaimedTriggerListRequest',
          'CronDueTaskListRequest',
          'CronTaskAgentListRequest',
          'CronTaskAgentLookupRequest',
          'CronTaskAgentScopeQuery',
          'CronTaskGatewayPort',
          'CronTaskListRequest',
          'CronTaskLookupRequest',
          'CronTaskRecord',
          'CronTaskTriggerListRequest',
          'CronTaskWriteOptions',
          'CronTriggerDeliveryLookupRequest',
          'CronTriggerLookupRequest',
          'CronTriggerRecord',
          'GatewayAdapterKind',
          'GatewayBindings',
          'GatewayProvider',
          'GatewayProviderCreateInput',
          'GuardrailCheckAnswerInput',
          'GuardrailCheckAnswerResult',
          'GuardrailCheckKnowledgeInput',
          'GuardrailCheckKnowledgeResult',
          'GuardrailCheckNl2PythonInput',
          'GuardrailCheckNl2PythonResult',
          'GuardrailCheckQuestionInput',
          'GuardrailCheckQuestionResult',
          'GuardrailGatewayPort',
          'FrequentHistoryQuestion',
          'ListFrequentHistoryQuestionsRequest',
          'ListFrequentHistoryQuestionsResult',
          'LongTermMemoryGatewayBindings',
          'PresetQuestionRecommendation',
          'QuestionRecommendationGateway',
          'RagRetrievalGateway',
          'RagRetrievalRequest',
          'RagRetrievalResult',
          'RecommendSimilarPresetQuestionsRequest',
          'RecommendSimilarPresetQuestionsResult',
          'SandboxExecutionRequest',
          'SandboxExecutionResult',
          'SandboxGatewayPort',
          'ScheduledMaintenanceGatewayPort',
          'ScheduledMaintenanceJob',
          'ScheduledMaintenanceJobResult',
          'SqliteGatewayStoreBindings',
          'WatermarkGatewayPort',
          'WatermarkEmbedInput',
          'WatermarkEmbedResult',
          'WorkflowRagRetrievalGateway',
          'WorkflowRagRetrievalRequest',
          'WorkflowRagRetrievalResult',
          'WorkingMemoryGatewayBindings',
        ],
      },
      '@nextagent/agent-contracts/model': {
        value: ['ModelFinalResultSchema', 'ModelStreamDeltaSchema'],
        type: [
          'ModelFinalResult',
          'ModelGatewayModelInformationService',
          'ModelGatewayProvider',
          'ModelInvocationRequest',
          'ModelInvocationService',
          'ModelStreamDelta',
        ],
      },
      '@nextagent/agent-contracts/observability': {
        value: [],
        type: ['ExecutionCorrelationPort'],
      },
    },
    indexExports: [
      './api-call/remote-api-call-port.js',
      './audit-sink.js',
      './bindings/remote-gateway-bindings.js',
      './cron/reference-remote-cron-task-gateway.js',
      './guardrail/robotrouter-guardrail-gateway.js',
      './watermark/watermark-gateway.js',
      './model/reference-remote-model-gateway.js',
      './providers/remote-gateway-provider.js',
      './question-recommendation/http-question-recommendation-client.js',
      './question-recommendation/reference-remote-question-recommendation-gateway.js',
      './rag/reference-remote-rag-retrieval.js',
      './rag/reference-remote-workflow-rag-retrieval.js',
      './sandbox/reference-remote-sandbox.js',
      './scheduled/reference-remote-scheduled-maintenance.js',
      './skillhub-http-v1-gateway.js',
      './workflow-remote-execution-gateway.js',
    ],
    exportedDeclarations: {
      'src/api-call/remote-api-call-port.ts': ['createRemoteApiCallPort'],
      'src/audit-sink.ts': [
        'RemoteAuditSinkAdapter',
        'RemoteAuditSinkWriteOutcome',
        'RemoteAuditSinkWriteResult',
        'createUnsupportedRemoteAuditSinkAdapter',
      ],
      'src/bindings/remote-gateway-bindings.ts': [
        'RemoteGatewayReferenceBindings',
        'RemoteGatewayReferenceBindingsFactory',
        'blockedRemoteGatewayBindings',
        'createSelectedRemoteGatewayBindings',
        'remoteGatewayReferenceAdapterKinds',
        'resolveRemoteGatewayReferenceBindings',
        'selectedRemoteGatewayMissingBinding',
      ],
      'src/cron/reference-remote-cron-task-gateway.ts': ['ReferenceRemoteCronTaskClient', 'createReferenceRemoteCronTaskGateway'],
      'src/guardrail/robotrouter-guardrail-gateway.ts': [
        'RobotRouterFetch',
        'RobotRouterFetchResponse',
        'RobotRouterGuardrailProviderOptions',
        'createRobotRouterGuardrailProvider',
      ],
      'src/watermark/watermark-gateway.ts': ['WatermarkFetch', 'WatermarkFetchResponse', 'WatermarkProviderOptions', 'createWatermarkProvider'],
      'src/index.ts': [],
      'src/model/reference-remote-model-gateway.ts': [
        'ReferenceRemoteModelGatewayClient',
        'ReferenceRemoteModelGatewayProviderOptions',
        'createReferenceRemoteModelGatewayProvider',
        'createReferenceRemoteModelGatewayService',
      ],
      'src/providers/remote-gateway-provider.ts': ['RemoteGatewayProviderOptions', 'createRemoteGatewayProvider'],
      'src/question-recommendation/http-question-recommendation-client.ts': [
        'HttpQuestionRecommendationClientOptions',
        'createHttpQuestionRecommendationClient',
      ],
      'src/question-recommendation/reference-remote-question-recommendation-gateway.ts': [
        'ReferenceRemoteQuestionRecommendationClient',
        'createReferenceRemoteQuestionRecommendationGateway',
      ],
      'src/rag/reference-remote-rag-retrieval.ts': ['ReferenceRemoteRagRetrievalClient', 'createReferenceRemoteRagRetrievalGateway'],
      'src/rag/reference-remote-workflow-rag-retrieval.ts': [
        'ReferenceRemoteWorkflowRagClient',
        'createHttpWorkflowRagClient',
        'createReferenceRemoteWorkflowRagGateway',
      ],
      'src/sandbox/reference-remote-sandbox.ts': ['ReferenceRemoteSandboxClient', 'createReferenceRemoteSandboxGateway'],
      'src/scheduled/reference-remote-scheduled-maintenance.ts': [
        'ReferenceRemoteScheduledMaintenanceClient',
        'createReferenceRemoteScheduledMaintenanceGateway',
      ],
      'src/skillhub-http-v1-gateway.ts': [
        'FetchSkillHubRemoteGatewayFactoryOptions',
        'SkillHubRemoteCandidate',
        'SkillHubRemoteContentInput',
        'SkillHubRemoteContentResult',
        'SkillHubRemoteGatewayAdapter',
        'SkillHubRemoteGatewayFactory',
        'SkillHubRemoteGatewayFactoryInput',
        'SkillHubRemoteListInput',
        'SkillHubRemoteListResult',
        'createFetchSkillHubRemoteGatewayFactory',
      ],
      'src/workflow-remote-execution-gateway.ts': [
        'FetchWorkflowRemoteExecutionGateway',
        'FetchWorkflowRemoteExecutionGatewayOptions',
        'FetchWorkflowRemoteFailureReasonCode',
        'FetchWorkflowRemoteStreamItem',
        'WorkflowRemoteExecutionGatewayConfig',
        'createFetchWorkflowRemoteExecutionGateway',
      ],
    },
  },
  {
    packageRoot: 'packages/agent-remote-deployment',
    allowedWorkspaceDependencies: [
      '@nextagent/agent-app',
      '@nextagent/agent-context-engine',
      '@nextagent/agent-contracts',
      '@nextagent/agent-platform-gateway-local',
      '@nextagent/agent-platform-gateway-remote',
    ],
    imports: {
      '@nextagent/agent-app': {
        value: ['classifyAppStartupFailure', 'createNextAgentApp', 'createNextAgentAppAsync'],
        type: ['CreateNextAgentAppOptions', 'NextAgentApp'],
      },
      '@nextagent/agent-app/config': {
        value: ['resolveDefaultSystemConfig'],
        type: [],
      },
      '@nextagent/agent-app/local-runtime-package': {
        value: [
          'checkLocalRuntimePackageLayout',
          'createRuntimePackageServiceVersion',
          'readLocalRuntimePackageManifest',
          'validateLocalRuntimePackageConfigSample',
        ],
        type: ['LocalRuntimeStartProof'],
      },
      '@nextagent/agent-common': {
        value: ['getLogger'],
        type: [],
      },
      '@nextagent/agent-context-engine': {
        value: ['createForkActiveContextSelector'],
        type: [],
      },
      '@nextagent/agent-contracts/gateway': {
        value: ['ragRetrievalResultSchema'],
        type: ['RagRetrievalResult', 'SandboxExecutionResult'],
      },
      '@nextagent/agent-contracts/model': {
        value: [],
        type: ['ModelGatewayModelInformationService'],
      },
      '@nextagent/agent-platform-gateway-local': {
        value: ['createRemoteSupportLocalGatewayProvider', 'createSqliteLongTermMemoryGatewayProvider', 'createSqliteWorkingMemoryGatewayProvider'],
        type: [],
      },
      '@nextagent/agent-platform-gateway-remote': {
        value: [
          'createHttpQuestionRecommendationClient',
          'createHttpWorkflowRagClient',
          'createReferenceRemoteModelGatewayProvider',
          'createReferenceRemoteQuestionRecommendationGateway',
          'createReferenceRemoteRagRetrievalGateway',
          'createReferenceRemoteSandboxGateway',
          'createReferenceRemoteWorkflowRagGateway',
          'createRemoteGatewayProvider',
        ],
        type: [
          'ReferenceRemoteModelGatewayClient',
          'ReferenceRemoteRagRetrievalClient',
          'ReferenceRemoteSandboxClient',
          'ReferenceRemoteWorkflowRagClient',
        ],
      },
    },
    indexExports: [],
    exportedDeclarations: {
      'src/index.ts': [
        'RemoteDeploymentOptions',
        'VendorRemoteGatewayClients',
        'createRemoteNextAgentApp',
        'createRemoteOtlpMetricExporter',
        'startRemoteRuntimePackage',
        'stopRemoteRuntimePackage',
      ],
    },
  },
];

const contractShapeGuards = {
  'packages/agent-contracts/src/gateway/index.ts': {
    GatewayProviderCreateInput: {
      extends: [],
      members: {
        selectedEntries: 'readonly GatewayProviderSelectionEntry[]',
        runtime: 'GatewayProviderRuntimeContext',
        'executionCorrelation?': 'ExecutionCorrelationPort',
        'signal?': 'AbortSignal',
      },
    },
    FetchGateway: {
      extends: [],
      members: {
        fetch: '(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>',
      },
    },
    GatewayBindings: {
      extends: [],
      members: {
        providerId: 'string',
        deploymentMode: 'GatewayDeploymentMode',
        readiness: 'GatewayBindingReadiness',
        'workingMemory?': 'WorkingMemoryGatewayBindings',
        'longTermMemory?': 'LongTermMemoryGatewayBindings',
        'audit?': 'AuditEventStoreGateway',
        'sqliteStores?': 'SqliteGatewayStoreBindings',
        'sandbox?': 'SandboxGatewayPort',
        'ragRetrieval?': 'RagRetrievalGateway',
        'workflowRagRetrieval?': 'WorkflowRagRetrievalGateway',
        'scheduledMaintenance?': 'ScheduledMaintenanceGatewayPort',
        'cronTasks?': 'CronTaskGatewayPort',
        'guardrail?': 'GuardrailGatewayPort',
        'watermark?': 'WatermarkGatewayPort',
        'fetch?': 'FetchGateway',
        'userQuery?': 'UserQueryGateway',
        'close?': '() => Promise<void> | void',
      },
    },
    UserQueryRequest: {
      extends: ['OwnerScoped'],
      members: {
        targetSubjectIds: 'readonly SubjectId[]',
      },
    },
    UserProfileRecord: {
      extends: [],
      members: {
        subjectId: 'SubjectId',
        userName: 'string',
      },
    },
    UserQueryResult: {
      extends: [],
      members: {
        users: 'readonly UserProfileRecord[]',
      },
    },
    UserQueryGateway: {
      extends: [],
      members: {
        queryUsers: '(request: UserQueryRequest, signal?: AbortSignal) => Promise<UserQueryResult | SafeError>',
      },
    },
    SandboxExecutionRequest: {
      extends: ['OwnerScoped'],
      members: {
        executionId: 'string',
        requestRunId: 'RequestRunId',
        executable: "'bash' | 'python'",
        command: 'string',
        args: 'readonly string[]',
        filesystem: 'SandboxFilesystemLayout',
        environment: 'JsonObject',
        timeoutMs: 'number',
        stdoutLimitBytes: 'number',
        stderrLimitBytes: 'number',
      },
    },
    SandboxExecutionResult: {
      extends: [],
      members: {
        executionId: 'string',
        'exitCode?': 'number',
        stdout: 'string',
        stderr: 'string',
        stdoutTruncated: 'boolean',
        stderrTruncated: 'boolean',
        timedOut: 'boolean',
        durationMs: 'number',
        'safeError?': 'SafeError',
      },
    },
    RagRetrievalRequest: {
      extends: ['OwnerScoped'],
      members: {
        agentId: 'AgentId',
        agentVersion: 'AgentVersion',
        knowledgeScope: 'RagKnowledgeScope',
        query: 'string',
        indexes: 'readonly string[]',
        options: 'RagRetrievalOptions',
      },
    },
    RagRetrievalResult: {
      extends: [],
      members: {
        status: 'RagRetrievalStatus',
        results: 'readonly RagRetrievalChunk[]',
        'diagnostics?': 'RagRetrievalDiagnostics',
      },
    },
    WorkflowRagRetrievalRequest: {
      extends: ['OwnerScoped'],
      members: {
        agentId: 'AgentId',
        agentVersion: 'AgentVersion',
        knowledgeScope: 'RagKnowledgeScope',
        query: 'string',
        indexes: 'readonly WorkflowRagRetrievalIndex[]',
        options: 'RagRetrievalOptions',
      },
    },
    WorkflowRagRetrievalResult: {
      extends: [],
      members: {
        status: 'RagRetrievalStatus',
        'query?': 'string',
        'additional?': 'readonly unknown[]',
        recommends: 'readonly JsonObject[]',
        'textRecallResults?': 'unknown',
        'vectorRecallResults?': 'unknown',
        'diagnostics?': 'RagRetrievalDiagnostics',
      },
    },
  },
  'packages/agent-contracts/src/model/index.ts': {
    ModelInvocationRequest: {
      extends: ['ModelInferenceOptions'],
      members: {
        invocationScope: 'ModelInvocationScope',
        modelId: 'string',
        'contextWindowTokens?': 'number',
        messages: 'readonly ModelMessage[]',
        tools: 'readonly ModelToolDescriptor[]',
        'timeoutMs?': 'number',
        'maxRetries?': 'number',
      },
    },
    ModelStreamDelta: {
      extends: [],
      members: {
        'content?': 'string',
        'reasoning?': 'string',
        'toolCall?': 'ModelToolCall',
      },
    },
    ModelFinalResult: {
      extends: [],
      members: {
        content: 'string',
        'reasoning?': 'string',
        'finishReason?': 'ModelFinishReason',
        'incompleteOutputReason?': 'ModelIncompleteOutputReason',
        'usage?': 'ModelUsage',
        'toolCalls?': 'readonly ModelToolCall[]',
        'providerResponseId?': 'string',
        'safeError?': 'SafeError',
      },
    },
  },
} satisfies Readonly<Record<string, Readonly<Record<string, InterfaceShape>>>>;

interface InterfaceShape {
  readonly extends: readonly string[];
  readonly members: Readonly<Record<string, string>>;
}

describe('NetAgent external dependency interface guard', () => {
  for (const guard of packageGuards) {
    it(`keeps ${guard.packageRoot} on the documented @nextagent interface surface`, () => {
      expect(collectNextAgentImports(join(root, guard.packageRoot, 'src'))).toEqual(normalizeExpectedImports(guard.imports));
    });

    it(`keeps ${guard.packageRoot} package manifest on documented workspace dependencies`, () => {
      const manifest = JSON.parse(readFileSync(join(root, guard.packageRoot, 'package.json'), 'utf8')) as {
        readonly dependencies?: Record<string, unknown>;
      };
      const workspaceDependencies = Object.keys(manifest.dependencies ?? {})
        .filter((dependency) => dependency.startsWith('@nextagent/'))
        .sort();

      expect(workspaceDependencies).toEqual([...guard.allowedWorkspaceDependencies].sort());
    });

    it(`keeps ${guard.packageRoot} public source structure explicit`, () => {
      expect(collectIndexExports(join(root, guard.packageRoot, 'src', 'index.ts'))).toEqual([...guard.indexExports].sort());
      expect(collectExportedDeclarations(join(root, guard.packageRoot, 'src'), guard.packageRoot)).toEqual(
        normalizeExportedDeclarations(guard.exportedDeclarations),
      );
    });
  }

  it('documents that agent-channel-aico is not present in this checkout', () => {
    expect(existsSync(join(root, 'packages', 'agent-channel-aico'))).toBe(false);
  });

  it('keeps remote boundary DTO and model contract shapes stable', () => {
    for (const [filePath, expectedShapes] of Object.entries(contractShapeGuards)) {
      expect(collectInterfaceShapes(join(root, filePath), Object.keys(expectedShapes))).toEqual(expectedShapes);
    }
  });

  it('keeps remote boundary DTOs backed by runtime schemas where the remote edge validates payloads', () => {
    const gatewaySource = readFileSync(join(root, 'packages', 'agent-contracts', 'src', 'gateway', 'index.ts'), 'utf8');

    expect(gatewaySource).toContain('export const ragRetrievalRequestSchema');
    expect(gatewaySource).toContain('export const ragRetrievalResultSchema');
    expect(gatewaySource).toContain('export const workflowRagRetrievalRequestSchema');
    expect(gatewaySource).toContain('export const workflowRagRetrievalResultSchema');
  });
});

function collectNextAgentImports(sourceRoot: string): Readonly<Record<string, ModuleImports>> {
  const imports = new Map<string, Record<ImportKind, Set<string>>>();
  for (const filePath of collectSourceFiles(sourceRoot)) {
    const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const moduleName = statement.moduleSpecifier.text;
      if (!moduleName.startsWith('@nextagent/')) {
        continue;
      }
      const importClause = statement.importClause;
      if (importClause === undefined) {
        throw new Error(`Side-effect @nextagent import is not allowed: ${relative(root, filePath)} -> ${moduleName}`);
      }
      const moduleImports = ensureModuleImports(imports, moduleName);
      const clauseIsTypeOnly = importClause.isTypeOnly;
      if (importClause.name !== undefined) {
        moduleImports[clauseIsTypeOnly ? 'type' : 'value'].add(importClause.name.text);
      }
      const namedBindings = importClause.namedBindings;
      if (namedBindings === undefined) {
        continue;
      }
      if (ts.isNamespaceImport(namedBindings)) {
        moduleImports[clauseIsTypeOnly ? 'type' : 'value'].add(`* as ${namedBindings.name.text}`);
        continue;
      }
      for (const specifier of namedBindings.elements) {
        const importedName = specifier.propertyName?.text ?? specifier.name.text;
        moduleImports[clauseIsTypeOnly || specifier.isTypeOnly ? 'type' : 'value'].add(importedName);
      }
    }
  }
  return Object.fromEntries(
    [...imports.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([moduleName, moduleImports]) => [
        moduleName,
        {
          value: [...moduleImports.value].sort(),
          type: [...moduleImports.type].sort(),
        },
      ]),
  );
}

function collectSourceFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function collectIndexExports(filePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  return sourceFile.statements
    .flatMap((statement) => {
      if (!ts.isExportDeclaration(statement)) {
        return [];
      }
      const moduleSpecifier = statement.moduleSpecifier;
      return moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier) ? [moduleSpecifier.text] : [];
    })
    .sort();
}

function collectExportedDeclarations(sourceRoot: string, packageRoot: string): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    collectSourceFiles(sourceRoot)
      .map((filePath) => {
        const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
        const declarations: string[] = [];
        for (const statement of sourceFile.statements) {
          if (!hasExportKeyword(statement)) {
            continue;
          }
          if (ts.isVariableStatement(statement)) {
            declarations.push(
              ...statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])),
            );
            continue;
          }
          if (
            (ts.isInterfaceDeclaration(statement) ||
              ts.isTypeAliasDeclaration(statement) ||
              ts.isFunctionDeclaration(statement) ||
              ts.isClassDeclaration(statement)) &&
            statement.name !== undefined
          ) {
            declarations.push(statement.name.text);
          }
        }
        return [normalizePath(relative(join(root, packageRoot), filePath)), declarations.sort()] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function collectInterfaceShapes(filePath: string, names: readonly string[]): Readonly<Record<string, InterfaceShape>> {
  const expectedNames = new Set(names);
  const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  const shapes = new Map<string, InterfaceShape>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) || !expectedNames.has(statement.name.text) || !hasExportKeyword(statement)) {
      continue;
    }
    shapes.set(statement.name.text, {
      extends:
        statement.heritageClauses?.flatMap((clause) =>
          clause.types.map((type) => printer.printNode(ts.EmitHint.Unspecified, type.expression, sourceFile)),
        ) ?? [],
      members: Object.fromEntries(
        statement.members.flatMap((member) => {
          if (ts.isPropertySignature(member) && member.type !== undefined && ts.isIdentifier(member.name)) {
            const name = `${member.name.text}${member.questionToken === undefined ? '' : '?'}`;
            return [[name, printer.printNode(ts.EmitHint.Unspecified, member.type, sourceFile)]];
          }
          if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
            const name = `${member.name.text}${member.questionToken === undefined ? '' : '?'}`;
            const parameters = member.parameters
              .map((parameter) => {
                const parameterName = ts.isIdentifier(parameter.name)
                  ? parameter.name.text
                  : printer.printNode(ts.EmitHint.Unspecified, parameter.name, sourceFile);
                const optional = parameter.questionToken === undefined ? '' : '?';
                const type = parameter.type === undefined ? 'unknown' : printer.printNode(ts.EmitHint.Unspecified, parameter.type, sourceFile);
                return `${parameterName}${optional}: ${type}`;
              })
              .join(', ');
            const returnType = member.type === undefined ? 'void' : printer.printNode(ts.EmitHint.Unspecified, member.type, sourceFile);
            return [[name, `(${parameters}) => ${returnType}`]];
          }
          return [];
        }),
      ),
    });
  }
  return Object.fromEntries([...shapes.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function hasExportKeyword(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function normalizeExportedDeclarations(expected: Readonly<Record<string, readonly string[]>>): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(expected)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, declarations]) => [filePath, [...declarations].sort()]),
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function ensureModuleImports(imports: Map<string, Record<ImportKind, Set<string>>>, moduleName: string): Record<ImportKind, Set<string>> {
  const existing = imports.get(moduleName);
  if (existing !== undefined) {
    return existing;
  }
  const created = { type: new Set<string>(), value: new Set<string>() };
  imports.set(moduleName, created);
  return created;
}

function normalizeExpectedImports(expected: Readonly<Record<string, ModuleImports>>): Readonly<Record<string, ModuleImports>> {
  return Object.fromEntries(
    Object.entries(expected)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([moduleName, moduleImports]) => [
        moduleName,
        {
          value: [...moduleImports.value].sort(),
          type: [...moduleImports.type].sort(),
        },
      ]),
  );
}
