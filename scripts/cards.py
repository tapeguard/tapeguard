"""
Brand card renderer.

One renderer for every visual surface — video overlays, title cards and
social images — so a tweet, the site and the teaser cannot drift apart. The
tokens below mirror public/style.css exactly; changing a colour here without
changing it there is how a brand starts looking approximate.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "brand" / "fonts"

BG      = (0, 0, 0)
FG      = (255, 255, 255)
MUTED   = (122, 122, 122)
DIM     = (74, 74, 74)
SAFE    = (74, 222, 128)
REFUSE  = (255, 95, 86)
WARN    = (245, 185, 66)
LINE    = (46, 46, 46)

_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = ("b" if bold else "r", size)
    if key not in _cache:
        name = "JetBrainsMono-Bold.ttf" if bold else "JetBrainsMono-Regular.ttf"
        _cache[key] = ImageFont.truetype(str(FONTS / name), size)
    return _cache[key]


def canvas(w: int, h: int, transparent: bool = False) -> Image.Image:
    return Image.new("RGBA", (w, h), (0, 0, 0, 0) if transparent else (*BG, 255))


def text_width(s: str, size: int, bold: bool = False) -> int:
    return int(font(size, bold).getlength(s))


def draw_runs(d: ImageDraw.ImageDraw, x: int, y: int, runs, size: int, bold=False) -> int:
    """Draw coloured segments on one baseline. `runs` is [(text, colour), ...]."""
    f = font(size, bold)
    cx = x
    for s, col in runs:
        d.text((cx, y), s, font=f, fill=col)
        cx += int(f.getlength(s))
    return cx


def mark(d: ImageDraw.ImageDraw, x: int, y: int, unit: int) -> None:
    """The tape mark: three rows, the middle one interrupted."""
    bar = max(2, round(unit * 0.28))
    gap = max(3, round(unit * 0.56))
    d.rectangle([x, y, x + unit * 4, y + bar], fill=FG)
    d.rectangle([x, y + gap, x + int(unit * 2.4), y + gap + bar], fill=FG)
    d.rectangle([x, y + gap * 2, x + int(unit * 3.2), y + gap * 2 + bar], fill=FG)
    d.rectangle([x + int(unit * 2.7), y + gap, x + unit * 4, y + gap + bar], fill=(70, 70, 70))


def wordmark(d: ImageDraw.ImageDraw, x: int, y: int, size: int = 34) -> None:
    unit = max(4, size // 4)
    mark(d, x, y + size // 6, unit)
    d.text((x + unit * 4 + size // 2, y), "tapeguard", font=font(size), fill=FG)


def save(img: Image.Image, path: str | Path) -> Path:
    p = ROOT / path if not str(path).startswith("/") else Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGBA").save(p)
    return p
