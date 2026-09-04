export type PromptShapingDiagnosticEvent =
  | 'templateResolved'
  | 'templateRejected'
  | 'templateResolutionFailed'
  | 'ambiguousProfileResolution'
  | 'loaderChainFallback'
  | 'sectionOmitted'
  | 'fragmentRenderFailed'
  | 'tokenEstimationCompleted'
  | 'toolPairingRejected'
  | 'renderStarted'
  | 'renderCompleted';

export interface SectionDiagnostic {
  readonly sectionId: string;
  readonly reason: string;
}

export interface PromptShapingDiagnostic {
  readonly event: PromptShapingDiagnosticEvent;
  readonly profileRef?: string;
  readonly selectedTemplateRef?: string;
  readonly section?: SectionDiagnostic;
  readonly safeReason?: string;
}

export interface PromptShapingDiagnosticsSink {
  record: (diagnostic: PromptShapingDiagnostic) => void;
}

export class InMemoryPromptShapingDiagnosticsSink implements PromptShapingDiagnosticsSink {
  readonly diagnostics: PromptShapingDiagnostic[] = [];

  record(diagnostic: PromptShapingDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }
}
