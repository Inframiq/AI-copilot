"use client";
import type { ResumeContent } from "@career-copilot/types";
import {
  defaultDestination, destinationOptions, MISC_SECTION_LABEL,
  type MiscDestination, type MiscPoint,
} from "@/lib/misc-points";
import { FOCUS_RING } from "@/lib/focus";
import { Card, CardHeader, Group, Switch } from "./PointsLedger";

/**
 * The profile's Miscellaneous points — facts the user saved about themselves
 * from the notes canvas — offered for this résumé. Every one starts off: they
 * were written for no job in particular, so adding one is always the user's
 * call. Each picks where it goes; one saved as "miscellaneous" fits no
 * section on its own and can't be switched on until a place is chosen.
 *
 * No "+N pts" per card: the live score in the rail moves when one is ticked,
 * and a point unrelated to this job may honestly not move it at all.
 */
export function ProfilePoints({
  points,
  content,
  decisions,
  destinations,
  onDecide,
  onDestination,
}: {
  points: MiscPoint[];
  /** The résumé being tailored — what the destination list is built from. */
  content: ResumeContent;
  decisions: Record<string, string>;
  destinations: Record<string, MiscDestination>;
  onDecide: (id: string, d: "accept" | "reject") => void;
  onDestination: (id: string, destination: MiscDestination) => void;
}) {
  if (points.length === 0) return null;
  const options = destinationOptions(content);

  return (
    <Group title="From your profile" hint="Things you saved about yourself — add the ones that fit this job">
      {points.map((point) => {
        const dest = destinations[point.id] ?? defaultDestination(point, content);
        const on = decisions[`misc:${point.id}`] === "accept" && dest !== "";
        return (
          <Card key={point.id} on={on} provenance="profile">
            <CardHeader provenance="profile" where={`Saved under ${MISC_SECTION_LABEL[point.section]}`}>
              <Switch
                on={on}
                disabled={dest === ""}
                label={`Add to this résumé: ${point.text}`}
                onChange={(next) => onDecide(point.id, next ? "accept" : "reject")}
              />
            </CardHeader>
            <p className="text-body-md leading-relaxed text-on-surface">{point.text}</p>
            <div className="flex flex-wrap items-center justify-end gap-sm border-t border-outline-variant/20 pt-xs">
              <select
                aria-label={`Where it goes: ${point.text}`}
                value={dest}
                onChange={(e) => onDestination(point.id, e.target.value as MiscDestination)}
                className={`max-w-[16rem] truncate rounded-xl border border-outline-variant/50 bg-surface px-sm py-xs text-caption text-on-surface ${FOCUS_RING}`}
              >
                {dest === "" && <option value="">Choose where it goes</option>}
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </Card>
        );
      })}
    </Group>
  );
}
