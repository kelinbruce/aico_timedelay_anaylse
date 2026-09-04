import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateFileName,
  validateMagicBytes,
  validateZipSlip,
  validateZipBomb,
  validateFileContent,
  isZipFile,
  FILE_NAME_REGEX,
  ZIP_BOMB_MAX_UNCOMPRESSED_SIZE,
} from '../src/file-content-validator.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'fcv-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// Helper: create a minimal valid ZIP file in memory
function createMinimalZip(entries: Array<{ name: string; content: string; uncompressedSize?: number }>): Buffer {
  // For testing zip slip/bomb, we create real ZIP files using the built-in zlib
  // This is a simplified approach — we'll use a proper ZIP builder approach
  const { deflateRawSync } = require('node:zlib');

  const localFiles: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const contentBytes = Buffer.from(entry.content, 'utf-8');
    const compressed = deflateRawSync(contentBytes);
    const nameBytes = Buffer.from(entry.name, 'utf-8');

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression method (0 = stored)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc32 (simplified)
    localHeader.writeUInt32LE(compressed.length, 18); // compressed size
    localHeader.writeUInt32LE(contentBytes.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28); // extra field length

    const localFile = Buffer.concat([localHeader, nameBytes, compressed]);
    localFiles.push(localFile);

    // Central directory entry
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0, 8); // flags
    cdHeader.writeUInt16LE(0, 10); // compression method
    cdHeader.writeUInt16LE(0, 12); // mod time
    cdHeader.writeUInt16LE(0, 14); // mod date
    cdHeader.writeUInt32LE(0, 16); // crc32
    cdHeader.writeUInt32LE(compressed.length, 20); // compressed size
    cdHeader.writeUInt32LE(contentBytes.length, 24); // uncompressed size
    cdHeader.writeUInt16LE(nameBytes.length, 28); // filename length
    cdHeader.writeUInt16LE(0, 30); // extra field length
    cdHeader.writeUInt16LE(0, 32); // comment length
    cdHeader.writeUInt16LE(0, 34); // disk number start
    cdHeader.writeUInt16LE(0, 36); // internal attrs
    cdHeader.writeUInt32LE(0, 38); // external attrs
    cdHeader.writeUInt32LE(offset, 42); // local header offset

    centralDir.push(Buffer.concat([cdHeader, nameBytes]));
    offset += localFile.length;
  }

  const localData = Buffer.concat(localFiles);
  const cdData = Buffer.concat(centralDir);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with CD
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(cdData.length, 12); // CD size
  eocd.writeUInt32LE(localData.length, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localData, cdData, eocd]);
}

// Helper: create a ZIP with fake uncompressed sizes for bomb testing
function createZipWithFakeSizes(entries: Array<{ name: string; uncompressedSize: number }>): Buffer {
  const { deflateRawSync } = require('node:zlib');

  const localFiles: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const contentBytes = Buffer.from('x', 'utf-8');
    const compressed = deflateRawSync(contentBytes);
    const nameBytes = Buffer.from(entry.name, 'utf-8');

    // Local file header with fake uncompressed size
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.uncompressedSize, 22); // fake uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localFile = Buffer.concat([localHeader, nameBytes, compressed]);
    localFiles.push(localFile);

    // Central directory entry with fake uncompressed size
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt16LE(0, 12);
    cdHeader.writeUInt16LE(0, 14);
    cdHeader.writeUInt32LE(0, 16);
    cdHeader.writeUInt32LE(compressed.length, 20);
    cdHeader.writeUInt32LE(entry.uncompressedSize, 24); // fake uncompressed size
    cdHeader.writeUInt16LE(nameBytes.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 34);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0, 38);
    cdHeader.writeUInt32LE(offset, 42);

    centralDir.push(Buffer.concat([cdHeader, nameBytes]));
    offset += localFile.length;
  }

  const localData = Buffer.concat(localFiles);
  const cdData = Buffer.concat(centralDir);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdData.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localData, cdData, eocd]);
}

describe('validateFileName', () => {
  it('accepts valid file names', () => {
    expect(validateFileName('report.xlsx').valid).toBe(true);
    expect(validateFileName('网络故障报告_v2.xlsx').valid).toBe(true);
    expect(validateFileName('data (1).csv').valid).toBe(true);
    expect(validateFileName('test-file.md').valid).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(validateFileName('../../etc/passwd.xlsx').valid).toBe(false);
  });

  it('rejects names longer than 512 characters', () => {
    const longName = 'a'.repeat(510) + '.md';
    expect(validateFileName(longName).valid).toBe(false);
    expect(validateFileName(longName).reasonCode).toBe('FILE_NAME_TOO_LONG');
  });

  it('rejects names without extension', () => {
    expect(validateFileName('report').valid).toBe(false);
    expect(validateFileName('report').reasonCode).toBe('FILE_NAME_NO_EXTENSION');
  });

  it('accepts 512 character names with extension', () => {
    const name = 'a'.repeat(509) + '.md';
    expect(name.length).toBe(512);
    expect(validateFileName(name).valid).toBe(true);
  });
});

