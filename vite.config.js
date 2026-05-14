import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    clearScreen: false,
    server: {
        host: "0.0.0.0",
        port: 1420,
        strictPort: true
    },
    test: {
        globals: true,
        environment: "jsdom"
    }
});
