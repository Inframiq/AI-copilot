"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-gutter bg-background">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl text-center max-w-[28rem] w-full">
        <p className="text-headline-md text-on-surface font-bold mb-sm">Something went wrong</p>
        <p className="text-body-md text-on-surface-variant mb-lg">
          An unexpected error occurred. You can try again, or head back to your dashboard.
        </p>
        <div className="flex items-center justify-center gap-md">
          <button
            onClick={reset}
            className="px-lg py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="px-lg py-md rounded-lg text-label-md text-on-surface border border-outline-variant hover:bg-surface-container-low transition-colors"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
