"use client";
import { UserCircle } from "@phosphor-icons/react";

interface ProfilePhotoCardProps {
  photoUrl: string | null;
  uploading: boolean;
  error: string | null;
  /** Parent is responsible for validation + upload + state. */
  onFileSelected: (file: File) => void;
  onRemove: () => void;
}

const cardCls =
  "bg-surface-container-lowest/80 backdrop-blur-xl rounded-2xl p-lg border border-outline-variant/30 shadow-lg shadow-primary/5";

export function ProfilePhotoCard({
  photoUrl,
  uploading,
  error,
  onFileSelected,
  onRemove,
}: ProfilePhotoCardProps) {
  return (
    <section className={cardCls}>
      <h2 className="text-headline-md text-on-surface font-bold tracking-tight mb-lg">
        Profile Photo
      </h2>
      <div className="flex items-center gap-lg">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt="Profile photo"
            className="w-20 h-20 rounded-full object-cover border border-outline-variant/30"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-surface-variant/50 flex items-center justify-center text-on-surface-variant/60">
            <UserCircle size={44} />
          </div>
        )}

        <div className="flex flex-col gap-xs">
          <div className="flex items-center gap-sm">
            <label className="px-md py-sm rounded-lg border border-outline-variant text-label-sm text-primary hover:bg-surface-container-low transition-colors cursor-pointer">
              {uploading ? "Uploading…" : photoUrl ? "Replace" : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileSelected(file);
                  e.target.value = "";
                }}
              />
            </label>
            {photoUrl && (
              <button
                type="button"
                onClick={onRemove}
                className="px-md py-sm rounded-lg text-label-sm text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-caption text-on-surface-variant">
            JPEG, PNG or WebP · up to 5MB · used by templates with a photo.
          </p>
          {error && <p className="text-label-sm text-error">{error}</p>}
        </div>
      </div>
    </section>
  );
}
