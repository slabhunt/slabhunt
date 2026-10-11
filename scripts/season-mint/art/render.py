# Renders the Season Pass NFT images (1000x1000 PNG) into ../images:
#   unrevealed.png (sealed pack), common/uncommon/rare/epic/legendary.png (pack ripped open), collection.png (logo slab).
#   pip install playwright pillow && python -m playwright install chromium   (skip the install if Chromium is present)
#   SEASON="Season 3" python render.py
import os
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from PIL import Image

here = Path(__file__).parent.resolve()
out = here.parent / "images"
out.mkdir(exist_ok=True)
season = os.environ.get("SEASON", "Season 2")
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1000, "height": 2000}, device_scale_factor=2)
    pg.goto(f"file://{here}/pack.html?season={quote(season)}")
    pg.wait_for_timeout(800)
    shots = {"unrevealed": None, "common": "common", "uncommon": "uncommon", "rare": "rare", "epic": "epic", "legendary": "legendary"}
    for name, tier in shots.items():
        if tier:
            pg.evaluate(f"setTier('{tier}')")
            pg.wait_for_timeout(150)
        pg.locator("#open" if tier else "#sealed").screenshot(path=str(out / f"{name}.png"))
    b.close()
for f in out.glob("*.png"):
    if f.name == "collection.png":
        continue
    Image.open(f).convert("RGB").resize((1000, 1000), Image.LANCZOS).save(f)
print(f"Wrote pass images for {season} to {out}")
