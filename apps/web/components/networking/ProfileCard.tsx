"use client";
import { MapPin } from "@phosphor-icons/react";
import type { Profile, ConnectStatus } from "@/lib/networking-client";
import { getInitials, getAvatarColor } from "@/lib/networking-client";

interface Props {
  profile: Profile;
  connectStatus?: ConnectStatus; // undefined = My Network mode (no button)
  onConnect?: () => void;
  onCancelRequest?: () => void;
  onClick?: () => void;
}

export function ProfileCard({
  profile,
  connectStatus,
  onConnect,
  onCancelRequest,
  onClick,
}: Props) {
  const initials = getInitials(profile.display_name);
  const avatarColor = getAvatarColor(profile.id);
  const visibleSkills = profile.skills.slice(0, 4);
  const extraSkills = profile.skills.length - 4;

  return (
    <div
      onClick={onClick}
      className={`bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col gap-md${onClick ? " cursor-pointer" : ""}`}
    >
      {/* Avatar + name */}
      <div className="flex items-start gap-md">
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-label-md shrink-0 ${avatarColor}`}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-sm flex-wrap">
            <p className="text-label-md text-on-surface font-semibold truncate">
              {profile.display_name}
            </p>
            {profile.open_to_work && (
              <span className="text-caption px-sm py-xs rounded-full bg-primary/10 text-primary font-semibold shrink-0">
                Open to Work
              </span>
            )}
          </div>
          {profile.headline && (
            <p className="text-caption text-on-surface-variant truncate">
              {profile.headline}
            </p>
          )}
        </div>
      </div>

      {/* Location */}
      {profile.location && (
        <div className="flex items-center gap-xs text-caption text-on-surface-variant">
          <MapPin size={12} />
          {profile.location}
        </div>
      )}

      {/* Skills */}
      {visibleSkills.length > 0 && (
        <div className="flex flex-wrap gap-xs">
          {visibleSkills.map((s) => (
            <span
              key={s}
              className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30"
            >
              {s}
            </span>
          ))}
          {extraSkills > 0 && (
            <span className="px-sm py-xs bg-surface-container text-caption text-on-surface-variant rounded-md border border-outline-variant/30">
              +{extraSkills} more
            </span>
          )}
        </div>
      )}

      {/* Connect button — only in Discover mode */}
      {connectStatus !== undefined && (
        <div className="mt-auto pt-sm border-t border-outline-variant/20">
          {connectStatus === "none" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConnect?.();
              }}
              className="w-full py-sm rounded-xl text-label-sm text-on-primary bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              Connect
            </button>
          )}
          {connectStatus === "pending" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancelRequest?.();
              }}
              className="w-full py-sm rounded-xl text-label-sm text-on-surface-variant border border-outline-variant/40 hover:border-error/40 hover:text-error hover:bg-error-container/20 transition-all duration-200"
            >
              Pending · Cancel
            </button>
          )}
          {connectStatus === "accepted" && (
            <div className="w-full py-sm rounded-xl text-label-sm text-success-accent bg-primary/5 text-center border border-primary/10">
              ✓ Connected
            </div>
          )}
        </div>
      )}
    </div>
  );
}
