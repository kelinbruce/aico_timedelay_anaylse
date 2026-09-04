import { AgentError } from '@nextagent/agent-common';
import { mimeTypeFromExtension, validateDownloadObjectName } from '@nextagent/agent-channel-web';
import { describe, expect, it } from 'vitest';

describe('validateDownloadObjectName', () => {
  it('accepts valid HOFS object names', () => {
    expect(() => validateDownloadObjectName('aicoservice/answer/sess1/run1/result.xlsx')).not.toThrow();
    expect(() => validateDownloadObjectName('simple.txt')).not.toThrow();
    expect(() => validateDownloadObjectName('a/b/c/d/report.pdf')).not.toThrow();
  });

  it('rejects parent directory traversal', () => {
    expect(() => validateDownloadObjectName('../etc/passwd')).toThrow(AgentError);
    expect(() => validateDownloadObjectName('a/../../etc/passwd')).toThrow(AgentError);
    expect(() => validateDownloadObjectName('a/../b')).toThrow(AgentError);
  });

  it('rejects absolute paths', () => {
    expect(() => validateDownloadObjectName('/etc/passwd')).toThrow(AgentError);
    expect(() => validateDownloadObjectName('/a/b/c.txt')).toThrow(AgentError);
    expect(() => validateDownloadObjectName('\\\\server\\share\\file.txt')).toThrow(AgentError);
  });

  it('rejects Windows drive letter paths', () => {
    expect(() => validateDownloadObjectName('C:\\Users\\file.txt')).toThrow(AgentError);
    expect(() => validateDownloadObjectName('D:/data/report.pdf')).toThrow(AgentError);
  });

  it('rejects null bytes', () => {
    expect(() => validateDownloadObjectName('a/b\0/c.txt')).toThrow(AgentError);
    expect(() => validateDownloadObjectName('file\0.txt')).toThrow(AgentError);
  });

  it('allows filenames with double dots that are not traversal', () => {
    expect(() => validateDownloadObjectName('file..xlsx')).not.toThrow();
    expect(() => validateDownloadObjectName('a..b/result.txt')).not.toThrow();
  });
});

describe('mimeTypeFromExtension', () => {
  it('returns correct MIME types for known extensions', () => {
    expect(mimeTypeFromExtension('result.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(mimeTypeFromExtension('report.pdf')).toBe('application/pdf');
    expect(mimeTypeFromExtension('data.csv')).toBe('text/csv');
    expect(mimeTypeFromExtension('notes.md')).toBe('text/markdown');
    expect(mimeTypeFromExtension('archive.zip')).toBe('application/zip');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(mimeTypeFromExtension('file.unknownext')).toBe('application/octet-stream');
  });

  it('returns octet-stream for files without extension', () => {
    expect(mimeTypeFromExtension('noextension')).toBe('application/octet-stream');
  });

  it('is case-insensitive', () => {
    expect(mimeTypeFromExtension('FILE.PDF')).toBe('application/pdf');
    expect(mimeTypeFromExtension('Data.CSV')).toBe('text/csv');
  });
});
