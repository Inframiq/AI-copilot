import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
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
