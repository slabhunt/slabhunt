# How it works video

`explainer.html` is a 1280×720 animated explainer; `record.py` records it with Playwright and writes a WebM to `raw/`.

1. Make `species.js` (creature art as plain JS) from the game code, so the creatures match the app:
   `node -e 'const m=require("node:module"),fs=require("fs");let o="";for(const f of ["roster.ts","species.ts"]){o+=m.stripTypeScriptTypes(fs.readFileSync("../../src/lib/"+f,"utf8")).replace(/^import .*$/mg,"").replace(/^export\s+/mg,"")+"\n"}fs.writeFileSync("species.js",o)'`
2. `python3 record.py`
3. `ffmpeg -ss 0.4 -i raw/*.webm -vf "fps=30,format=yuv420p" -c:v libx264 -crf 24 -movflags +faststart ../../public/media/how-it-works.mp4`

Preview one scene in a browser with `explainer.html?scene=7`.
