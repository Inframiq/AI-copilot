"use client";
import { fullDegreeName } from "@/lib/degree-names";

/**
 * Under a Degree field: when it is written as a short form ("B.Tech"),
 * offer it in full ("Bachelor of Technology (B.Tech)"). Nothing changes
 * until the user picks it (lib/degree-names).
 */
export function DegreeFullName({ value, onUse }: { value: string; onUse: (full: string) => void }) {
  const full = fullDegreeName(value);
  if (!full) return null;
  return (
    <button
      type="button"
      onClick={() => onUse(full)}
      className="self-start rounded-lg px-xs py-0.5 text-left text-caption text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      Write in full: {full}
    </button>
  );
}
