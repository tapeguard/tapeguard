"""
Render the live board as a social card, from the live feed.

The caption is derived from the data rather than written beside it. A card
that says "no flags raised" over a row carrying one is the exact failure
this product exists to prevent, and it would be noticed by precisely the
people worth convincing.
"""
import json, sys, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from PIL import ImageDraw
from cards import canvas, font, save, mark, FG, MUTED, DIM, REFUSE, SAFE, WARN, LINE, ROOT

W, H, PAD = 1600, 900, 96


def render(vs, out="brand/social/card-board.png"):
    img = canvas(W, H)
    d = ImageDraw.Draw(img)

    unit = 13
    mark(d, PAD, 74, unit)
    d.text((PAD + unit * 4 + 20, 62), "tapeguard", font=font(30), fill=FG)
    d.text((W - PAD, 68), "tapeguard.xyz / live", font=font(22), fill=DIM, anchor="ra")
    d.text((PAD, 168), "LIVE FEED", font=font(20), fill=DIM)

    session = vs[0]["sessionName"] if vs else "-"
    flagged = [v for v in vs if v["flagNames"] != "none"]
    safe = [v for v in vs if v["safe"]]
    feeds = max((v["sourceCount"] for v in vs), default=0)

    d.text((PAD, 210), f"{len(safe)} of {len(vs)} instruments are safe to read.",
           font=font(44), fill=FG)
    d.text((PAD, 268),
           f"Session {session}. Every row carries where the number came from, "
           f"and why not to use it.", font=font(24), fill=MUTED)

    cols = [PAD, PAD + 200, PAD + 380, PAD + 570, PAD + 800, PAD + 1180, PAD + 1270]
    for c, t in zip(cols, ["INSTRUMENT", "PRICE", "BAND", "PROVENANCE", "FLAGS", "SRC", ""]):
        d.text((c, 350), t, font=font(19), fill=DIM)
    y = 384
    d.rectangle([PAD, y, W - PAD, y + 1], fill=LINE)
    y += 24

    for v in vs:
        d.text((cols[0], y), v["ticker"], font=font(27), fill=FG)
        d.text((cols[1], y), f"{v['price']:.2f}", font=font(27), fill=FG)
        d.text((cols[2], y), f"±{v['confidenceBps'] / 100:.2f}%", font=font(27), fill=MUTED)
        d.text((cols[3], y), v["provenanceName"], font=font(23), fill=WARN)
        fl = v["flagNames"]
        d.text((cols[4], y), fl, font=font(20), fill=DIM if fl == "none" else REFUSE)
        d.text((cols[5], y), str(v["sourceCount"]), font=font(27), fill=FG)
        d.text((cols[6], y), "SAFE" if v["safe"] else "REFUSED", font=font(21),
               fill=SAFE if v["safe"] else REFUSE)
        y += 48

    d.rectangle([PAD, y + 8, W - PAD, y + 9], fill=LINE)

    if flagged:
        names = ", ".join(v["ticker"] for v in flagged)
        caption = (f"{names} lost a source on this read, so the feed says so "
                   f"rather than quietly pricing on one.")
    else:
        caption = ("No flags raised — and still refused, because the tape is shut "
                   "and the price was never printed.")
    d.text((PAD, y + 40), caption, font=font(24), fill=MUTED)

    return save(img, out)


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/api/verdicts"
    with urllib.request.urlopen(url, timeout=20) as r:
        data = json.load(r)
    p = render(data["verdicts"])
    print(f"  {p.relative_to(ROOT)}  ({len(data['verdicts'])} rows)")


if __name__ == "__main__":
    main()
