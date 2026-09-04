import { brand, getLogger, type CapabilityId, type JsonObject } from '@nextagent/agent-common';
import type { CapabilityInvocationResult } from '@nextagent/agent-contracts/capability';
import { load as parseYaml } from 'js-yaml';
import { defineTool, type ApiCallPort, type ApiCallRequest, type ToolExecuteOptions } from '../tools/tool-spi.js';
import type { SkillResourceMetadata } from '../skills/skill-source-discovery.js';

const logger = getLogger({ component: 'agent-capability', source: 'api-call-tool' });
const fallbackSignal = new AbortController().signal;
const apiCallTimeoutMessage =
  'The API call timed out after dispatch and its final result is unknown. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the timeout.';

const apiToolDescription =
  'Invoke an external API declared in a Skill body. When a Skill contains an api command block (e.g. ```api\napi -name RAGRetriever -hiro ir\n```), use this tool to execute it. Provide apiName matching the -name value, hiro matching the -hiro value if present, plus headerParams and requestParams from context. The tool loads the API swagger YAML, extracts missing required parameters via the model, and executes the HTTP request.';

export const apiCallToolDefinition = defineTool({
  name: brand<string, 'CapabilityId'>('ApiCall'),
  description: apiToolDescription,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['apiName', 'userQuestion', 'requestParams'],
    properties: {
      apiName: { type: 'string', minLength: 1, maxLength: 128, description: 'API name from the parsed api command.' },
      hiro: { type: 'string', maxLength: 16, description: 'Hiro value from the parsed api command.' },
      userQuestion: { type: 'string', maxLength: 8192, description: 'Original user question from trusted context.' },
      headerParams: { type: 'object', additionalProperties: true, description: 'Header params extracted from request headers.' },
      requestParams: { type: 'object', additionalProperties: true, description: 'Request params from trusted context.' },
      skillName: { type: 'string', minLength: 1, maxLength: 128, description: 'Skill capability id.' },
      skillVersion: { type: 'string', description: 'Skill version.' },
      providerId: { type: 'string', description: 'Skill provider id.' },
      sourceIdentity: { type: 'string', description: 'Skill source identity.' },
      frontmatterHash: { type: 'string', description: 'Skill frontmatter hash.' },
      skillBody: { type: 'string', description: 'Skill body content for parameter extraction context.' },
      passThroughFlag: {
        type: 'string',
        description: 'Pass-through flag from skill extension (_naie_pass_through_flag). When "true", skip parameter extraction.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    additionalProperties: true,
  },
  requiredDependencies: ['skillSources', 'apiCallPort', 'parameterExtraction'],
  replayPolicy: 'NON_IDEMPOTENT',
  disclosurePolicy: { mode: 'EAGER' },
  returnsCapabilityResult: true,
  async execute(input, options) {
    return executeApiCallTool(input, options);
  },
});

async function executeApiCallTool(input: JsonObject, options?: ToolExecuteOptions): Promise<CapabilityInvocationResult> {
  if (options?.signal?.aborted) {
    return failed('ABORTED', 'API call was aborted.', 'CANCELED');
  }

  const apiName = input.apiName as string;
  const userQuestion = input.userQuestion as string;
  const headerParams = (input.headerParams ?? {}) as Record<string, string>;
  const requestParams = (input.requestParams ?? {}) as Record<string, unknown>;
  const skillName = (input.skillName as string) ?? '';
  const skillVersion = (input.skillVersion as string) ?? 'unversioned';
  const providerId = (input.providerId as string) ?? '';
  const sourceIdentity = (input.sourceIdentity as string) ?? '';
  const frontmatterHash = (input.frontmatterHash as string) ?? '';
  const skillBody = (input.skillBody as string) ?? '';

  const skillSources = options?.deps?.skillSources;
  const apiCallPort = options?.deps?.apiCallPort;
  const parameterExtraction = options?.deps?.parameterExtraction;
  const context = options?.context;

  const _reqId = context?.requestId ?? 'unknown';
  const _sessionId = context?.sessionId ?? 'unknown';
  logger.info({
    event: 'api.call.debug.entry',
    requestId: _reqId,
    sessionId: _sessionId,
    apiName,
    passThroughFlag: typeof input.passThroughFlag === 'string' ? input.passThroughFlag : '',
    headerParamCount: Object.keys(headerParams).length,
    requestParamCount: Object.keys(requestParams).length,
  });

  // Auto-resolve skill metadata when called directly by the model.
  // When the model calls ApiCall directly, skillName/providerId/etc are typically omitted.
  // Priority: 1) flowVariables from the preceding Skill tool invocation
  //           2) capabilityResolver as fallback
  let resolvedSkillName = skillName;
  let resolvedSkillVersion = skillVersion;
  let resolvedProviderId = providerId;
  let resolvedSourceIdentity = sourceIdentity;
  let resolvedFrontmatterHash = frontmatterHash;
  let resolvedSkillBody = skillBody;

  // Step 1: Check flowVariables for active skill context (set by Skill tool in agentic mode)
  const activeSkillCtx = context?.flowVariables?.['activeSkillContext'];
  if (activeSkillCtx !== undefined && activeSkillCtx !== null && typeof activeSkillCtx === 'object' && !Array.isArray(activeSkillCtx)) {
    const ctx = activeSkillCtx as Record<string, unknown>;
    if (resolvedSkillName.length === 0 && typeof ctx.skillName === 'string') {
      resolvedSkillName = ctx.skillName;
    }
    if (resolvedSkillVersion === 'unversioned' && typeof ctx.skillVersion === 'string') {
      resolvedSkillVersion = ctx.skillVersion;
    }
    if (resolvedProviderId.length === 0 && typeof ctx.providerId === 'string') {
      resolvedProviderId = ctx.providerId;
    }
    if (resolvedSourceIdentity.length === 0 && typeof ctx.sourceIdentity === 'string') {
      resolvedSourceIdentity = ctx.sourceIdentity;
    }
    if (resolvedFrontmatterHash.length === 0 && typeof ctx.frontmatterHash === 'string') {
      resolvedFrontmatterHash = ctx.frontmatterHash;
    }
    if (typeof ctx.passThroughFlag === 'string') {
      (input as Record<string, unknown>).passThroughFlag = ctx.passThroughFlag;
    }
    // Auto-fill requestParams from apiRequestParams (e.g. "query" → userQuestion)
    if (typeof ctx.apiRequestParams === 'string' && ctx.apiRequestParams.length > 0) {
      const paramNames = ctx.apiRequestParams
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const name of paramNames) {
        if (!(name in requestParams) && name === 'query') {
          requestParams[name] = userQuestion;
        }
      }
    }

    // --- DEBUG LOG: flowVariables resolved ---
    logger.info({
      event: 'api.call.debug.flowVariables_resolved',
      requestId: _reqId,
      sessionId: _sessionId,
      apiName,
      resolvedSkillName,
      resolvedSkillVersion,
      resolvedProviderId,
      resolvedSourceIdentity,
      resolvedFrontmatterHash,
      passThroughFlag: ((input as Record<string, unknown>).passThroughFlag as string) ?? '',
    });
  }

  // Step 2: Fallback to capabilityResolver if still missing
  if (resolvedProviderId.length === 0 || resolvedSkillName.length === 0) {
    // Guard: if both resolvedSkillName and skillName are empty, brand('') will throw INVALID_BRAND_VALUE
    if (resolvedSkillName.length === 0 && skillName.length === 0) {
      logger.error({
        event: 'api.call.debug.error',
        requestId: _reqId,
        step: 'resolve_skill_identity',
        safeReasonCode: 'SKILL_IDENTITY_UNRESOLVED',
      });
      return failed(
        'EXECUTION_FAILED',
        'Cannot resolve skill identity. skillName is empty and no active skill context is available.',
        'UNAVAILABLE',
        { apiName },
      );
    }
    logger.info({ event: 'api.call.debug.step', requestId: _reqId, step: 'capabilityResolver_fallback', apiName });
    const descriptor = await context?.capabilityResolver?.resolveCapability?.(
      { kind: 'SKILL', capabilityId: brand<string, 'CapabilityId'>(resolvedSkillName.length > 0 ? resolvedSkillName : skillName) },
      options?.signal ?? fallbackSignal,
    );
    if (descriptor !== undefined && descriptor.kind === 'SKILL' && descriptor.availabilityStatus === 'AVAILABLE') {
      if (resolvedSkillName.length === 0) {
        resolvedSkillName = descriptor.capabilityId;
      }
      if (resolvedSkillVersion === 'unversioned' && descriptor.version !== undefined) {
        resolvedSkillVersion = descriptor.version;
      }
      if (resolvedProviderId.length === 0) {
        resolvedProviderId = descriptor.provider.providerId;
      }
      // descriptor.metadata may contain sourceMetadata from SkillMetadata
      const metaSrc = ((descriptor.metadata as Record<string, unknown> | undefined)?.sourceMetadata as Record<string, unknown> | undefined) ?? {};
      if (resolvedSourceIdentity.length === 0 && typeof metaSrc.sourceIdentity === 'string') {
        resolvedSourceIdentity = metaSrc.sourceIdentity;
      } else if (resolvedSourceIdentity.length === 0) {
        resolvedSourceIdentity = `${descriptor.provider.providerId}:${descriptor.capabilityId}`;
      }
      if (resolvedFrontmatterHash.length === 0 && typeof metaSrc.frontmatterHash === 'string') {
        resolvedFrontmatterHash = metaSrc.frontmatterHash;
      } else if (resolvedFrontmatterHash.length === 0) {
        resolvedFrontmatterHash = `${descriptor.capabilityId}-frontmatter`;
      }
      logger.info({
        event: 'api.call.debug.step',
        requestId: _reqId,
        step: 'capabilityResolver_resolved',
        apiName,
        resolvedSkillName,
        resolvedProviderId,
      });
    } else {
      logger.warn({
        event: 'api.call.debug.step',
        requestId: _reqId,
        step: 'capabilityResolver_not_found',
        apiName,
        descriptorAvailable: descriptor !== undefined,
      });
    }
  }

  // 1.6 passThroughFlag recalculation after auto-resolution
  const finalPassThroughFlag = typeof input.passThroughFlag === 'string' ? input.passThroughFlag : '';
  const isPassThroughFinal = finalPassThroughFlag === 'true';

  if (skillSources === undefined) {
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'check_deps',
      safeReasonCode: 'SKILL_SOURCES_UNAVAILABLE',
    });
    return failed('EXECUTION_FAILED', 'Skill sources dependency is unavailable.', 'UNAVAILABLE');
  }
  if (apiCallPort === undefined) {
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'check_deps',
      safeReasonCode: 'API_CALL_PORT_UNAVAILABLE',
    });
    return failed('EXECUTION_FAILED', 'API call port dependency is unavailable.', 'UNAVAILABLE');
  }
  if (parameterExtraction === undefined) {
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'check_deps',
      safeReasonCode: 'PARAMETER_EXTRACTION_UNAVAILABLE',
    });
    return failed('EXECUTION_FAILED', 'Parameter extraction dependency is unavailable.', 'UNAVAILABLE');
  }
  if (context === undefined) {
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'check_deps',
      safeReasonCode: 'EXECUTION_CONTEXT_UNAVAILABLE',
    });
    return failed('EXECUTION_FAILED', 'Execution context is unavailable.', 'UNAVAILABLE');
  }

  const source = skillSources.resolveSkillSource(resolvedProviderId);
  if (source === undefined) {
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'resolve_skill_source',
      safeReasonCode: 'SKILL_SOURCE_UNAVAILABLE',
      resolvedProviderId,
    });
    return failed('EXECUTION_FAILED', 'Skill source is unavailable.', 'UNAVAILABLE', { apiName });
  }

  logger.info({ event: 'api.call.debug.step', requestId: _reqId, step: 'skill_source_resolved', apiName, resolvedProviderId });

  // Step 1: Read and parse Swagger yaml
  logger.info({ event: 'api.call.step', apiName, step: 'read_yaml', requestId: _reqId });

  const resourceMetadata: SkillResourceMetadata = {
    relativePath: `api/${apiName}.yaml`,
    kind: 'asset',
    sizeBytes: 0,
  };

  let apiDoc: ApiDoc | undefined;
  try {
    const resource = await source.readSkillResource?.(
      { skillName: brand<string, 'CapabilityId'>(resolvedSkillName), skillVersion: resolvedSkillVersion, resource: resourceMetadata },
      options?.signal ?? fallbackSignal,
    );
    if (resource === undefined) {
      logger.error({
        event: 'api.call.debug.error',
        requestId: _reqId,
        step: 'read_yaml',
        safeReasonCode: 'API_DOCUMENT_UNAVAILABLE',
        apiName,
      });
      return failed('API_DOC_LOAD_FAILED', 'API document could not be loaded.', 'VALIDATION', { apiName });
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of resource.contentStream) {
      chunks.push(chunk);
    }
    const yamlText = Buffer.concat(chunks).toString('utf8');
    logger.info({
      event: 'api.call.debug.step',
      requestId: _reqId,
      step: 'yaml_loaded',
      apiName,
      yamlLength: yamlText.length,
    });
    apiDoc = parseSwaggerYaml(yamlText);

    if (apiDoc === undefined) {
      logger.error({
        event: 'api.call.debug.error',
        requestId: _reqId,
        step: 'parse_yaml',
        safeReasonCode: 'API_DOCUMENT_INVALID',
        apiName,
        yamlLength: yamlText.length,
      });
      return failed('API_DOC_LOAD_FAILED', 'API document could not be parsed.', 'VALIDATION', { apiName });
    }

    logger.info({
      event: 'api.call.debug.swagger_parsed',
      requestId: _reqId,
      apiName,
      baseUrl: apiDoc.baseUrl,
      path: apiDoc.path,
      method: apiDoc.method,
      produces: apiDoc.produces,
      parameterCount: apiDoc.parameters.length,
    });
  } catch (error) {
    if (isAbort(error)) {
      return failed('ABORTED', 'API call was aborted.', 'CANCELED', { apiName });
    }
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'read_yaml',
      safeReasonCode: 'API_DOCUMENT_LOAD_FAILED',
      err: error,
      apiName,
    });
    return failed('API_DOC_LOAD_FAILED', 'API document loading failed safely.', 'VALIDATION', { apiName });
  }

  // Auto-load skillBody from source if omitted (model direct call scenario)
  if (resolvedSkillBody.length === 0 && resolvedSkillName.length > 0 && resolvedProviderId.length > 0) {
    try {
      const bodyInput = {
        skillName: brand<string, 'CapabilityId'>(resolvedSkillName),
        skillVersion: resolvedSkillVersion as string,
        capabilityId: brand<string, 'CapabilityId'>(resolvedSkillName),
        sourceIdentity: resolvedSourceIdentity as string,
        frontmatterHash: resolvedFrontmatterHash as string,
      };
      const loadedBody = await source.loadCanonicalBodyView?.(bodyInput, options?.signal ?? fallbackSignal);
      if (loadedBody !== undefined && loadedBody.body !== undefined) {
        resolvedSkillBody = loadedBody.body;
      }
    } catch {
      /* best effort */
    }
  }

  // Step 2: Parameter extraction for required params not covered by requestParams
  const requiredParamsToExtract = isPassThroughFinal
    ? []
    : apiDoc.parameters.flatMap((p) => {
        if (p.location === 'body' && p.childParams !== undefined && p.childParams.length > 0) {
          // Check each child param individually
          return p.childParams.filter((c) => c.required && !(c.name in requestParams) && !(c.name in headerParams));
        }
        // Non-body or body without childParams: check parent as before
        return p.required && !(p.name in requestParams) && !(p.name in headerParams) ? [p] : [];
      });

  logger.info({
    event: 'api.call.debug.param_extraction_analysis',
    requestId: _reqId,
    apiName,
    isPassThroughFinal,
    requiredParamsToExtractCount: requiredParamsToExtract.length,
  });

  let extractedParams: Record<string, unknown> = {};
  // Skip extraction if all required params are already covered by requestParams or headerParams
  if (requiredParamsToExtract.length > 0) {
    logger.info({ event: 'api.call.step', apiName, step: 'parameter_extraction', requestId: _reqId });

    const extractionPrompt = buildExtractionPrompt(userQuestion, requiredParamsToExtract, resolvedSkillBody);
    const extractionResult = await parameterExtraction.extractParams(
      {
        prompt: extractionPrompt,
        identityContext: context.identityContext,
        agentId: context.agentId,
        agentVersion: context.agentVersion,
        sessionId: context.sessionId,
        requestId: context.requestId,
        runId: context.runId,
        requestContextId: context.requestContextId,
        stepId: context.stepId,
        ...(context.locale === undefined ? {} : { locale: context.locale }),
        timeoutMs: context.timeoutMs,
      },
      options?.signal ?? fallbackSignal,
    );

    if (extractionResult.status === 'TIMED_OUT') {
      logger.error({
        event: 'api.call.debug.error',
        requestId: _reqId,
        step: 'parameter_extraction',
        safeReasonCode: 'PARAMETER_EXTRACTION_TIMEOUT',
      });
      return failed('PARAMETER_EXTRACTION_TIMEOUT', 'Parameter extraction timed out.', 'UNAVAILABLE', { apiName });
    }
    if (extractionResult.status === 'FAILED') {
      logger.error(
        {
          event: 'api.call.debug.error',
          requestId: _reqId,
          step: 'parameter_extraction',
          safeReasonCode: extractionResult.safeErrorCode ?? 'PARAMETER_EXTRACTION_FAILED',
        },
        extractionResult.safeErrorMessage,
      );
      return failed(
        extractionResult.safeErrorCode ?? 'PARAMETER_EXTRACTION_FAILED',
        extractionResult.safeErrorMessage ?? 'Parameter extraction failed.',
        'VALIDATION',
        { apiName },
      );
    }
    if (extractionResult.parameters !== undefined) {
      extractedParams = extractionResult.parameters as Record<string, unknown>;

      logger.info({
        event: 'api.call.debug.extracted_params',
        requestId: _reqId,
        apiName,
        extractedParamCount: Object.keys(extractedParams).length,
      });

      // Wrap child param values under their parent body param name
      for (const param of requiredParamsToExtract) {
        if (param.childParams !== undefined && param.childParams.length > 0) {
          const childValues: Record<string, unknown> = {};
          for (const child of param.childParams) {
            collectChildValue(child, extractedParams, childValues);
          }
          if (Object.keys(childValues).length > 0) {
            extractedParams[param.name] = childValues;
          }
        }
      }
    }
  }

  // Step 3: Merge all params and build HTTP request
  const mergedParams: Record<string, unknown> = { ...extractedParams, ...requestParams };

  // Auto-fill: if a required param named "query" is still missing, assign userQuestion
  // This handles pass-through and api_request_params cases where query = user question
  if (!('query' in mergedParams) && userQuestion.length > 0) {
    const queryParamMissing = apiDoc.parameters.some((p) => {
      if (p.location === 'body' && p.childParams !== undefined && p.childParams.length > 0) {
        return p.childParams.some((c) => c.required && c.name === 'query');
      }
      return p.required && p.name === 'query';
    });
    if (queryParamMissing) {
      mergedParams['query'] = userQuestion;
    }
  }

  logger.info({
    event: 'api.call.debug.merged_params',
    requestId: _reqId,
    apiName,
    mergedParamCount: Object.keys(mergedParams).length,
  });

  // Validate that all required parameters have values after merge
  const missingRequired = apiDoc.parameters.flatMap((p) => {
    if (p.location === 'body' && p.childParams !== undefined && p.childParams.length > 0) {
      return p.childParams.filter((c) => c.required && !(c.name in mergedParams) && !(c.name in headerParams));
    }
    return p.required && !(p.name in mergedParams) && !(p.name in headerParams) ? [p] : [];
  });
  if (missingRequired.length > 0) {
    logger.error({
      event: 'api.call.debug.error',
      requestId: _reqId,
      step: 'validate_missing_required_params',
      safeReasonCode: 'REQUIRED_PARAMETERS_MISSING',
      missingParams: JSON.stringify(missingRequired.map((p) => ({ name: p.name, location: p.location }))),
    });
    return failed('MISSING_REQUIRED_PARAMS', 'Required parameters are missing after merge.', 'VALIDATION', {
      apiName,
      missingCount: missingRequired.length,
    });
  }
  const { path: finalPath, query: queryString, body } = buildHttpRequestParts(apiDoc, mergedParams);
  const fullPath = finalPath + (queryString.length > 0 ? queryString : '');

  // --- Header hardcoding: chatId/conversationId/x-user-id/x-user-name ---
  const _inputVars = context?.flowVariables?.['input_variables'];
  const _requestHeaders =
    _inputVars !== undefined && _inputVars !== null && typeof _inputVars === 'object' && !Array.isArray(_inputVars)
      ? (_inputVars as Record<string, unknown>)['requestHeaders']
      : undefined;
  const _requestHeadersMap: Record<string, string> =
    _requestHeaders !== undefined && _requestHeaders !== null && typeof _requestHeaders === 'object' && !Array.isArray(_requestHeaders)
      ? (_requestHeaders as Record<string, string>)
      : {};
  const _identityContext = context?.identityContext as unknown as Record<string, unknown> | undefined;
  let _xUserName = typeof _identityContext?.displayName === 'string' ? (_identityContext.displayName as string) : '';
  if (_xUserName.length === 0 && typeof _requestHeadersMap['x-display-name'] === 'string') {
    _xUserName = _requestHeadersMap['x-display-name'];
  }
  let _xUserId = typeof _identityContext?.subjectId === 'string' ? (_identityContext.subjectId as string) : '';
  if (_xUserId.length === 0 && typeof _requestHeadersMap['x-subject-id'] === 'string') {
    _xUserId = _requestHeadersMap['x-subject-id'];
  }
  const headers: Record<string, string> = {
    ...headerParams,
    'content-type': 'application/json',
    chatId: _reqId,
    conversationId: _sessionId,
    'x-user-id': _xUserId,
    'x-user-name': _xUserName,
  };

  const apiRequest: ApiCallRequest = {
    baseUrl: apiDoc.baseUrl,
    path: fullPath,
    method: apiDoc.method,
    headers,
    ...(body === undefined ? {} : { body }),
    timeoutMs: context.timeoutMs,
    requestId: _reqId,
  };

  logger.info({
    event: 'api.call.debug.http_request',
    requestId: _reqId,
    apiName,
    baseUrl: apiRequest.baseUrl,
    path: apiRequest.path,
    method: apiRequest.method,
    headerCount: Object.keys(apiRequest.headers).length,
    ...(apiRequest.body === undefined ? {} : { requestBodyLength: apiRequest.body.length }),
    timeoutMs: apiRequest.timeoutMs,
  });

  // Step 4: Execute HTTP call (streaming or non-streaming)
  const isStreaming = apiDoc.produces === 'text/event-stream';

  if (isStreaming) {
    logger.info({ event: 'api.call.step', apiName, step: 'http_call_stream', requestId: _reqId });
    try {
      const streamDataParts: string[] = [];
      for await (const chunk of apiCallPort.callApiStream(apiRequest, options?.signal ?? fallbackSignal)) {
        if (context.emitResultDelta !== undefined) {
          let structuredPayload: JsonObject = {};
          try {
            const parsed = JSON.parse(chunk.data);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
              structuredPayload = parsed as JsonObject;
            } else {
              structuredPayload = { raw: chunk.data };
            }
          } catch {
            structuredPayload = { raw: chunk.data };
          }
          await context.emitResultDelta({ structuredPayload });
        }
        if (typeof chunk.data === 'string' && chunk.data.length > 0) {
          streamDataParts.push(chunk.data);
        }
      }
      const aggregatedStreamData = streamDataParts.join('');
      logger.info({
        event: 'api.call.completed',
        apiName,
        result: 'stream_complete',
        requestId: _reqId,
        streamDataLength: aggregatedStreamData.length,
      });
      return {
        status: 'SUCCEEDED',
        structuredPayload: aggregatedStreamData.length > 0 ? { result: aggregatedStreamData } : {},
        generatedMessages: [],
        artifactRefs: [],
        metadata: { apiName, streaming: true },
      };
    } catch (error) {
      if (isTimeout(error)) {
        return timedOut('TIMEOUT', apiCallTimeoutMessage, { apiName });
      }
      if (isAbort(error)) {
        return failed('CAPABILITY_ABORTED', 'API call was aborted.', 'CANCELED', { apiName });
      }
      logger.warn({
        event: 'api.call.stream_interrupted',
        apiName,
        requestId: _reqId,
        safeReasonCode: 'API_STREAM_INTERRUPTED',
        err: error,
      });
      return failed(
        'API_STREAM_INTERRUPTED',
        'The API response stream was interrupted after dispatch, so the complete result is unavailable. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the interruption.',
        'UNAVAILABLE',
        { apiName },
      );
    }
  } else {
    logger.info({ event: 'api.call.step', apiName, step: 'http_call', requestId: _reqId });
    try {
      const result = await apiCallPort.callApi(apiRequest, options?.signal ?? fallbackSignal);

      logger.info({
        event: 'api.call.debug.http_response',
        requestId: _reqId,
        apiName,
        httpStatus: result.status,
        responseBodyLength: result.body.length,
      });

      if (result.status === 401 || result.status === 403) {
        logger.error({ event: 'api.call.debug.error', requestId: _reqId, step: 'http_response_auth', httpStatus: result.status, apiName });
        return failed('UNAUTHORIZED', 'API call was unauthorized.', 'AUTHORIZATION', { apiName });
      }
      if (result.status >= 400) {
        logger.error({
          event: 'api.call.debug.error',
          requestId: _reqId,
          step: 'http_response_error',
          httpStatus: result.status,
          apiName,
          ...(apiRequest.body === undefined ? {} : { requestBodyLength: apiRequest.body.length }),
          responseBodyLength: result.body.length,
        });
        return failed('UNAVAILABLE', 'API call returned an error status.', 'UNAVAILABLE', { apiName, httpStatus: result.status });
      }

      let responsePayload: JsonObject = {};
      if (result.body.length > 0) {
        try {
          const parsed = JSON.parse(result.body);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            responsePayload = parsed as JsonObject;
          } else {
            responsePayload = { data: parsed } as JsonObject;
          }
        } catch {
          responsePayload = { raw: result.body } as JsonObject;
        }
      }

      logger.info({ event: 'api.call.completed', apiName, result: 'success', httpStatus: result.status, requestId: _reqId });
      return {
        status: 'SUCCEEDED',
        structuredPayload: responsePayload,
        generatedMessages: [],
        artifactRefs: [],
        metadata: { apiName, httpStatus: result.status },
      };
    } catch (error) {
      if (isTimeout(error)) {
        return timedOut('TIMEOUT', apiCallTimeoutMessage, { apiName });
      }
      if (isAbort(error)) {
        return failed('CAPABILITY_ABORTED', 'API call was aborted.', 'CANCELED', { apiName });
      }
      return failed(
        'UNAVAILABLE',
        'The API call failed after dispatch and no safe response was available. Do not automatically repeat this non-idempotent call. If the integration exposes an independent read or status operation, use it to verify remote state; otherwise stop and report the failure.',
        'UNAVAILABLE',
        { apiName },
      );
    }
  }
}

