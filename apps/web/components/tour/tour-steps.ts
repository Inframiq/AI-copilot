// Mirrors the sidebar — each `href` must match a sidebar element's data-tour
// attribute so GuidedTour can find it to spotlight: a nav link, or for
// "/profile" the avatar that opens My Profile and Account. Kept as plain data so the copy can be edited without touching
// GuidedTour's rendering logic.
export interface TourStep {
  href: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    href: "/dashboard",
    title: "Your dashboard",
    body: "Your home base — quick actions, your recent resumes, a step-by-step learning path, and your credit balance, all in one glance.",
  },
  {
    href: "/profile",
    title: "My Profile & Account",
    body: "Your avatar opens My Profile, Account and Sign out. Fill in My Profile once — your contact info, work history, education, and skills power every resume and cover letter. Account holds your plan, credits, and a replay of this guide.",
  },
  {
    href: "/jd",
    title: "JD Analyzer",
    body: "Paste in a job description and see how well your resume matches it — what's aligned, what's missing, and an ATS compatibility score.",
  },
  {
    href: "/studio",
    title: "Resume Builder",
    body: "Build and edit your resume, tailor it to a specific job description in one click, and export a polished, ATS-friendly PDF.",
  },
  {
    href: "/cover-letters",
    title: "Cover Letter",
    body: "Generate a cover letter tailored to a specific job in seconds, using your profile and that job's description.",
  },
  {
    href: "/interview",
    title: "Interview Center",
    body: "Practice technical, behavioral, and HR questions generated from a job you've tailored a resume for, and track your overall readiness score as you go.",
  },
  {
    href: "/analytics",
    title: "Analytics",
    body: "Track your ATS score trend, applications per week, and your funnel from JD to interview, so you can see what's actually working.",
  },
];
