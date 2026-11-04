import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for reusable domain / validation logic (Node environment, no
// browser). Tests live next to the code as *.test.ts.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