// --- Swagger parsing ---

interface ApiDoc {
  readonly baseUrl: string;
  readonly path: string;
  readonly method: string;
  readonly produces: string;
  readonly parameters: readonly ApiParameter[];
}

interface ApiParameter {
  readonly name: string;
  readonly location: 'path' | 'query' | 'body' | 'header';
  readonly required: boolean;
  readonly type?: string;
  readonly description?: string;
  readonly paramSelect?: string;
  readonly childParams?: readonly ApiParameter[];
}

function parseSwaggerYaml(yamlText: string): ApiDoc | undefined {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const doc = parsed as Record<string, unknown>;

  const host = typeof doc.host === 'string' ? doc.host : '';
  const basePath = typeof doc.basePath === 'string' ? doc.basePath : '';
  const schemes = Array.isArray(doc.schemes) ? doc.schemes.filter((s): s is string => typeof s === 'string') : [];
  const scheme = schemes.length > 0 ? schemes[0] : 'https';
  const baseUrl = host.length > 0 ? `${scheme}://${host}${basePath}` : basePath;

  const producesRaw = doc.produces;
  const produces =
    Array.isArray(producesRaw) && producesRaw.length > 0 && typeof producesRaw[0] === 'string'
      ? producesRaw[0]
      : typeof producesRaw === 'string'
        ? producesRaw
        : 'application/json';

  const paths = doc.paths;
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)) {
    return undefined;
  }
  const pathEntries = Object.entries(paths as Record<string, unknown>);
  if (pathEntries.length === 0) {
    return undefined;
  }
  const pathEntry = pathEntries[0];
  if (pathEntry === undefined) {
    return undefined;
  }
  const pathKey = pathEntry[0];
  const pathValue = pathEntry[1];
  if (pathValue === null || typeof pathValue !== 'object' || Array.isArray(pathValue)) {
    return undefined;
  }
  const pathItem = pathValue as Record<string, unknown>;
  const methodKeys = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];
  const methodEntry = Object.entries(pathItem).find(([key]) => methodKeys.includes(key.toLowerCase()));
  if (methodEntry === undefined) {
    return undefined;
  }
  const methodKey = methodEntry[0];
  const methodValue = methodEntry[1];
  if (methodValue === null || typeof methodValue !== 'object' || Array.isArray(methodValue)) {
    return undefined;
  }
  const operation = methodValue as Record<string, unknown>;

  const opProducesRaw = operation.produces;
  const opProduces =
    Array.isArray(opProducesRaw) && opProducesRaw.length > 0 && typeof opProducesRaw[0] === 'string'
      ? opProducesRaw[0]
      : typeof opProducesRaw === 'string'
        ? opProducesRaw
        : produces;

  const parametersRaw = operation.parameters;
  const parameters: ApiParameter[] = [];
  if (Array.isArray(parametersRaw)) {
    for (const param of parametersRaw) {
      if (param === null || typeof param !== 'object' || Array.isArray(param)) {
        continue;
      }
      const p = param as Record<string, unknown>;
      const name = typeof p.name === 'string' ? p.name : '';
      const location = typeof p.in === 'string' ? p.in : '';
      if (name.length === 0 || !['path', 'query', 'body', 'header'].includes(location)) {
        continue;
      }
      const required = p.required === true;
      const schema = p.schema;
      // If parameter has a $ref in schema, resolve into childParams (not flatten)
      if (schema !== null && typeof schema === 'object' && !Array.isArray(schema)) {
        const ref = (schema as Record<string, unknown>)['$ref'];
        if (typeof ref === 'string') {
          const childParams = resolveRefChildParams(doc, ref, required, 0);
          parameters.push({
            name,
            location: location as ApiParameter['location'],
            required,
            type: 'object',
            ...extractDescription(p),
            ...(childParams.length > 0 ? { childParams } : {}),
          });
          continue;
        }
      }
      // Normal parameter (no $ref)
      parameters.push({
        name,
        location: location as ApiParameter['location'],
        required,
        ...(typeof p.type === 'string' ? { type: p.type } : {}),
        ...(typeof (schema as Record<string, unknown> | undefined)?.type === 'string'
          ? { type: (schema as Record<string, unknown>).type as string }
          : {}),
        ...extractDescription(p),
        ...extractParamSelect(p, schema as Record<string, unknown> | undefined),
      });
    }
  }

  return {
    baseUrl,
    path: pathKey,
    method: methodKey.toUpperCase(),
    produces: opProduces,
    parameters,
  };
}

