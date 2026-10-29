import ctypes
import unittest
from query_copy_capability import SupportFeaturePara, decode, query


class CapabilityTests(unittest.TestCase):
    def test_public_64bit_layout(self):
        self.assertEqual(ctypes.sizeof(SupportFeaturePara), 16)
        self.assertEqual(SupportFeaturePara.devid.offset, 8)

    def test_error_is_unknown_instead_of_false(self):
        self.assertIsNone(decode(1, 0)['runtime_query_any_supported'])

    def test_both_masks_are_decoded(self):
        self.assertTrue(decode(0, 8)['bar_huge_mem'])
        self.assertFalse(decode(0, 8)['bar_mem'])
        self.assertTrue(decode(0, 8)['runtime_query_any_supported'])

    def test_read_query_marshalling_matches_runtime(self):
        def fake(kind, incoming, length, outgoing, outsize):
            self.assertEqual(kind, 2)
            self.assertEqual(length, 16)
            data = ctypes.cast(incoming, ctypes.POINTER(SupportFeaturePara)).contents
            self.assertEqual((data.support_feature, data.devid), (10, 0))
            ctypes.cast(outgoing, ctypes.POINTER(SupportFeaturePara)).contents.support_feature = 8
            return 0
        result = query(fake, 0, 10)
        self.assertEqual(result['output_mask_hex'], '0x8')
        self.assertTrue(result['bar_huge_mem'])


if __name__ == '__main__':
    unittest.main()
