import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Pages: the game (/), How to play (/guide), the draw proof page (/verify) the early-access list (/signup) and admin stats (/admin).
      input: { main: "index.html", guide: "guide.html", verify: "verify.html", signup: "signup.html", admin: "admin.html" },
    },
  },
});