// --- $ref resolution ---

const maxRefDepth = 5;

function resolveRefChildParams(doc: Record<string, unknown>, ref: string, parentRequired: boolean, depth: number): ApiParameter[] {
  if (depth >= maxRefDepth) {
    return [];
  }
  const definition = resolveDefinition(doc, ref);
  if (definition === undefined) {
    return [];
  }
  const properties = definition.properties;
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return [];
  }
  const requiredList = Array.isArray(definition.required)
    ? new Set(definition.required.filter((r): r is string => typeof r === 'string'))
    : new Set<string>();
  const result: ApiParameter[] = [];
  for (const [propName, propValue] of Object.entries(properties as Record<string, unknown>)) {
    if (propValue === null || typeof propValue !== 'object' || Array.isArray(propValue)) {
      continue;
    }
    const prop = propValue as Record<string, unknown>;
    const propRequired = requiredList.has(propName);
    const propRef =
      prop['$ref'] ??
      (prop.schema !== null && typeof prop.schema === 'object' && !Array.isArray(prop.schema)
        ? (prop.schema as Record<string, unknown>)['$ref']
        : undefined);
    if (typeof propRef === 'string') {
      const childParams = resolveRefChildParams(doc, propRef, propRequired, depth + 1);
      result.push({
        name: propName,
        location: 'body',
        required: propRequired,
        type: 'object',
        ...extractDescription(prop),
        ...(childParams.length > 0 ? { childParams } : {}),
      });
    } else {
      result.push({
        name: propName,
        location: 'body',
        required: propRequired,
        ...(typeof prop.type === 'string' ? { type: prop.type } : {}),
        ...extractDescription(prop),
        ...extractParamSelect(prop, prop.schema as Record<string, unknown> | undefined),
      });
    }
  }
  return result;
}

