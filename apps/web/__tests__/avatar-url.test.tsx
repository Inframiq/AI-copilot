// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const createSignedUrl = vi.fn();
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
}));

import { avatarPath, useAvatarSrc } from "../lib/avatar-url";

const HOST = "https://proj.supabase.co";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("avatarPath", () => {
  it("reads the object key from public and signed URLs, ignoring the query", () => {
    expect(avatarPath(`${HOST}/storage/v1/object/public/avatars/u1/profile.png?v=5`)).toBe("u1/profile.png");
    expect(avatarPath(`${HOST}/storage/v1/object/sign/avatars/u1/r.jpg?token=t`)).toBe("u1/r.jpg");
  });

  it("is null for anything that isn't a photo in the avatars bucket", () => {
    expect(avatarPath(`${HOST}/storage/v1/object/public/resumes/u1/cv.pdf`)).toBeNull();
    expect(avatarPath("data:image/png;base64,AAAA")).toBeNull();
    expect(avatarPath("not a url")).toBeNull();
    expect(avatarPath(null)).toBeNull();
  });
});

describe("useAvatarSrc", () => {
  beforeEach(() => createSignedUrl.mockReset());

  it("shows a stored photo through a signed link, never the stored URL itself", async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/link" }, error: null });
    const stored = `${HOST}/storage/v1/object/public/avatars/u1/profile.png?v=5`;
    const { result } = renderHook(() => useAvatarSrc(stored), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("https://signed/link"));
    expect(createSignedUrl).toHaveBeenCalledWith("u1/profile.png", 3600);
  });

  it("passes through a URL that isn't one of ours, and is null for no photo", () => {
    expect(renderHook(() => useAvatarSrc("data:image/png;base64,AAAA"), { wrapper }).result.current)
      .toBe("data:image/png;base64,AAAA");
    expect(renderHook(() => useAvatarSrc(null), { wrapper }).result.current).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
