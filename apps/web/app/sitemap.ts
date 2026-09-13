import type { MetadataRoute } from "next";

const SITE_URL = "https://kripax.inframiq.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    // /login, /register, /terms, /privacy are deliberately omitted — each
    // carries `robots: { index: false }` in its own metadata (see their
    // page/layout files), so listing them here would just contradict that.
  ];
}
