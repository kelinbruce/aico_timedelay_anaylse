import { createSystemLocalSkillDiscoveryForTesting, defaultSkillDocumentService, localSkillsSystemProvider } from '@nextagent/agent-capability';
import { bindRuntimeLoggerProvider, brand, type RuntimeLoggerProviderBinding } from '@nextagent/agent-common';
import type { CapabilityProviderIdentity } from '@nextagent/agent-contracts/capability';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const provider: CapabilityProviderIdentity = localSkillsSystemProvider;

let loggerBinding: RuntimeLoggerProviderBinding | undefined;
afterEach(() => loggerBinding?.unbind());

/**
 * Coverage for the SKILL.md encoding-handling fix. Discovery
 * (`parseMetadataViewFromFile`) and invocation (`loadCanonicalBodyViewFromFile`)
 * MUST share the same decode primitive: UTF-8 (with or without BOM) is accepted
 * (BOM stripped), UTF-16 LE/BE and GBK are rejected with
 * `SKILL_MD_UNSUPPORTED_ENCODING`, and a UTF-8 BOM file MUST load successfully
 * at invocation (no longer the misleading `SKILL_SOURCE_CHANGED` path).
 */
describe('SKILL.md encoding handling', () => {
  it('accepts a UTF-8 file with BOM and strips the BOM at discovery and invocation', async () => {
    const root = await makeRoot();
    try {
      const manifestFile = await writeBytes(root, 'bom-skill', utf8Bom(validSkill('bom-skill')));
      const parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'bom-skill',
      });
      expect(parsed.outcome).toBe('accepted');
      if (parsed.outcome === 'accepted') {
        // BOM must not leak into the descriptor description (which would start with U+FEFF).
        expect(parsed.descriptor.description.startsWith('﻿')).toBe(false);
        expect(parsed.descriptor.capabilityId).toBe('bom-skill');
      }
      const discoveryHash = parsed.consistency?.frontmatterHash;

      const loaded = await defaultSkillDocumentService.loadCanonicalBodyViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'bom-skill',
      });
      expect('outcome' in loaded).toBe(false);
      if (!('outcome' in loaded)) {
        expect(loaded.body).not.toContain('﻿');
        expect(loaded.frontmatterHash).toBe(discoveryHash);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a GBK-encoded SKILL.md (mixed ASCII frontmatter + GBK body) with SKILL_MD_UNSUPPORTED_ENCODING at discovery', async () => {
    const root = await makeRoot();
    try {
      // ASCII frontmatter delimiter + GBK-encoded Chinese body. The body bytes
      // are not valid UTF-8, so decodeText falls back to GBK and the Skill path
      // rejects it rather than injecting replacement characters into model context.
      const manifestFile = await writeBytes(
        root,
        'gbk-mixed-skill',
        Buffer.concat([Buffer.from(validSkillAsciiFrontmatter('gbk-mixed-skill'), 'ascii'), gbkChineseBody()]),
      );
      const parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'gbk-mixed-skill',
      });
      expect(parsed.outcome).toBe('rejected');
      expect(parsed.diagnostics[0]?.reasonCode).toBe('SKILL_MD_UNSUPPORTED_ENCODING');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a pure-Chinese GBK SKILL.md with SKILL_MD_UNSUPPORTED_ENCODING', async () => {
    const root = await makeRoot();
    try {
      // Entirely GBK-encoded: even the name field is Chinese, so fatal UTF-8
      // decode fails and decodeText falls back to GBK. The Skill path rejects it.
      const manifestFile = await writeBytes(root, 'gbk-only-chinese-skill', gbkPureChineseSkill());
      const parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'gbk-only-chinese-skill',
      });
      expect(parsed.outcome).toBe('rejected');
      expect(parsed.diagnostics[0]?.reasonCode).toBe('SKILL_MD_UNSUPPORTED_ENCODING');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a UTF-16 BE SKILL.md with SKILL_MD_UNSUPPORTED_ENCODING', async () => {
    const root = await makeRoot();
    try {
      const manifestFile = await writeBytes(root, 'utf16be-skill', utf16Be(validSkill('utf16be-skill')));
      const parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'utf16be-skill',
      });
      expect(parsed.outcome).toBe('rejected');
      expect(parsed.diagnostics[0]?.reasonCode).toBe('SKILL_MD_UNSUPPORTED_ENCODING');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a UTF-16 LE SKILL.md with SKILL_MD_UNSUPPORTED_ENCODING', async () => {
    const root = await makeRoot();
    try {
      const manifestFile = await writeBytes(root, 'utf16le-skill', utf16Le(validSkill('utf16le-skill')));
      const parsed = await defaultSkillDocumentService.parseMetadataViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'utf16le-skill',
      });
      expect(parsed.outcome).toBe('rejected');
      expect(parsed.diagnostics[0]?.reasonCode).toBe('SKILL_MD_UNSUPPORTED_ENCODING');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps discovery and invocation frontmatter hashes consistent for a UTF-8 BOM file', async () => {
    // Direct evidence that discovery and invocation share the same format
    // semantics: the hash computed over the BOM-stripped frontmatter is the
    // same on both paths. The discovery fact stores the hash; the document
    // service load (which retains frontmatterHash on the view) must match it.
    const root = await makeRoot();
    try {
      const manifestFile = await writeBytes(root, 'hash-skill', utf8Bom(validSkill('hash-skill')));
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      await discovery.listAll(new AbortController().signal);
      const fact = discovery.getInternalLoadingFact(brand<string, 'CapabilityId'>('hash-skill'));
      expect(fact).toBeDefined();

      const loaded = await defaultSkillDocumentService.loadCanonicalBodyViewFromFile({
        manifestFile,
        provider,
        safeCandidateName: 'hash-skill',
      });
      expect('outcome' in loaded).toBe(false);
      if (!('outcome' in loaded)) {
        expect(loaded.frontmatterHash).toBe(fact?.frontmatterHash);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not register an unsupported-encoding skill in the catalog', async () => {
    // The end-to-end effect: a UTF-16 skill is skipped at discovery and never
    // appears in the catalog, so it cannot be invoked.
    const root = await makeRoot();
    try {
      await writeBytes(root, 'utf16-catalog-skill', utf16Le(validSkill('utf16-catalog-skill')));
      const discovery = createSystemLocalSkillDiscoveryForTesting({ systemSkillsRoot: root });
      const descriptors = await discovery.listAll(new AbortController().signal);
      expect(descriptors).toEqual([]);
      expect(discovery.getReadinessEvidence()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcomeCode: 'LOCAL_SKILL_MANIFEST_INVALID',
            skillId: 'utf16-catalog-skill',
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function validSkill(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n# ${name}\nUse this skill to test encoding handling.\n`;
}

/** Frontmatter-only, ASCII-safe body marker so GBK bytes can be appended after it. */
function validSkillAsciiFrontmatter(name: string): string {
  return `---\nname: ${name}\ndescription: Test telecom Skill.\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n`;
}

function utf8Bom(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

function utf16Le(text: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function utf16Be(text: string): Buffer {
  const littleEndian = Buffer.from(text, 'utf16le');
  const bigEndian = Buffer.allocUnsafe(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1]!;
    bigEndian[index + 1] = littleEndian[index]!;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]);
}

/**
 * GBK-encoded Chinese body: "列出目录文件并用中文解释。" Node has no built-in
 * GBK encoder, so the bytes are the known CP936/GBK byte sequence for that
 * string. Falls back to a TextEncoder round-trip only if the iconv-less host
 * cannot produce them; in practice the literal byte array below is stable.
 */
function gbkChineseBody(): Buffer {
  // "列出目录文件并用中文解释。" in GBK (CP936)
  const gbkBytes = [
    0xc1, 0xd0, 0xb3, 0xf6, 0xc4, 0xbf, 0xc2, 0xbc, 0xce, 0xc4, 0xbc, 0xfe, 0xb2, 0xa2, 0xd3, 0xc3, 0xd6, 0xd0, 0xce, 0xc4, 0xbd, 0xe2, 0xca, 0xcd,
    0xa1, 0xa3,
  ];
  return Buffer.from(gbkBytes);
}

/**
 * A SKILL.md whose frontmatter values are Chinese, GBK-encoded. The structural
 * bytes (`---`, `name: `, newlines) are ASCII and thus byte-identical in GBK;
 * only the `name` and `description` values carry GBK Chinese bytes, which are
 * not valid UTF-8. `decodeText` therefore fails fatal UTF-8 decode, falls back
 * to GBK, and returns `encoding: 'GBK'` — which the Skill path rejects.
 */
function gbkPureChineseSkill(): Buffer {
  const name = Buffer.from([0xb2, 0xe2, 0xca, 0xd4]); // 测试
  const description = Buffer.from([0xb2, 0xe2, 0xca, 0xd4, 0xd6, 0xd0, 0xce, 0xc4, 0xbc, 0xbc, 0xc4, 0xdc]); // 测试中文技能
  const tail = Buffer.from('\ncontext: inline\nuser-invocable: true\nmodel-invocable: true\n---\n', 'ascii');
  return Buffer.concat([Buffer.from('---\nname: ', 'ascii'), name, Buffer.from('\ndescription: ', 'ascii'), description, tail]);
}

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'nextagent-skill-encoding-'));
}

async function writeBytes(root: string, name: string, bytes: Buffer): Promise<string> {
  await mkdir(join(root, name), { recursive: true });
  const manifestFile = join(root, name, 'SKILL.md');
  await writeFile(manifestFile, bytes);
  return manifestFile;
}
