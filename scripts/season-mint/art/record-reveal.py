# Records the pack-opening reveal videos (720x720 MP4, ~8 s) into ../images: common.mp4 ... legendary.mp4.
# Needs node 22.6+ (to load src/lib/celebrate.ts, the same fireworks/confetti code the game uses), ffmpeg and playwright.
#   SEASON="Season 3" python record-reveal.py            # all tiers
#   SEASON="Season 3" python record-reveal.py 5          # just Legendary
import os, sys, shutil, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).parent.resolve()
repo = here.parents[2]
out = here.parent / "images"
season = os.environ.get("SEASON", "Season 2")
names = {1: "common", 2: "uncommon", 3: "rare", 4: "epic", 5: "legendary"}
tiers = [int(x) for x in sys.argv[1:]] or list(names)

js = subprocess.run(["node", "-e", "const m=require('module');process.stdout.write(m.stripTypeScriptTypes(require('fs').readFileSync(process.argv[1],'utf8')).replace('export function','function'))",
                     str(repo / "src/lib/celebrate.ts")], capture_output=True, text=True, check=True).stdout
(here / "celebrate.js").write_text(js)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for t in tiers:
            vd = Path(tempfile.mkdtemp())
            c = b.new_context(viewport={"width": 1000, "height": 1000}, record_video_dir=str(vd), record_video_size={"width": 1000, "height": 1000})
            pg = c.new_page()
            pg.goto(f"file://{here}/reveal.html")
            pg.evaluate("([t, s]) => setup(t, s)", [t, season])
            pg.wait_for_timeout(2600)
            pg.evaluate(f"rip({t})")
            pg.wait_for_timeout(6200)
            c.close()
            webm = next(vd.glob("*.webm"))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "0.5", "-i", str(webm), "-vf", "scale=720:720:flags=lanczos",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-preset", "slow", "-movflags", "+faststart", "-an",
                            str(out / f"{names[t]}.mp4")], check=True)
            shutil.rmtree(vd, ignore_errors=True)
            print(f"Wrote {names[t]}.mp4")
        b.close()
finally:
    (here / "celebrate.js").unlink(missing_ok=True)