describe('validateMagicBytes', () => {
  it('accepts valid xlsx with ZIP magic', () => {
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(validateMagicBytes(zipMagic, 'report.xlsx').valid).toBe(true);
  });

  it('rejects xlsx without ZIP magic', () => {
    const nonZip = Buffer.from([0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0]);
    expect(validateMagicBytes(nonZip, 'report.xlsx').valid).toBe(false);
    expect(validateMagicBytes(nonZip, 'report.xlsx').reasonCode).toBe('MAGIC_BYTES_MISMATCH');
  });

  it('accepts valid PDF', () => {
    const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    expect(validateMagicBytes(pdfMagic, 'doc.pdf').valid).toBe(true);
  });

  it('rejects csv with ZIP magic bytes', () => {
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(validateMagicBytes(zipMagic, 'data.csv').valid).toBe(false);
    expect(validateMagicBytes(zipMagic, 'data.csv').reasonCode).toBe('MAGIC_BYTES_MISMATCH');
  });

  it('accepts csv with readable text', () => {
    const csvBytes = Buffer.from('col1,col2\nval1,val2\n', 'utf-8');
    expect(validateMagicBytes(csvBytes, 'data.csv').valid).toBe(true);
  });

  it('rejects csv with binary content', () => {
    const binaryBytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(validateMagicBytes(binaryBytes, 'data.csv').valid).toBe(false);
  });
});

describe('validateZipSlip', () => {
  it('accepts safe relative paths', async () => {
    const zipData = createMinimalZip([
      { name: 'xl/workbook.xml', content: '<workbook/>' },
      { name: 'xl/sheets/sheet1.xml', content: '<sheet/>' },
    ]);
    const filePath = join(tempDir, 'safe.xlsx');
    await writeFile(filePath, zipData);
    const result = await validateZipSlip(filePath);
    expect(result.valid).toBe(true);
  });

  it('rejects path traversal entries', async () => {
    const zipData = createMinimalZip([{ name: '../../../etc/passwd', content: 'evil' }]);
    const filePath = join(tempDir, 'evil.zip');
    await writeFile(filePath, zipData);
    const result = await validateZipSlip(filePath);
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('ZIP_SLIP_PATH_TRAVERSAL');
  });

  it('rejects absolute path entries', async () => {
    const zipData = createMinimalZip([{ name: '/etc/passwd', content: 'evil' }]);
    const filePath = join(tempDir, 'abs.zip');
    await writeFile(filePath, zipData);
    const result = await validateZipSlip(filePath);
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('ZIP_SLIP_ABSOLUTE_PATH');
  });
});

describe('validateZipBomb', () => {
  it('accepts normal-sized ZIP', async () => {
    const zipData = createMinimalZip([{ name: 'xl/workbook.xml', content: '<workbook/>' }]);
    const filePath = join(tempDir, 'normal.xlsx');
    await writeFile(filePath, zipData);
    const result = await validateZipBomb(filePath);
    expect(result.valid).toBe(true);
  });

  it('rejects ZIP exceeding 512MB uncompressed', async () => {
    // Create a ZIP with fake uncompressed sizes totaling > 512MB
    const fakeSize = 300 * 1024 * 1024; // 300MB per entry, 2 entries = 600MB
    const zipData = createZipWithFakeSizes([
      { name: 'big1.bin', uncompressedSize: fakeSize },
      { name: 'big2.bin', uncompressedSize: fakeSize },
    ]);
    const filePath = join(tempDir, 'bomb.zip');
    await writeFile(filePath, zipData);
    const result = await validateZipBomb(filePath);
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('ZIP_BOMB_SIZE_EXCEEDED');
  });
});

describe('validateFileContent (integration)', () => {
  it('validates a safe xlsx file', async () => {
    const zipData = createMinimalZip([{ name: 'xl/workbook.xml', content: '<workbook/>' }]);
    const filePath = join(tempDir, 'report.xlsx');
    await writeFile(filePath, zipData);
    const result = await validateFileContent(filePath, 'report.xlsx');
    expect(result.valid).toBe(true);
  });

  it('validates a PDF file', async () => {
    const pdfContent = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('%\xe2\xe3\xcf\xd3\n'),
      Buffer.from('xref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\nstartxref\n0\n%%EOF\n'),
    ]);
    const filePath = join(tempDir, 'doc.pdf');
    await writeFile(filePath, pdfContent);
    const result = await validateFileContent(filePath, 'doc.pdf');
    expect(result.valid).toBe(true);
  });

  it('rejects mismatched magic bytes', async () => {
    const nonZip = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const filePath = join(tempDir, 'fake.xlsx');
    await writeFile(filePath, nonZip);
    const result = await validateFileContent(filePath, 'fake.xlsx');
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe('MAGIC_BYTES_MISMATCH');
  });

  it('rejects zip slip in xlsx', async () => {
    const zipData = createMinimalZip([{ name: '../../../etc/passwd', content: 'evil' }]);
    const filePath = join(tempDir, 'evil.xlsx');
    await writeFile(filePath, zipData);
    const result = await validateFileContent(filePath, 'evil.xlsx');
    expect(result.valid).toBe(false);
  });

  it('skips zip checks for non-ZIP files', async () => {
    const csvContent = Buffer.from('col1,col2\nval1,val2\n', 'utf-8');
    const filePath = join(tempDir, 'data.csv');
    await writeFile(filePath, csvContent);
    const result = await validateFileContent(filePath, 'data.csv');
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe('text');
  });
});
