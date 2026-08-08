"use client";
import { useEffect } from "react";
import {
  X,
  LinkedinLogo,
  GithubLogo,
  MapPin,
  Briefcase,
} from "@phosphor-icons/react";
import type { Profile } from "@/lib/networking-client";
import { getInitials, getAvatarColor } from "@/lib/networking-client";

interface Props {
  profile: Profile | null;
  onClose: () => void;
  onRemove: () => Promise<void>;
  isRemoving: boolean;
  removeArmed: boolean;
  onArmRemove: () => void;
}

const AVAILABLE_LABELS: Record<string, string> = {
  "full-time": "Full-time",
  contract: "Contract",
  mentoring: "Mentoring",
};

export function ConnectionDrawer({
  profile,
  onClose,
  onRemove,
  isRemoving,
  removeArmed,
  onArmRemove,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!profile) return null;

  const initials = getInitials(profile.display_name);
  const avatarColor = getAvatarColor(profile.id);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[420px] z-50 bg-surface-container-lowest border-l border-outline-variant/20 shadow-2xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-lg border-b border-outline-variant/20 shrink-0">
          <h2 className="text-headline-md text-on-surface font-semibold">
            Profile
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-lg p-lg flex-1">
          {/* Avatar + name */}
          <div className="flex items-center gap-md">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-headline-md shrink-0 ${avatarColor}`}
            >
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-sm flex-wrap">
                <p className="text-headline-md text-on-surface font-bold">
                  {profile.display_name}
                </p>
                {profile.open_to_work && (
                  <span className="text-caption px-sm py-xs rounded-full bg-primary/10 text-primary font-semibold">
                    Open to Work
                  </span>
                )}
              </div>
              {profile.headline && (
                <p className="text-body-sm text-on-surface-variant">
                  {profile.headline}
                </p>
              )}
            </div>
          </div>

          {/* Location */}
          {profile.location && (
            <div className="flex items-center gap-xs text-body-sm text-on-surface-variant">
              <MapPin size={16} />
              {profile.location}
            </div>
          )}

          {/* Bio */}
          {profile.bio && (
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">
                About
              </p>
              <p className="text-body-sm text-on-surface leading-relaxed">
                {profile.bio}
              </p>
            </div>
          )}

          {/* Skills */}
          {profile.skills.length > 0 && (
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-sm">
                Skills
              </p>
              <div className="flex flex-wrap gap-xs">
                {profile.skills.map((s) => (
                  <span
                    key={s}
                    className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Available For */}
          {profile.available_for.length > 0 && (
            <div>
              <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-sm flex items-center gap-xs">
                <Briefcase size={14} /> Available For
              </p>
              <div className="flex gap-sm flex-wrap">
                {profile.available_for.map((v) => (
                  <span
                    key={v}
                    className="px-md py-sm rounded-xl text-label-sm bg-secondary-container text-primary border border-primary/10"
                  >
                    {AVAILABLE_LABELS[v] ?? v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Links */}
          {(profile.linkedin_url || profile.github_url) && (
            <div className="flex gap-sm flex-wrap">
              {profile.linkedin_url && (
                <a
                  href={profile.linkedin_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all"
                >
                  <LinkedinLogo size={16} /> LinkedIn
                </a>
              )}
              {profile.github_url && (
                <a
                  href={profile.github_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-xs px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all"
                >
                  <GithubLogo size={16} /> GitHub
                </a>
              )}
            </div>
          )}
        </div>

        {/* Remove connection */}
        <div className="p-lg border-t border-outline-variant/20 shrink-0">
          <button
            onClick={removeArmed ? onRemove : onArmRemove}
            disabled={isRemoving}
            className={`w-full py-md rounded-xl text-label-md transition-all disabled:opacity-50 ${
              removeArmed
                ? "bg-error text-on-error hover:opacity-90"
                : "border border-error/30 text-error hover:bg-error-container/20"
            }`}
          >
            {isRemoving
              ? "Removing…"
              : removeArmed
              ? "Confirm Remove Connection"
              : "Remove Connection"}
          </button>
          {removeArmed && (
            <p className="text-caption text-on-surface-variant text-center mt-xs">
              This cannot be undone.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
