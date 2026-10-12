"""Real image bytes for tests. Photos are decoded and re-encoded in the
sandbox before a render sees them, so a stub that only carries the PNG
signature is (correctly) refused as not an image."""

# A real 1x1 transparent PNG.
ONE_PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360606060000000050001a5f645ee0000000049454e44ae426082"
)
