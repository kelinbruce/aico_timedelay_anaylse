import { open } from 'node:fs/promises';

// =============================================================================
// File name validation (D6)
// =============================================================================

export const FILE_NAME_REGEX = /^(?=.{1,512}$)[a-zA-Z0-9&\u3010\u3011\uff08\uff09()\s_\-\.\u4e00-\u9fa5+\[\]]+\.\w+$/;

export type FileNameValidationCode = 'FILE_NAME_INVALID' | 'FILE_NAME_TOO_LONG' | 'FILE_NAME_NO_EXTENSION';

export interface FileNameValidationResult {
  readonly valid: boolean;
  readonly reasonCode?: FileNameValidationCode;
}

export function validateFileName(fileName: string): FileNameValidationResult {
  if (fileName.length > 512) {
    return { valid: false, reasonCode: 'FILE_NAME_TOO_LONG' };
  }
  if (!FILE_NAME_REGEX.test(fileName)) {
    if (!fileName.includes('.')) {
      return { valid: false, reasonCode: 'FILE_NAME_NO_EXTENSION' };
    }
    return { valid: false, reasonCode: 'FILE_NAME_INVALID' };
  }
  return { valid: true };
}

// =============================================================================
// Magic bytes cross-validation (D6a)
// =============================================================================

export type MagicBytesValidationCode = 'MAGIC_BYTES_MISMATCH' | 'MAGIC_BYTES_UNREADABLE';

export interface MagicBytesValidationResult {
  readonly valid: boolean;
  readonly reasonCode?: MagicBytesValidationCode;
  readonly detectedFormat?: string;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }
  return prefix.every((value, index) => bytes[index] === value);
}

function isZipMagic(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_MAGIC);
}

function isPdfMagic(bytes: Uint8Array): boolean {
  return startsWith(bytes, PDF_MAGIC);
}

function isReadableText(bytes: Uint8Array): boolean {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    const text = decoder.decode(bytes.slice(0, Math.min(bytes.length, 4096)));
    return !text.includes('\u0000');
  } catch {
    return false;
  }
}

export function extractExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  const index = lower.lastIndexOf('.');
  return index < 0 ? '' : lower.slice(index);
}

const ZIP_EXTENSIONS = new Set(['.xlsx', '.docx', '.pptx', '.zip', '.jar', '.apk', '.odt', '.ods', '.odp']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const TEXT_EXTENSIONS = new Set(['.csv', '.md', '.txt', '.json', '.xml', '.tsv', '.log']);

export function validateMagicBytes(bytes: Uint8Array, fileName: string): MagicBytesValidationResult {
  const ext = extractExtension(fileName);
  const isZipExt = ZIP_EXTENSIONS.has(ext);
  const isPdfExt = PDF_EXTENSIONS.has(ext);
  const isTextExt = TEXT_EXTENSIONS.has(ext);

  if (isZipExt) {
    if (!isZipMagic(bytes)) {
      return { valid: false, reasonCode: 'MAGIC_BYTES_MISMATCH', detectedFormat: 'non-zip' };
    }
    return { valid: true, detectedFormat: 'zip' };
  }

  if (isPdfExt) {
    if (!isPdfMagic(bytes)) {
      return { valid: false, reasonCode: 'MAGIC_BYTES_MISMATCH', detectedFormat: 'non-pdf' };
    }
    return { valid: true, detectedFormat: 'pdf' };
  }

  if (isTextExt) {
    if (isZipMagic(bytes) || isPdfMagic(bytes)) {
      return { valid: false, reasonCode: 'MAGIC_BYTES_MISMATCH', detectedFormat: 'binary' };
    }
    if (!isReadableText(bytes)) {
      return { valid: false, reasonCode: 'MAGIC_BYTES_MISMATCH', detectedFormat: 'binary' };
    }
    return { valid: true, detectedFormat: 'text' };
  }

  // Unknown extension: allow but check for obvious binary magic
  if (isZipMagic(bytes) || isPdfMagic(bytes)) {
    // If the file has binary magic but unknown extension, it's suspicious
    // but we don't reject it since we can't determine expected type
    return { valid: true, detectedFormat: isZipMagic(bytes) ? 'zip' : 'pdf' };
  }

  return { valid: true, detectedFormat: 'unknown' };
}

// =============================================================================
// Zip Slip protection (D25) — must run before zip bomb check
// =============================================================================

export type ZipSlipValidationCode = 'ZIP_SLIP_PATH_TRAVERSAL' | 'ZIP_SLIP_ABSOLUTE_PATH';

export interface ZipSlipValidationResult {
  readonly valid: boolean;
  readonly reasonCode?: ZipSlipValidationCode;
  readonly offendingEntry?: string;
}

interface ZipCentralDirEntry {
  readonly fileName: string;
  readonly uncompressedSize: number;
}

// Minimum size for a ZIP Central Directory entry (30 bytes local header + 46 bytes central dir)
// We read the Central Directory by scanning from the End of Central Directory Record (EOCD)
const EOCD_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];
const CD_SIGNATURE = [0x50, 0x4b, 0x01, 0x02];
const MAX_EOCD_SEARCH = 65557; // 64KB + 57 bytes (max comment size + EOCD size)
const MIN_EOCD_SIZE = 22;

