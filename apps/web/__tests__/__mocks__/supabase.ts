// Minimal stub so api-client.ts can be imported in tests.
// Individual tests mock apiClient directly so this is never called.
export function createBrowserClient() {
  return {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "test-token" } },
      }),
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

export function createServerClient() {
  return {};
}

export async function signOutHere() {}

export function leaveSignedOut() {}

// middleware.ts reads this through the aliased spelling; the real value is
// asserted against the real module in session-cookies.test.ts.
export const SESSION_COOKIE_OPTIONS = { secure: true };
