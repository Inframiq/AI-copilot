// Mirrors components/layout/Sidebar.tsx's NAV list — each `href` must match
// a Sidebar link's data-tour attribute so GuidedTour can find it to
// spotlight. Kept as plain data so the copy can be edited without touching
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
    body: "Your home base — see your resumes, job matches, and credit balance at a glance, and jump back into anything you were working on.",
  },
  {
    href: "/profile",
    title: "My Profile",
    body: "Fill this in once — your work history, education, and skills power every resume and cover letter Copilot generates for you from here on.",
  },
  {
    href: "/jd",
    title: "JD Analyzer",
    body: "Paste in a job description and see how well your resume matches it — what's aligned, and what's missing.",
  },
  {
    href: "/studio",
    title: "Resume Builder",
    body: "Build and edit your resume, tailor it to a specific job in one click, and export a polished, ATS-friendly PDF.",
  },
  {
    href: "/cover-letters",
    title: "Cover Letter",
    body: "Generate a cover letter tailored to a specific job in seconds, using your profile and the job description.",
  },
  {
    href: "/interview",
    title: "Interview Center",
    body: "Practice with interview questions generated from a job you've tailored a resume for — real prep, not generic ones.",
  },
  {
    href: "/analytics",
    title: "Analytics",
    body: "Track your ATS scores and application activity over time, so you can see what's actually working.",
  },
  {
    href: "/account",
    title: "Account",
    body: "Manage your plan, credit balance, and account settings — and you can replay this guide from here anytime.",
  },
];