function extractParamSelect(source: Record<string, unknown>, schema?: Record<string, unknown>): { paramSelect?: string } {
  const enumRaw = source.enum ?? schema?.enum;
  if (Array.isArray(enumRaw) && enumRaw.length > 0) {
    const enumValues = enumRaw.filter((v): v is string => typeof v === 'string');
    if (enumValues.length > 0) {
      return { paramSelect: enumValues.join(',') };
    }
  }
  return {};
}

function resolveDefinition(doc: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  const match = ref.match(/^#\/definitions\/(.+)$/u);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const name = match[1];
  const definitions = doc.definitions;
  if (definitions === null || typeof definitions !== 'object' || Array.isArray(definitions)) {
    return undefined;
  }
  const def = (definitions as Record<string, unknown>)[name];
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    return undefined;
  }
  return def as Record<string, unknown>;
}

function extractDescription(source: Record<string, unknown>): { description?: string } {
  const xParamInfo = source['x-param-info'];
  if (xParamInfo !== null && typeof xParamInfo === 'object' && !Array.isArray(xParamInfo)) {
    const info = xParamInfo as Record<string, unknown>;
    if (typeof info.descriptionForModelCN === 'string') {
      return { description: info.descriptionForModelCN };
    }
    if (typeof info.descriptionForModelEN === 'string') {
      return { description: info.descriptionForModelEN };
    }
  }
  if (typeof source.description === 'string') {
    return { description: source.description };
  }
  return {};
}
// --- HTTP request building ---

