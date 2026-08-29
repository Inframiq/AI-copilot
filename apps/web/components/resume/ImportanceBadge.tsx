export type ImportanceLevel = "high" | "medium" | "low";

const DOT: Record<ImportanceLevel, string> = {
  high: "bg-error",
  medium: "bg-tertiary",
  low: "bg-on-surface-variant/40",
};

const LABEL: Record<ImportanceLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function ImportanceBadge({
  level,
  className = "",
}: {
  level: ImportanceLevel;
  className?: string;
}) {
  return (
    <span
      data-testid="importance-badge"
      data-level={level}
      className={`inline-flex items-center gap-xs text-caption text-on-surface-variant ${className}`}
      title={`${LABEL[level]} importance for this JD`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[level]}`} />
      {LABEL[level]}
    </span>
  );
}
