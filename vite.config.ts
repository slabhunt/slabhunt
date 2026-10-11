import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Pages: the game (/), How to play (/guide) and the draw proof page (/verify).
      input: { main: "index.html", guide: "guide.html", verify: "verify.html" },
    },
  },
});
