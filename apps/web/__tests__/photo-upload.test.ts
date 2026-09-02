import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: { getUser: getUserMock },
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  }),
}));

import { assertValidPhoto, uploadProfilePhoto, uploadResumePhoto } from "../lib/photo-upload";

function fakeFile(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("assertValidPhoto", () => {
  it("rejects a non-image MIME type", () => {
    expect(() => assertValidPhoto(fakeFile("a.gif", "image/gif", 1000))).toThrow(/JPEG, PNG, or WebP/);
  });
  it("rejects a file larger than 5MB", () => {
    expect(() => assertValidPhoto(fakeFile("a.jpg", "image/jpeg", 5 * 1024 * 1024 + 1))).toThrow(/smaller than 5MB/);
  });
  it("accepts a valid JPEG under 5MB", () => {
    expect(() => assertValidPhoto(fakeFile("a.jpg", "image/jpeg", 1024))).not.toThrow();
  });
});

describe("uploadProfilePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-9" } } });
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://sb.example/avatars/user-9/profile.png" } });
  });

  it("uploads to '<uid>/profile.<ext>' and returns { url, path }", async () => {
    const result = await uploadProfilePhoto(fakeFile("me.PNG", "image/png", 2048));
    expect(uploadMock).toHaveBeenCalledWith(
      "user-9/profile.png",
      expect.any(File),
      expect.objectContaining({ upsert: true, contentType: "image/png" }),
    );
    expect(result).toEqual({
      url: "https://sb.example/avatars/user-9/profile.png",
      path: "user-9/profile.png",
    });
  });

  it("rejects an invalid file before touching storage", async () => {
    await expect(uploadProfilePhoto(fakeFile("me.gif", "image/gif", 2048))).rejects.toThrow();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("uploadResumePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-9" } } });
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://sb.example/avatars/user-9/resume-3.jpg" } });
  });

  it("still uploads to '<uid>/<resumeId>.<ext>'", async () => {
    const url = await uploadResumePhoto("resume-3", fakeFile("shot.jpg", "image/jpeg", 2048));
    expect(uploadMock).toHaveBeenCalledWith(
      "user-9/resume-3.jpg",
      expect.any(File),
      expect.objectContaining({ upsert: true, contentType: "image/jpeg" }),
    );
    expect(url).toBe("https://sb.example/avatars/user-9/resume-3.jpg");
  });
});
