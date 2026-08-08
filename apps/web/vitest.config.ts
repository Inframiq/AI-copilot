import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Default stays "node" — existing store/lib tests don't need a DOM.
    // Component tests opt into jsdom individually via a
    // `// @vitest-environment jsdom` pragma at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      "@career-copilot/types": resolve(
        __dirname,
        "../../packages/types/index.ts"
      ),
      // Stub out supabase for unit tests — api-client is mocked in tests anyway
      "@/lib/supabase": resolve(__dirname, "./__tests__/__mocks__/supabase.ts"),
    },
  },
});