function assembleChildParams(param: ApiParameter, params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const child of param.childParams ?? []) {
    const childValue = params[child.name];
    if (childValue !== undefined) {
      result[child.name] = childValue;
    } else if (child.childParams !== undefined && child.childParams.length > 0) {
      const subObj = assembleChildParams(child, params);
      if (Object.keys(subObj).length > 0) {
        result[child.name] = subObj;
      }
    }
  }
  return result;
}

function buildHttpRequestParts(
  apiDoc: ApiDoc,
  params: Record<string, unknown>,
): { readonly path: string; readonly query: string; readonly body?: string | undefined } {
  let path = apiDoc.path;
  const queryParts: string[] = [];
  const bodyObject: Record<string, unknown> = {};

  for (const param of apiDoc.parameters) {
    const value = params[param.name];
    if (value === undefined) {
      // For body params with childParams, the parent key won't be in params
      // because the model sends flat child keys. Don't skip - collect children.
      if (param.location !== 'body' || param.childParams === undefined || param.childParams.length === 0) {
        continue;
      }
    }
    if (param.location === 'path') {
      path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
    } else if (param.location === 'query') {
      queryParts.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(String(value))}`);
    } else if (param.location === 'body') {
      // If param has childParams, value is already a nested object from model extraction.
      // Merge it directly into bodyObject (no outer key wrapper).
      if (param.childParams !== undefined && param.childParams.length > 0) {
        if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(bodyObject, value as Record<string, unknown>);
        } else {
          // Collect child param values from flat mergedParams
          const nestedObj: Record<string, unknown> = {};
          for (const child of param.childParams) {
            const childValue = params[child.name];
            if (childValue !== undefined) {
              // Child value exists directly in params (e.g. ragIndexes is already an array)
              // Use it as-is regardless of whether it has childParams
              nestedObj[child.name] = childValue;
            } else if (child.childParams !== undefined && child.childParams.length > 0) {
              // Child value not in params, but has sub-childParams - try to assemble
              const subObj = assembleChildParams(child, params);
              if (Object.keys(subObj).length > 0) {
                nestedObj[child.name] = subObj;
              }
            }
          }
          if (Object.keys(nestedObj).length > 0) {
            Object.assign(bodyObject, nestedObj);
          }
        }
      } else {
        setNestedValue(bodyObject, param.name, value);
      }
    }
  }

  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  const body = Object.keys(bodyObject).length > 0 ? JSON.stringify(bodyObject) : undefined;

  return { path, query, body };
}

function setNestedValue(target: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split('.');
  if (parts.length === 1) {
    target[parts[0]!] = value;
    return;
  }
  let current = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (current[key] === undefined || current[key] === null || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}
// --- Extraction prompt ---

function buildExtractionPrompt(userQuestion: string, params: readonly ApiParameter[], skillBody: string): string {
  const paramListJson = JSON.stringify(params.map(serializeParamForPrompt), null, 2);

  return [
    'You are a **Batch Multi-Entity Parameter Extraction Agent** specializing in the telecommunications domain. Core capability: identify multiple independent business entities in the context, extract parameters according to a unified parameter template for each entity, output multiple independent JSON parameter objects, and support batch parallel invocation of the same API.',
    '',
    '## Core Rules',
    '1. Strictly extract parameters according to the **mandatory/optional, data type, value range, and format specification** in the [current parameter list]; combine experience knowledge, user question, conversation context, and current node description for judgment; if context/node description is empty, ignore directly.',
    '2. Strict value constraint: only use **explicit original information** in the context or **uniquely derivable conclusions**; guessing, assumptions, fuzzy inference, or default filling of unmentioned content is prohibited.',
    '3. Multi-entity splitting rule: if the context contains **multiple independent target entities** (multiple device IDs, multiple accounts, multiple users, multiple business order numbers, multiple network elements, etc.), the parameters must be split by entity dimension into independent parameter groups; one entity corresponds to one JSON parameter object.',
    '4. Field filling rules:',
    '   - Mandatory parameters: leave empty if no valid explicit information is available;',
    '   - Optional parameters: omit the field if no corresponding information exists; do not fill redundantly;',
    '   - Non-array type parameters: merging or concatenation is prohibited; multiple entities must be separated via outer array splitting.',
    '5. Data compliance: parameter values must strictly match the defined type (string/number/enum, etc.); illegal values or out-of-range values are discarded and not extracted.',
    '',
    '## Input Information',
    '### <Current Parameter List>',
    paramListJson,
    '',
    '## [Experience Knowledge]',
    '',
    '',
    '## [Context]',
    '### Original User Question',
    userQuestion,
    '',
    '### Historical Node Descriptions',
    '',
    '',
    '### Current Node Description',
    skillBody,
    '',
    '## Output Specification',
    '1. Always output a **pure JSON array**; no extra explanation, no markdown, no comments, no extra text;',
    '2. Each JSON object in the array = one complete parameter set for an independent entity; one-to-one correspondence;',
    '3. If no extractable entity or parameter exists, return: `[]`;',
    '4. Single-entity scenario: the array contains only one parameter object; multi-entity scenario: output as many objects as entities for parallel API calls.',
    '',
    '### Standard Output Example',
    '// Single entity',
    '[{"parameterA":"valueA","parameterB":"valueB"}]',
    '',
    '// Multi-entity (supports batch parallel API invocation)',
    '[',
    '    {"parameterA":"valueA1","parameterB":"valueB1"},',
    '    {"parameterA":"valueA2","parameterB":"valueB2"}',
    ']',
  ].join('\n');
}

function serializeParamForPrompt(param: ApiParameter): Record<string, unknown> {
  const result: Record<string, unknown> = {
    parameter_name: param.name,
    parameter_description: param.description ?? '',
    parameter_type: param.type ?? '',
    required_or_optional: param.required ? 'required' : 'optional',
    value_range: param.paramSelect ?? '',
  };
  if (param.childParams !== undefined && param.childParams.length > 0) {
    result.child_parameters = param.childParams.map(serializeParamForPrompt);
  }
  return result;
}
function collectChildValue(param: ApiParameter, source: Record<string, unknown>, target: Record<string, unknown>): void {
  if (param.childParams !== undefined && param.childParams.length > 0) {
    const nested: Record<string, unknown> = {};
    for (const child of param.childParams) {
      collectChildValue(child, source, nested);
    }
    if (Object.keys(nested).length > 0) {
      target[param.name] = nested;
    }
  } else {
    const value = source[param.name];
    if (value !== undefined) {
      target[param.name] = value;
      delete source[param.name];
    }
  }
}

// --- Helpers ---

function failed(
  code: string,
  message: string,
  category: 'AUTHORIZATION' | 'VALIDATION' | 'UNAVAILABLE' | 'CANCELED' | 'INTERNAL',
  metadata: JsonObject = {},
): CapabilityInvocationResult {
  return {
    status: 'FAILED',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category, retryable: false },
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function timedOut(code: string, message: string, metadata: JsonObject): CapabilityInvocationResult {
  return {
    status: 'TIMED_OUT',
    structuredPayload: {},
    generatedMessages: [],
    artifactRefs: [],
    safeError: { code, message, category: 'TIMEOUT', retryable: false },
    metadata,
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}
