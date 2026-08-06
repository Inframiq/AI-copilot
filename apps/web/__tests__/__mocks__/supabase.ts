// Minimal stub so api-client.ts can be imported in tests.
// Individual tests mock apiClient directly so this is never called.
export function createBrowserClient() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
      }),
    },
  };
}

export function createServerClient() {
  return {};
}
