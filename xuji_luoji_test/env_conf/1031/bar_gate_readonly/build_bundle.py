"""Build a small reproducible field bundle, excluding results and kernel modules."""
import hashlib
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ('README.md', 'collect.py', 'elf64.py', 'profile_25_5.json',
         'test_collect.py', 'build_profile.py', 'build_bundle.py')


def build():
    lines = ['%s  %s' % (hashlib.sha256((HERE / name).read_bytes()).hexdigest(), name)
             for name in FILES]
    (HERE / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
    target = HERE.parent / 'bar_gate_readonly_1031.zip'
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name in (*FILES, 'SHA256SUMS'):
            info = zipfile.ZipInfo('bar_gate_readonly/' + name, (2026, 10, 31, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, (HERE / name).read_bytes())
    sha = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text('%s  %s\n' % (sha, target.name))
    print(target)
    print(sha)


if __name__ == '__main__':
    build()