async function readZipCentralDirectory(filePath: string): Promise<ZipCentralDirEntry[]> {
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const fileSize = stat.size;

    if (fileSize < MIN_EOCD_SIZE) {
      return [];
    }

    // Search for EOCD signature from the end of the file
    const searchSize = Math.min(fileSize, MAX_EOCD_SEARCH);
    const eocdBuffer = Buffer.alloc(searchSize);
    await handle.read(eocdBuffer, 0, searchSize, fileSize - searchSize);

    let eocdOffset = -1;
    for (let i = eocdBuffer.length - MIN_EOCD_SIZE; i >= 0; i--) {
      if (
        eocdBuffer[i] === EOCD_SIGNATURE[0] &&
        eocdBuffer[i + 1] === EOCD_SIGNATURE[1] &&
        eocdBuffer[i + 2] === EOCD_SIGNATURE[2] &&
        eocdBuffer[i + 3] === EOCD_SIGNATURE[3]
      ) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      return [];
    }

    const cdOffset = eocdBuffer.readUInt32LE(eocdOffset + 16);
    const cdSize = eocdBuffer.readUInt32LE(eocdOffset + 12);
    const cdEntries = eocdBuffer.readUInt16LE(eocdOffset + 10);

    if (cdEntries === 0 || cdSize === 0) {
      return [];
    }

    const cdBuffer = Buffer.alloc(cdSize);
    await handle.read(cdBuffer, 0, cdSize, cdOffset);

    const entries: ZipCentralDirEntry[] = [];
    let pos = 0;
    for (let i = 0; i < cdEntries && pos < cdBuffer.length; i++) {
      if (
        cdBuffer[pos] !== CD_SIGNATURE[0] ||
        cdBuffer[pos + 1] !== CD_SIGNATURE[1] ||
        cdBuffer[pos + 2] !== CD_SIGNATURE[2] ||
        cdBuffer[pos + 3] !== CD_SIGNATURE[3]
      ) {
        break;
      }

      const uncompressedSize = cdBuffer.readUInt32LE(pos + 24);
      const fileNameLength = cdBuffer.readUInt16LE(pos + 28);
      const extraFieldLength = cdBuffer.readUInt16LE(pos + 30);
      const commentLength = cdBuffer.readUInt16LE(pos + 32);

      const fileName = cdBuffer.toString('utf-8', pos + 46, pos + 46 + fileNameLength);
      entries.push({ fileName, uncompressedSize });

      pos += 46 + fileNameLength + extraFieldLength + commentLength;
    }

    return entries;
  } finally {
    await handle.close();
  }
}

export async function validateZipSlip(filePath: string): Promise<ZipSlipValidationResult> {
  const entries = await readZipCentralDirectory(filePath).catch(() => [] as ZipCentralDirEntry[]);

  for (const entry of entries) {
    // Check for path traversal
    if (entry.fileName.includes('../')) {
      return { valid: false, reasonCode: 'ZIP_SLIP_PATH_TRAVERSAL', offendingEntry: entry.fileName };
    }
    // Check for absolute paths
    if (entry.fileName.startsWith('/')) {
      return { valid: false, reasonCode: 'ZIP_SLIP_ABSOLUTE_PATH', offendingEntry: entry.fileName };
    }
    // Check for backslash-based traversal on Windows-style paths
    if (entry.fileName.includes('..\\')) {
      return { valid: false, reasonCode: 'ZIP_SLIP_PATH_TRAVERSAL', offendingEntry: entry.fileName };
    }
  }

  return { valid: true };
}

// =============================================================================
// Zip bomb protection (D6b)
// =============================================================================

export const ZIP_BOMB_MAX_UNCOMPRESSED_SIZE = 512 * 1024 * 1024; // 512 MB

