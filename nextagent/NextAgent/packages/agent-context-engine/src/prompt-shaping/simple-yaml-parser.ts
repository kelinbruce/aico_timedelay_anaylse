/**
 * Simple YAML parser for template manifests.
 *
 * This parser handles a subset of YAML syntax sufficient for
 * template manifest files. It is not a full YAML implementation.
 *
 * Supported syntax:
 * - Top-level scalar keys (templateName, templateRef)
 * - Lists of objects with id, content, file properties
 * - Quoted and unquoted scalar values
 * - Comments (lines starting with #)
 */

export interface ParsedTemplateManifest {
  readonly templateName: string;
  readonly templateRef: string;
  readonly stableSections: readonly ParsedTemplateSection[];
  readonly dynamicSections: readonly ParsedTemplateSection[];
}

export interface ParsedTemplateSection {
  readonly id: string;
  readonly content?: string;
  readonly file?: string;
}

/**
 * Parse a simple YAML template manifest.
 *
 * @param text - The YAML content to parse
 * @param fallbackTemplateName - Default template name if not specified in YAML
 * @returns Parsed template manifest
 */
export function parseSimpleYamlTemplate(text: string, fallbackTemplateName: string): ParsedTemplateManifest {
  const parser = new SimpleYamlParser(fallbackTemplateName);
  return parser.parse(text);
}

/**
 * Normalize a partial parsed template, filling in missing fields
 * with fallback values.
 */
export function normalizeParsedTemplate(input: Partial<ParsedTemplateManifest>, fallbackTemplateName: string): ParsedTemplateManifest {
  return {
    templateName: input.templateName ?? fallbackTemplateName,
    templateRef: input.templateRef ?? input.templateName ?? fallbackTemplateName,
    stableSections: input.stableSections ?? [],
    dynamicSections: input.dynamicSections ?? [],
  };
}

/**
 * Remove surrounding quotes from a YAML scalar value.
 */
export function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Internal parser class that maintains state during parsing.
 */
class SimpleYamlParser {
  private result: {
    templateName?: string;
    templateRef?: string;
    stableSections: ParsedTemplateSection[];
    dynamicSections: ParsedTemplateSection[];
  } = {
    stableSections: [],
    dynamicSections: [],
  };

  private currentList?: 'stableSections' | 'dynamicSections';
  private currentSection?: { id?: string; content?: string; file?: string };

  constructor(private readonly fallbackTemplateName: string) {}

  parse(text: string): ParsedTemplateManifest {
    const lines = text.split(/\r?\n/u);

    for (const raw of lines) {
      const line = raw.trimEnd();
      this.processLine(line);
    }

    return normalizeParsedTemplate(this.result, this.fallbackTemplateName);
  }

  private processLine(line: string): void {
    if (this.isEmptyOrComment(line)) {
      return;
    }
    if (this.tryParseTopLevelKey(line)) {
      return;
    }
    if (this.tryParseListItem(line)) {
      return;
    }
    if (this.tryParseProperty(line)) {
      return;
    }
  }

  private isEmptyOrComment(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.length === 0 || trimmed.startsWith('#');
  }

  private tryParseTopLevelKey(line: string): boolean {
    if (line.startsWith(' ')) {
      return false;
    }

    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (!match) {
      return false;
    }

    const key = match[1]!;
    const value = unquoteYamlScalar(match[2] ?? '');

    if (key === 'templateName') {
      this.result.templateName = value;
    } else if (key === 'templateRef') {
      this.result.templateRef = value;
    } else if (key === 'stableSections' || key === 'dynamicSections') {
      this.currentList = key;
    }

    return true;
  }

  private tryParseListItem(line: string): boolean {
    const match = /^\s*-\s+id:\s*(.+)$/u.exec(line);
    if (!match || this.currentList === undefined) {
      return false;
    }

    this.currentSection = { id: unquoteYamlScalar(match[1]!) };
    this.result[this.currentList].push(this.currentSection as ParsedTemplateSection);

    return true;
  }

  private tryParseProperty(line: string): boolean {
    const match = /^\s+([A-Za-z][A-Za-z0-9]*):\s*(.*)$/u.exec(line);
    if (!match || this.currentSection === undefined) {
      return false;
    }

    const key = match[1]!;
    const value = unquoteYamlScalar(match[2] ?? '');

    if (key === 'content') {
      this.currentSection.content = value;
    } else if (key === 'file') {
      this.currentSection.file = value;
    }

    return true;
  }
}
