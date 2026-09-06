"use client";

import { useEffect } from "react";

// Only fires when the ROOT layout itself throws — must render its own
// <html>/<body> since it replaces the root layout entirely while active.
export default function GlobalError({
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
    <html lang="en">
      <body style={{ background: "#fcfcfd", color: "#17181d", fontFamily: "sans-serif" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              border: "1px solid #c3c6d7",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
              padding: "32px",
              textAlign: "center",
              maxWidth: "28rem",
              width: "100%",
            }}
          >
            <p style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
              Something went wrong
            </p>
            <p style={{ color: "#434655", marginBottom: "24px" }}>
              The application failed to load. Please try again.
            </p>
            <button
              onClick={reset}
              style={{
                padding: "12px 24px",
                borderRadius: "8px",
                background: "#1b3a8f",
                color: "#ffffff",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
