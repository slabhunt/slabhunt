import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two pages: the game (/) and the How to play guide (/guide).
      input: { main: "index.html", guide: "guide.html" },
    },
  },
});
