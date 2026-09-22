"""
Build the launch teaser from three generated clips plus typography.

This ffmpeg has no drawtext filter, so every word is rendered with PIL into
transparent PNGs and composited. That is the better path anyway: the clips
come back at 688x464, and text drawn at output resolution stays sharp over
footage that is soft.
"""
import subprocess, sys
from pathlib import Path
from PIL import ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cards import (canvas, draw_runs, font, save, mark, wordmark,
                   BG, FG, MUTED, DIM, REFUSE, LINE, ROOT)

W, H = 1440, 960
RAW = ROOT / "brand" / "video" / "raw"
OUT = ROOT / "brand" / "video"
WORK = OUT / "work"
WORK.mkdir(parents=True, exist_ok=True)

def centred(d, y, s, size, colour=FG, bold=False):
    w = int(font(size, bold).getlength(s))
    d.text(((W - w) // 2, y), s, font=font(size, bold), fill=colour)


def scrim(img, top, bottom, strength=205):
    """A vertically-feathered black band behind text.

    The footage is highest-contrast exactly where the eye goes, so white
    type over a shattering fragment or the bright bar loses its edges. A
    flat rectangle would read as a lower third and fight the shot; feathering
    the ends keeps it invisible while still giving the letters a floor.
    """
    from PIL import Image
    band = Image.new("RGBA", (W, bottom - top), (0, 0, 0, 0))
    px = band.load()
    h = bottom - top
    feather = max(1, h // 3)
    for y in range(h):
        if y < feather:
            a = int(strength * (y / feather))
        elif y > h - feather:
            a = int(strength * ((h - y) / feather))
        else:
            a = strength
        for x in range(W):
            px[x, y] = (0, 0, 0, a)
    img.alpha_composite(band, (0, top))

# ---------------------------------------------------------------- overlays
def overlay(name, build, band=None):
    img = canvas(W, H, transparent=True)
    if band:
        scrim(img, *band)
    build(ImageDraw.Draw(img))
    return save(img, WORK / f"{name}.png")

def o_a1(d): centred(d, 430, "A price can be live.", 58)
def o_a2(d): centred(d, 430, "It can be accurate.", 58)
def o_a3(d): centred(d, 430, "It can still be a lie.", 58)

def o_c1(d): centred(d, 470, "-90.00%", 132, FG, True)
def o_c2(d): centred(d, 630, "126 SIGMA", 76, REFUSE, True)
def o_c3(d): centred(d, 740, "not a price move", 40, MUTED)

def o_e1(d): centred(d, 170, "Every other oracle", 56, MUTED)
def o_e2(d): centred(d, 250, "published the number.", 56, FG)

# ------------------------------------------------------------- full cards
def card(name, build):
    img = canvas(W, H)
    build(ImageDraw.Draw(img))
    return save(img, WORK / f"{name}.png")

def c_b(d):
    centred(d, 330, "NVDA", 44, MUTED)
    centred(d, 420, "$1,000.00", 84, FG, True)
    centred(d, 530, "|", 40, DIM)
    centred(d, 590, "$100.00", 84, FG, True)
    centred(d, 720, "overnight", 34, DIM)

def c_d(d):
    centred(d, 350, "divide by one clean split ratio", 34, DIM)
    y = 430
    runs = [("/ 0.1000", FG), ("   ->   ", DIM), ("0.0 sigma", (74, 222, 128))]
    total = sum(int(font(60).getlength(s)) for s, _ in runs)
    draw_runs(d, (W - total) // 2, y, runs, 60)
    centred(d, 520, "an ordinary overnight gap", 34, DIM)
    d.rectangle([(W - 520) // 2, 620, (W + 520) // 2, 621], fill=LINE)
    centred(d, 660, "10:1 FORWARD SPLIT", 56, FG, True)

def c_f(d):
    unit = 22
    mw = unit * 4 + 24 + int(font(64).getlength("tapeguard"))
    x = (W - mw) // 2
    mark(d, x, 330, unit)
    d.text((x + unit * 4 + 24, 300), "tapeguard", font=font(64), fill=FG)
    centred(d, 430, "refused it.", 64, REFUSE, True)
    d.rectangle([(W - 460) // 2, 580, (W + 460) // 2, 581], fill=LINE)
    centred(d, 630, "tapeguard.xyz", 42, FG)
    centred(d, 710, "Pons V2  ·  24 Sept 2026  ·  16:00 UTC", 30, MUTED)
    centred(d, 770, "Robinhood Chain 4663", 26, DIM)

def build_assets():
    for n, f, band in [
        ("a1", o_a1, (390, 520)), ("a2", o_a2, (390, 520)), ("a3", o_a3, (390, 520)),
        ("c1", o_c1, (420, 620)), ("c2", o_c2, (600, 720)), ("c3", o_c3, (715, 800)),
        ("e1", o_e1, (130, 250)), ("e2", o_e2, (230, 330)),
    ]:
        overlay(n, f, band)
    for n, f in [("card_b", c_b), ("card_d", c_d), ("card_f", c_f)]:
        card(n, f)

# --------------------------------------------------------------- assembly
def clip_with_text(src, out, overlays, dur):
    """overlays: [(png, start, end)] in clip-local seconds."""
    inputs = ["-i", str(src)]
    for png, _, _ in overlays:
        # -loop 1 matters: a PNG input is a single frame at PTS 0, so a fade
        # whose start time is later never advances and the overlay stays at
        # alpha 0 forever. Looping turns it into a stream the fade can walk.
        inputs += ["-loop", "1", "-t", str(dur), "-i", str(png)]
    fc = [f"[0:v]scale={W}:{H}:flags=lanczos,setsar=1,format=rgba[base]"]
    prev = "base"
    for i, (_, st, en) in enumerate(overlays, start=1):
        fc.append(
            f"[{i}:v]format=rgba,"
            f"fade=t=in:st={st}:d=0.45:alpha=1,"
            f"fade=t=out:st={en - 0.35}:d=0.35:alpha=1[ov{i}]"
        )
        tag = f"m{i}"
        fc.append(f"[{prev}][ov{i}]overlay=0:0:enable='between(t,{st},{en})'[{tag}]")
        prev = tag
    fc.append(f"[{prev}]fade=t=in:st=0:d=0.35,fade=t=out:st={dur - 0.4}:d=0.4[v]")
    cmd = ["ffmpeg", "-v", "error", *inputs, "-filter_complex", ";".join(fc),
           "-map", "[v]", "-t", str(dur), "-r", "24",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-an", str(out), "-y"]
    subprocess.run(cmd, check=True)

def still(png, out, dur):
    subprocess.run(["ffmpeg", "-v", "error", "-loop", "1", "-i", str(png),
                    "-vf", f"scale={W}:{H},setsar=1,fade=t=in:st=0:d=0.3,fade=t=out:st={dur-0.35}:d=0.35",
                    "-t", str(dur), "-r", "24", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-crf", "19", str(out), "-y"], check=True)

def main():
    build_assets()
    w = WORK
    clip_with_text(RAW / "c1.mp4", w / "seg_a.mp4",
                   [(w / "a1.png", 0.6, 2.3), (w / "a2.png", 2.4, 4.0), (w / "a3.png", 4.1, 6.0)], 6.0)
    still(w / "card_b.png", w / "seg_b.mp4", 2.5)
    clip_with_text(RAW / "c2.mp4", w / "seg_c.mp4",
                   [(w / "c1.png", 0.2, 6.0), (w / "c2.png", 1.9, 6.0), (w / "c3.png", 3.6, 6.0)], 6.0)
    still(w / "card_d.png", w / "seg_d.mp4", 3.0)
    clip_with_text(RAW / "c3.mp4", w / "seg_e.mp4",
                   [(w / "e1.png", 0.5, 6.0), (w / "e2.png", 2.1, 6.0)], 6.0)
    still(w / "card_f.png", w / "seg_f.mp4", 5.5)

    listing = w / "segments.txt"
    listing.write_text("".join(
        f"file '{w / f'seg_{s}.mp4'}'\n" for s in "abcdef"))
    out = OUT / "tapeguard-teaser.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", str(listing), "-c", "copy", str(out), "-y"], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(out)],
                         capture_output=True, text=True).stdout.strip()
    size = out.stat().st_size / 1e6
    print(f"  {out.relative_to(ROOT)}  {float(dur):.1f}s  {size:.1f}MB  {W}x{H}")

if __name__ == "__main__":
    main()
