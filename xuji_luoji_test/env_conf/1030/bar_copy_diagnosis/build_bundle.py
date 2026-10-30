#!/usr/bin/env python3
"""Build a source-only, reproducible ZIP; never includes captured logs/results."""
import hashlib
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
FILES = [
    'bar_copy_diag.py', 'common.py', 'guest_probe.py', 'query_copy_capability.py',
    'test_bar_copy_diag.py', 'build_bundle.py', '执行说明.md', 'SOURCE_MANIFEST.json',
    'performance/run.py', 'performance/bench.py', 'performance/probe.c',
    'performance/placements.json',
]


def main():
    hashes = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in FILES}
    (HERE / 'SHA256SUMS').write_text(''.join('%s  %s\n' % (hashes[n], n) for n in FILES))
    archive = HERE.parent / 'bar_copy_diagnosis_1030.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name in FILES + ['SHA256SUMS']:
            member = zipfile.ZipInfo('bar_copy_diagnosis/' + name, (2026, 10, 30, 0, 0, 0))
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o100644 << 16
            output.writestr(member, (HERE / name).read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(digest + '  ' + archive.name + '\n')
    print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size,
                      'sha256': digest, 'members': len(FILES) + 1}, ensure_ascii=False))


if __name__ == '__main__':
    main()
