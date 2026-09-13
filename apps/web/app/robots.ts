import type { MetadataRoute } from "next";

const SITE_URL = "https://kripax.inframiq.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Everything under these prefixes requires a signed-in session
      // (middleware.ts redirects unauthenticated requests to /login) —
      // nothing there is indexable anyway, but disallowing keeps crawlers
      // from wasting budget hitting redirects, and keeps auth/legal pages
      // (already noindex via their own metadata) out of the crawl queue too.
      disallow: [
        "/dashboard",
        "/studio",
        "/jd",
        "/interview",
        "/career-path",
        "/networking",
        "/analytics",
        "/profile",
        "/onboarding",
        "/account",
        "/plans",
        "/login",
        "/register",
        "/callback",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
