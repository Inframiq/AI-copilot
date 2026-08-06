"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Path,
  CheckCircle,
  Circle,
  ArrowRight,
  Target,
  TrendUp,
  BookOpen,
  Certificate,
  Plus,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import type { Resume, JobDescription } from "@career-copilot/types";

const RESOURCES = [
  { icon: BookOpen, title: "System Design Interview", type: "Book", tag: "Recommended" },
  { icon: Certificate, title: "AWS Solutions Architect", type: "Certification", tag: "High Impact" },
  { icon: BookOpen, title: "GraphQL Fundamentals", type: "Course", tag: "Skill Gap" },
];

export default function CareerPathPage() {
  const router = useRouter();

  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });
  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });

  const sessionId = useTailoringStore((s) => s.sessionId);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const resumeContent = useResumeStore((s) => s.content);

  const currentRole = resumeContent?.experience?.[0]?.title || "Not set";

  const [targetRole, setTargetRole] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("career-copilot-target-role") || "";
    return "";
  });

  useEffect(() => {
    if (!targetRole && jds.length > 0) {
      setTargetRole(jds[jds.length - 1].title);
    }
  }, [jds, targetRole]);

  const handleTargetRoleChange = (v: string) => {
    setTargetRole(v);
    localStorage.setItem("career-copilot-target-role", v);
  };

  // Milestone status computation
  const milestones = [
    {
      title: "Build Resume & Portfolio",
      description: "Create a polished resume and link your GitHub/portfolio projects.",
      status: resumes.length > 0 ? "done" as const : "active" as const,
    },
    {
      title: "Tailor to Target Roles",
      description: "Use JD Analyzer to align your skills with 3+ job postings.",
      status: jds.length >= 1 ? "done" as const : resumes.length > 0 ? "active" as const : "upcoming" as const,
    },
    {
      title: "Interview Preparation",
      description: "Complete at least 2 mock interview sessions in Interview Center.",
      status: sessionId !== null ? "done" as const : jds.length > 0 ? "active" as const : "upcoming" as const,
    },
    {
      title: "Apply to 10 Roles",
      description: "Submit tailored applications to senior-level positions.",
      status: jds.length >= 10 ? "done" as const : sessionId !== null && jds.length < 10 ? "active" as const : "upcoming" as const,
    },
    {
      title: "Negotiate & Accept Offer",
      description: "Use salary negotiation strategies and sign your offer.",
      status: "upcoming" as const,
    },
  ];

  const hasTailoringData = missingSkills.length > 0 || matchedSkills.length > 0;

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Header */}
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface font-bold mb-sm" style={{ letterSpacing: "-0.02em" }}>
          Career Path
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Map your journey from where you are to where you want to be.
        </p>
      </section>

      {/* Progress summary */}
      <div className="flex items-center gap-lg text-label-sm text-on-surface-variant">
        <span className="flex items-center gap-xs">
          <span className="text-primary font-bold">{resumes.length}</span> resume{resumes.length !== 1 ? "s" : ""}
        </span>
        <span className="w-px h-4 bg-outline-variant/40" />
        <span className="flex items-center gap-xs">
          <span className="text-primary font-bold">{jds.length}</span> JD{jds.length !== 1 ? "s" : ""} analyzed
        </span>
        <span className="w-px h-4 bg-outline-variant/40" />
        <span className="flex items-center gap-xs">
          <span className="text-primary font-bold">{sessionId ? 1 : 0}</span> session{sessionId ? "" : "s"}
        </span>
      </div>

      {/* Role Transition Banner */}
      <div className="bg-primary rounded-2xl p-lg flex flex-col md:flex-row items-center gap-lg relative overflow-hidden shadow-lg shadow-primary/20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-container/30 rounded-full blur-3xl pointer-events-none" style={{ marginRight: "-4rem", marginTop: "-4rem" }} />
        <div className="flex-1 flex flex-col gap-xs relative z-10">
          <span className="text-caption text-on-primary/60 uppercase tracking-wider">Current Role</span>
          <p className="text-headline-md text-on-primary font-bold border-b border-on-primary/30 pb-xs truncate">
            {currentRole}
          </p>
        </div>
        <ArrowRight size={32} className="text-on-primary/60 shrink-0 relative z-10" weight="bold" />
        <div className="flex-1 flex flex-col gap-xs relative z-10">
          <span className="text-caption text-on-primary/60 uppercase tracking-wider">Target Role</span>
          <input
            value={targetRole}
            onChange={(e) => handleTargetRoleChange(e.target.value)}
            placeholder={jds.length > 0 ? "Derived from latest JD..." : "Enter your target role"}
            className="text-headline-md text-on-primary font-bold bg-transparent border-b border-on-primary/30 focus:border-on-primary outline-none pb-xs placeholder:text-on-primary/40"
          />
        </div>
        <div className="relative z-10 flex flex-col items-center gap-xs">
          <div className="w-16 h-16 rounded-full bg-on-primary/10 flex items-center justify-center">
            <Target size={28} className="text-on-primary" />
          </div>
          <span className="text-label-sm text-on-primary/80">~6 months</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        {/* Milestones */}
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
            <Path size={22} className="text-primary" />
            Roadmap Milestones
          </h2>
          <div className="flex flex-col gap-sm relative">
            {/* Vertical line */}
            <div className="absolute left-[19px] top-8 bottom-8 w-px bg-outline-variant/40" />
            {milestones.map((m, i) => (
              <div key={i} className="flex items-start gap-md pl-xs">
                <div className={`mt-xs shrink-0 ${m.status === "done" ? "text-success-accent" : m.status === "active" ? "text-primary" : "text-outline-variant"}`}>
                  {m.status === "done" ? (
                    <CheckCircle size={24} weight="fill" />
                  ) : m.status === "active" ? (
                    <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  ) : (
                    <Circle size={24} />
                  )}
                </div>
                <div className={`flex-1 p-md rounded-xl border transition-all ${
                  m.status === "active"
                    ? "bg-secondary-container/30 border-primary/20"
                    : m.status === "done"
                    ? "bg-surface-container border-outline-variant/10 opacity-70"
                    : "bg-surface-container-lowest border-outline-variant/20"
                }`}>
                  <div className="flex items-center justify-between mb-xs">
                    <p className={`text-label-md font-semibold ${m.status === "done" ? "text-on-surface-variant line-through" : "text-on-surface"}`}>
                      {m.title}
                    </p>
                    {m.status === "active" && (
                      <span className="text-caption text-primary bg-primary/10 px-sm py-xs rounded-full">In Progress</span>
                    )}
                    {m.status === "done" && (
                      <span className="text-caption text-success-accent bg-success-accent/10 px-sm py-xs rounded-full">Done</span>
                    )}
                  </div>
                  <p className="text-body-sm text-on-surface-variant">{m.description}</p>
                </div>
              </div>
            ))}
          </div>
          <button className="flex items-center gap-sm text-label-md text-primary hover:text-primary-container transition-colors mt-sm">
            <Plus size={18} /> Add milestone
          </button>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-md">
          {/* Skills Gap */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm mb-md">
              <TrendUp size={22} className="text-primary" />
              Skills Gap
            </h2>
            {hasTailoringData ? (
              <div className="flex flex-col gap-md">
                {missingSkills.slice(0, 5).map((skill) => (
                  <div key={skill}>
                    <div className="flex justify-between mb-xs">
                      <span className="text-label-md text-on-surface truncate">{skill}</span>
                      <span className="text-label-sm text-on-surface-variant shrink-0 ml-sm">0% → 80%</span>
                    </div>
                    <div className="h-2 bg-surface-variant rounded-full overflow-hidden relative">
                      <div className="h-full bg-outline-variant/50 rounded-full absolute" style={{ width: "80%" }} />
                      <div className="h-full bg-error rounded-full relative" style={{ width: "0%" }} />
                    </div>
                  </div>
                ))}
                {matchedSkills.slice(0, 3).map((skill) => (
                  <div key={skill}>
                    <div className="flex justify-between mb-xs">
                      <span className="text-label-md text-on-surface truncate">{skill}</span>
                      <span className="text-label-sm text-on-surface-variant shrink-0 ml-sm">80% → 100%</span>
                    </div>
                    <div className="h-2 bg-surface-variant rounded-full overflow-hidden relative">
                      <div className="h-full bg-outline-variant/50 rounded-full absolute" style={{ width: "100%" }} />
                      <div className="h-full bg-primary rounded-full relative" style={{ width: "80%" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-lg text-center gap-sm">
                <p className="text-body-sm text-on-surface-variant">
                  Analyze a JD to see your skills gap
                </p>
                <button
                  onClick={() => router.push("/jd")}
                  className="text-label-sm text-primary hover:text-primary-container transition-colors"
                >
                  Go to JD Analyzer →
                </button>
              </div>
            )}
          </div>

          {/* Recommended Resources */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <h2 className="text-headline-md text-on-surface font-semibold mb-md">Resources</h2>
            <div className="flex flex-col gap-sm">
              {RESOURCES.map(({ icon: Icon, title, type, tag }) => (
                <div key={title} className="flex items-center gap-md p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container transition-colors cursor-pointer">
                  <div className="w-10 h-10 bg-surface-container rounded-lg flex items-center justify-center text-primary shrink-0">
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-label-md text-on-surface truncate">{title}</p>
                    <p className="text-caption text-on-surface-variant">{type}</p>
                  </div>
                  <span className="text-caption text-primary bg-primary/10 px-sm py-xs rounded-full shrink-0">{tag}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={() => router.push("/jd")}
            className="w-full py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
          >
            Analyze a Job Description
          </button>
        </div>
      </div>
    </div>
  );
}
