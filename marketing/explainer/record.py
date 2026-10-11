from pathlib import Path
from playwright.sync_api import sync_playwright
here = Path(__file__).parent.resolve()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 720}, record_video_dir=str(here / "raw"), record_video_size={"width": 1280, "height": 720})
    pg = ctx.new_page()
    pg.goto(f"file://{here}/explainer.html")
    total = pg.evaluate("window.TOTAL")
    pg.wait_for_function("window.DONE === true", timeout=total + 30000, polling=500)
    pg.wait_for_timeout(600)
    path = pg.video.path()
    ctx.close(); b.close()
    print(path)
