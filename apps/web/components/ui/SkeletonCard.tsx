/**
 * A card-shaped placeholder — the app's card frame holding shimmering lines —
 * shown in place of a page's data until all of it has loaded (lib/reveal).
 * `className` sets its size where the real card's is known.
 */
export function SkeletonCard({ className = "", lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div
      aria-hidden
      className={`bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-md ${className}`}
    >
      <div className="skeleton h-5 w-40 max-w-full rounded-full" />
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`skeleton h-4 rounded-full ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}
