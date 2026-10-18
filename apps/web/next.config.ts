import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  images: { domains: [] },
  devIndicators: false,
  // No "X-Powered-By: Next.js": it tells a visitor nothing they need and an
  // attacker which framework to look up (test WEB-001).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // This app never embeds third-party HTML and should never be
          // framed by another site itself (clickjacking defense).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Stop MIME-sniffing of served assets/JSON into an executable type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs (which may carry tokens/paths) to third-party
          // origins referenced from the app; still allow same-origin nav.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // HTTPS only, for two years, subdomains included — a first visit over
          // plain HTTP can't be downgraded or have its session read in transit.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Nothing here uses the camera, microphone, location or USB, so no
          // page (or anything injected into one) may ask for them.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), browsing-topics=()" },
          // A page opened from here, or one that opened this, gets no handle
          // on this window. Sign-in is a full-page redirect and downloads open
          // with noopener, so nothing relies on that handle.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