export type ZipBombValidationCode = 'ZIP_BOMB_SIZE_EXCEEDED';

export interface ZipBombValidationResult {
  readonly valid: boolean;
  readonly reasonCode?: ZipBombValidationCode;
  readonly totalUncompressedSize?: number;
}

export async function validateZipBomb(filePath: string): Promise<ZipBombValidationResult> {
  const entries = await readZipCentralDirectory(filePath).catch(() => [] as ZipCentralDirEntry[]);

  let totalUncompressed = 0;
  for (const entry of entries) {
    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > ZIP_BOMB_MAX_UNCOMPRESSED_SIZE) {
      return {
        valid: false,
        reasonCode: 'ZIP_BOMB_SIZE_EXCEEDED',
        totalUncompressedSize: totalUncompressed,
      };
    }
  }

  return { valid: true, totalUncompressedSize: totalUncompressed };
}

// =============================================================================
// Combined file content validation
// =============================================================================

export type FileContentValidationCode = FileNameValidationCode | MagicBytesValidationCode | ZipSlipValidationCode | ZipBombValidationCode;

export interface FileContentValidationResult {
  readonly valid: boolean;
  readonly reasonCode?: FileContentValidationCode;
  readonly detectedFormat?: string;
  readonly totalUncompressedSize?: number;
  readonly offendingEntry?: string;
}

/**
 * Validates a file for security concerns.
 * This function reads the file from disk to perform magic bytes, zip slip, and zip bomb checks.
 * Only ZIP-based files (detected via magic bytes) undergo zip slip and zip bomb checks.
 */
export async function validateFileContent(filePath: string, fileName: string): Promise<FileContentValidationResult> {
  // 1. File name validation
  const nameResult = validateFileName(fileName);
  if (!nameResult.valid) {
    return { valid: false, ...(nameResult.reasonCode === undefined ? {} : { reasonCode: nameResult.reasonCode }) };
  }

  // 2. Read magic bytes (first 8 bytes)
  const handle = await open(filePath, 'r');
  let magicBytes: Buffer;
  try {
    magicBytes = Buffer.alloc(8);
    const { bytesRead } = await handle.read(magicBytes, 0, 8, 0);
    magicBytes = magicBytes.slice(0, bytesRead);
  } finally {
    await handle.close();
  }

  // 3. Magic bytes cross-validation
  const magicResult = validateMagicBytes(magicBytes, fileName);
  if (!magicResult.valid) {
    return {
      valid: false,
      ...(magicResult.reasonCode === undefined ? {} : { reasonCode: magicResult.reasonCode }),
      ...(magicResult.detectedFormat === undefined ? {} : { detectedFormat: magicResult.detectedFormat }),
    };
  }

  // 4. For ZIP-based files, run zip slip + zip bomb checks
  if (magicResult.detectedFormat === 'zip') {
    // 4a. Zip Slip (must run before zip bomb)
    const slipResult = await validateZipSlip(filePath);
    if (!slipResult.valid) {
      return {
        valid: false,
        ...(slipResult.reasonCode === undefined ? {} : { reasonCode: slipResult.reasonCode }),
        ...(slipResult.offendingEntry === undefined ? {} : { offendingEntry: slipResult.offendingEntry }),
      };
    }

    // 4b. Zip bomb
    const bombResult = await validateZipBomb(filePath);
    if (!bombResult.valid) {
      return {
        valid: false,
        ...(bombResult.reasonCode === undefined ? {} : { reasonCode: bombResult.reasonCode }),
        ...(bombResult.totalUncompressedSize === undefined ? {} : { totalUncompressedSize: bombResult.totalUncompressedSize }),
      };
    }

    return {
      valid: true,
      ...(magicResult.detectedFormat === undefined ? {} : { detectedFormat: magicResult.detectedFormat }),
      ...(bombResult.totalUncompressedSize === undefined ? {} : { totalUncompressedSize: bombResult.totalUncompressedSize }),
    };
  }

  return {
    valid: true,
    ...(magicResult.detectedFormat === undefined ? {} : { detectedFormat: magicResult.detectedFormat }),
  };
}

/**
 * Check if a file is ZIP-based by reading its magic bytes from disk.
 */
export async function isZipFile(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buf, 0, 4, 0);
    return bytesRead >= 4 && startsWith(buf, ZIP_MAGIC);
  } finally {
    await handle.close();
  }
}

// Re-export for path traversal protection (D30)
