import { defineConfig } from "vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve("../cloud/auth"),
  build: {
    outDir: path.resolve("../cloud/hosting"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve("../cloud/auth/index.html"),
        login: path.resolve("../cloud/auth/login.html"),
        privacy: path.resolve("../cloud/auth/privacy.html"),
      },
    },
  },
});
