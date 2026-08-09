import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  images: { domains: [] },
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
        ],
      },
    ];
  },
};

export default nextConfig;
