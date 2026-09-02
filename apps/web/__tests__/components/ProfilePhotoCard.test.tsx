// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfilePhotoCard } from "../../components/profile/ProfilePhotoCard";

describe("ProfilePhotoCard", () => {
  it("shows an upload control and no Remove button when there is no photo", () => {
    render(
      <ProfilePhotoCard photoUrl={null} uploading={false} error={null} onFileSelected={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Upload photo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("shows the thumbnail, a Replace label and a Remove button when a photo is set", () => {
    render(
      <ProfilePhotoCard
        photoUrl="https://sb.example/avatars/u/profile.png"
        uploading={false}
        error={null}
        onFileSelected={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: /profile photo/i })).toHaveAttribute(
      "src",
      "https://sb.example/avatars/u/profile.png",
    );
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("calls onFileSelected with the chosen file", async () => {
    const onFileSelected = vi.fn();
    render(
      <ProfilePhotoCard photoUrl={null} uploading={false} error={null} onFileSelected={onFileSelected} onRemove={vi.fn()} />,
    );
    const file = new File(["x"], "me.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/upload photo/i), file);
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("calls onRemove when Remove is clicked", async () => {
    const onRemove = vi.fn();
    render(
      <ProfilePhotoCard
        photoUrl="https://sb.example/x.png"
        uploading={false}
        error={null}
        onFileSelected={vi.fn()}
        onRemove={onRemove}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows an error message and an uploading state", () => {
    const { rerender } = render(
      <ProfilePhotoCard photoUrl={null} uploading error={null} onFileSelected={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    rerender(
      <ProfilePhotoCard photoUrl={null} uploading={false} error="Photo must be smaller than 5MB." onFileSelected={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Photo must be smaller than 5MB.")).toBeInTheDocument();
  });
});
