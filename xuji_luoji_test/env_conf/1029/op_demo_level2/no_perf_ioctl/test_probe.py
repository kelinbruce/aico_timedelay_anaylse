"""Native interception tests; no NPU required. Supports local macOS C validation."""
import ctypes
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import termios
import unittest


class Event(ctypes.Structure):
    _fields_ = [('request', ctypes.c_uint64), ('start_ns', ctypes.c_uint64),
                ('duration_ns', ctypes.c_uint64), ('caller_pc', ctypes.c_uint64),
                ('fd', ctypes.c_int32), ('result', ctypes.c_int32),
                ('batch', ctypes.c_uint32), ('reserved', ctypes.c_uint32)]


class ProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = next((shutil.which(x) for x in ('cc', 'gcc', 'clang') if shutil.which(x)), None)
        if not compiler:
            raise unittest.SkipTest('Native C compiler unavailable')
        cls.temp = tempfile.TemporaryDirectory(prefix='ioctl_probe_test_')
        library = Path(cls.temp.name) / 'probe.so'
        flags = ['-dynamiclib'] if platform.system() == 'Darwin' else ['-shared', '-ldl']
        subprocess.run([compiler, '-O2', '-fPIC', '-Wall', '-Wextra', '-Werror',
                        str(Path(__file__).with_name('probe.c')), *flags, '-o', str(library)], check=True)
        cls.lib = ctypes.CDLL(str(library), use_errno=True)
        cls.lib.probe_count.restype = ctypes.c_size_t
        cls.lib.probe_event_size.restype = ctypes.c_size_t
        cls.lib.probe_events.restype = ctypes.POINTER(Event)
        cls.lib.ioctl.restype = ctypes.c_int
        # ioctl is variadic. In particular Darwin/arm64 passes variadic args
        # differently from fixed parameters; only the fixed prefix is declared.
        cls.lib.ioctl.argtypes = [ctypes.c_int, ctypes.c_ulong]
        assert cls.lib.probe_ready() == 1

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.lib.probe_reset()

    def test_layout(self):
        self.assertEqual(self.lib.probe_event_size(), ctypes.sizeof(Event))

    def test_disabled_is_not_recorded(self):
        self.assertEqual(self.lib.ioctl(-1, 0, None), -1)
        self.assertEqual(self.lib.probe_count(), 0)

    def test_error_and_errno_preserved(self):
        import errno
        self.lib.probe_begin(7)
        ctypes.set_errno(0)
        self.assertEqual(self.lib.ioctl(-1, 0, None), -1)
        self.assertEqual(ctypes.get_errno(), errno.EBADF)
        self.lib.probe_end()
        self.assertEqual(self.lib.probe_count(), 1)
        event = self.lib.probe_events()[0]
        self.assertEqual((event.fd, event.result, event.batch), (-1, -1, 7))
        self.assertGreater(event.start_ns, 0)

    def test_real_output_argument_and_capture_gate(self):
        source, target = os.pipe()
        try:
            os.write(target, b'hello')
            length = ctypes.c_int(0)
            self.lib.probe_begin(12)
            result = self.lib.ioctl(source, termios.FIONREAD, ctypes.byref(length))
            self.lib.probe_end()
            self.assertEqual(result, 0)
            self.assertEqual(length.value, 5)
            self.assertEqual(self.lib.probe_events()[0].request, termios.FIONREAD)
            self.lib.ioctl(source, termios.FIONREAD, ctypes.byref(length))
            self.assertEqual(self.lib.probe_count(), 1)
        finally:
            os.close(source)
            os.close(target)

    def test_other_thread_not_recorded(self):
        import threading
        self.lib.probe_begin(0)
        thread = threading.Thread(target=lambda: self.lib.ioctl(-1, 0, None))
        thread.start()
        thread.join()
        self.lib.probe_end()
        self.assertEqual(self.lib.probe_count(), 0)


if __name__ == '__main__':
    unittest.main()
