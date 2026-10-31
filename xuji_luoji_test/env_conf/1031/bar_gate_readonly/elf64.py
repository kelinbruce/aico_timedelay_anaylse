"""Small, bounded ELF64 little-endian parser. No dependencies or memory writes."""
import struct


class EvidenceError(RuntimeError):
    pass


def elf_header(data, expected_type):
    if len(data) != 64 or data[:7] != b'\x7fELF\x02\x01\x01':
        raise EvidenceError('Expected ELF64 little-endian header')
    h = struct.unpack('<16sHHIQQQIHHHHHH', data)
    if h[1] != expected_type or h[2] != 183 or h[3] != 1 or h[8] != 64:
        raise EvidenceError('Expected AArch64 ELF type %s' % expected_type)
    return h


def note_build_id(data):
    pos = 0
    while pos + 12 <= len(data):
        ns, ds, kind = struct.unpack_from('<III', data, pos)
        pos += 12
        if ns > 4096 or ds > 4096 or pos + ns > len(data):
            raise EvidenceError('Invalid ELF note')
        name = data[pos:pos + ns].rstrip(b'\0')
        pos += (ns + 3) & ~3
        if pos + ds > len(data):
            raise EvidenceError('Truncated ELF note')
        value = data[pos:pos + ds]
        pos += (ds + 3) & ~3
        if name == b'GNU' and kind == 3:
            return value.hex()
    raise EvidenceError('GNU build ID is absent')


class ModuleELF:
    def __init__(self, data):
        self.data = data
        self.header = h = elf_header(data[:64], 1)
        if h[11] != 64 or not 0 < h[12] < 65535 or h[13] >= h[12]:
            raise EvidenceError('Unsupported section table')
        self.sections = []
        for i in range(h[12]):
            raw = self.slice(h[6] + 64 * i, 64)
            v = struct.unpack('<IIQQQQIIQQ', raw)
            self.sections.append(dict(zip(
                ('name_offset', 'type', 'flags', 'address', 'offset', 'size',
                 'link', 'info', 'align', 'entry_size'), v)))
        names = self.section_bytes(self.sections[h[13]])
        for sec in self.sections:
            sec['name'] = self.string(names, sec['name_offset'])

    def slice(self, offset, size):
        if offset < 0 or size < 0 or offset + size > len(self.data):
            raise EvidenceError('ELF range outside file')
        return self.data[offset:offset + size]

    @staticmethod
    def string(data, offset):
        if not 0 <= offset < len(data):
            raise EvidenceError('Invalid ELF string offset')
        end = data.find(b'\0', offset)
        if end < 0:
            raise EvidenceError('Unterminated ELF string')
        return data[offset:end].decode('utf-8', errors='strict')

    def section_bytes(self, section):
        return self.slice(section['offset'], section['size'])

    def section(self, name):
        found = [s for s in self.sections if s['name'] == name]
        if len(found) != 1:
            raise EvidenceError('Section missing/ambiguous: ' + name)
        return found[0]

    def modinfo(self):
        info = self.section_bytes(self.section('.modinfo')).split(b'\0')
        result = {}
        for item in info:
            if b'=' in item:
                k, v = item.split(b'=', 1)
                result.setdefault(k.decode(), []).append(v.decode())
        return result

    def build_id(self):
        return note_build_id(self.section_bytes(self.section('.note.gnu.build-id')))

    def object_symbols(self):
        symbols = []
        for table in self.sections:
            if table['type'] != 2:
                continue
            if table['entry_size'] != 24 or table['link'] >= len(self.sections):
                raise EvidenceError('Invalid symbol table')
            names = self.section_bytes(self.sections[table['link']])
            data = self.section_bytes(table)
            if len(data) % 24:
                raise EvidenceError('Truncated symbol table')
            for pos in range(0, len(data), 24):
                no, info, other, si, value, size = struct.unpack_from('<IBBHQQ', data, pos)
                if info & 15 != 1 or not 0 < si < len(self.sections):
                    continue
                sec = self.sections[si]
                if not sec['flags'] & 2 or sec['flags'] & 4:
                    continue
                if value + size > sec['size']:
                    raise EvidenceError('Object outside section')
                symbols.append({'name': self.string(names, no), 'section': sec['name'],
                                'offset': value, 'size': size})
        return symbols
