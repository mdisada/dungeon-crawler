"""Local image generation for the Assets Lab (F12).

v1 is a *stub generator*: it runs the whole real transport -- receive the job, download every
reference from the assets bucket, "generate", upload the result, report progress -- but the
generation step itself is a placeholder. Swapping in ComfyUI later means replacing one function
(`_render`), because everything around it (references, storage, progress) is already real.

The preset key maps to a ComfyUI workflow. Those workflows don't exist yet, so `_WORKFLOWS` holds
placeholders; when they're built, `_render` dispatches on the key and the rest is unchanged.
"""
import struct
import zlib

# Nominal output size per preset. OpenRouter is stuck at 1024x1024, but the local route is where
# real per-use-case control lives, so the presets differ here (matches presets.ts on the client).
_PRESET_SIZE: dict[str, tuple[int, int]] = {
    "base_char": (768, 1344),   # 9:16 full body, what the character wizard actually wants
    "avatar_char": (768, 768),
    "cutscene": (1344, 768),
    "background": (1344, 768),
    "map": (1024, 1024),
}

# Placeholder for the eventual ComfyUI workflow-graph JSON, keyed by preset. Filling these in is
# the whole "make local generation real" task.
_WORKFLOWS: dict[str, str] = {key: f"comfy-workflow-{key}-TODO" for key in _PRESET_SIZE}

# A faint per-preset tint so stub outputs are visually distinguishable in the run table.
_PRESET_TINT: dict[str, tuple[int, int, int]] = {
    "base_char": (70, 80, 110),
    "avatar_char": (90, 70, 100),
    "cutscene": (110, 80, 70),
    "background": (70, 100, 90),
    "map": (90, 90, 90),
}


def _solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Encodes a solid-color RGB PNG with the stdlib only (no Pillow dependency)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit, color type 2 (RGB)
    row = b"\x00" + bytes(rgb) * width  # filter byte 0 + pixels
    raw = row * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def render(preset: str, prompt: str, reference_bytes: list[bytes], is_edit: bool) -> bytes:
    """Produce image bytes for a job. STUB: returns a solid placeholder (or echoes the first
    reference, so the upload/download legs move realistic byte volumes). Replace this body with a
    ComfyUI call -- `_WORKFLOWS[preset]` is where the graph selection goes.
    """
    _ = (prompt, is_edit, _WORKFLOWS)  # consumed for real once ComfyUI lands
    if reference_bytes:
        return reference_bytes[0]
    width, height = _PRESET_SIZE.get(preset, (1024, 1024))
    return _solid_png(width, height, _PRESET_TINT.get(preset, (90, 90, 90)))


def image_models() -> list[str]:
    """Reported in worker capabilities so the lab only offers what this worker can run."""
    return ["comfy-stub"]
