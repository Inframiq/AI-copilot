"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ChartLineUp,
  Briefcase,
  FileDashed,
  Brain,
  TrendUp,
  TrendDown,
  ArrowRight,
  Calendar,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { Resume, JobDescription } from "@career-copilot/types";

// ATS scores live on the JD (each JD's latest completed tailoring session),
// not on Resume — a resume has no single score, since it can be tailored
// against many JDs with different results. See JobDescription.ats_score.
function buildAtsTrend(jds: JobDescription[]) {
  if (jds.length === 0) return [];
  const scored = jds
    .filter((jd) => jd.ats_score != null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (scored.length === 0) return [];
  const byMonth: Record<string, number[]> = {};
  scored.forEach((jd) => {
    const key = new Date(jd.created_at).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    byMonth[key] = [...(byMonth[key] || []), jd.ats_score!];
  });
  return Object.entries(byMonth)
    .slice(-6)
    .map(([label, scores]) => ({ label: label.split(" ")[0], score: Math.max(...scores) }));
}

function buildWeeklyApps(jds: JobDescription[]) {
  const now = Date.now();
  const weeks = Array.from({ length: 6 }, (_, i) => ({
    week: i === 0 ? "This wk" : `${i}w ago`,
    count: 0,
  })).reverse();
  jds.forEach((jd) => {
    const daysAgo = Math.floor((now - new Date(jd.created_at).getTime()) / (24 * 60 * 60 * 1000));
    const weekIdx = Math.floor(daysAgo / 7);
    if (weekIdx < 6) weeks[5 - weekIdx].count++;
  });
  return weeks;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const sessionId = useTailoringStore((s) => s.sessionId);

  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });
  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });

  const scoredJds = jds.filter((jd) => jd.ats_score != null);
  const avgAts =
    scoredJds.length > 0
      ? Math.round(scoredJds.reduce((sum, jd) => sum + (jd.ats_score ?? 0), 0) / scoredJds.length)
      : null;
  const topAts =
    scoredJds.length > 0
      ? Math.max(...scoredJds.map((jd) => jd.ats_score ?? 0))
      : null;

  const atsTrend = buildAtsTrend(jds);
  const weeklyApps = buildWeeklyApps(jds);
  const maxApps = Math.max(...weeklyApps.map((w) => w.count), 1);
  const maxScore = 100;

  const reachedInterview = jds.filter((jd) =>
    ["interview", "final_round", "offer", "accepted"].includes(jd.status)
  ).length;
  const reachedFinalRound = jds.filter((jd) => ["final_round", "offer", "accepted"].includes(jd.status)).length;
  const reachedOffer = jds.filter((jd) => ["offer", "accepted"].includes(jd.status)).length;

  const funnel = [
    { stage: "Applied", count: jds.length, color: "bg-primary" },
    { stage: "ATS Passed", count: jds.filter((jd) => (jd.ats_score ?? 0) >= 70).length, color: "bg-primary/75" },
    { stage: "Interview", count: reachedInterview, color: "bg-primary/55" },
    { stage: "Final Round", count: reachedFinalRound, color: "bg-primary/35" },
    { stage: "Offer", count: reachedOffer, color: "bg-primary/20" },
  ];

  const funnelMax = funnel[0].count > 0 ? funnel[0].count : 1;

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Header */}
      <section className="pt-xl pb-md flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold mb-sm" style={{ letterSpacing: "-0.02em" }}>
            Analytics
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            Track your career search performance and optimize your strategy.
          </p>
        </div>
        <div className="flex items-center gap-sm text-label-sm text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 rounded-xl px-md py-sm">
          <Calendar size={16} />
          Last 6 weeks
        </div>
      </section>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-gutter">
        {[
          {
            label: "Resumes Created",
            value: resumes.length > 0 ? resumes.length : "—",
            trend: null as null | "up" | "down",
            icon: FileDashed,
          },
          {
            label: "Best ATS Score",
            value: topAts != null && topAts > 0 ? `${topAts}%` : "—",
            trend: topAts != null && topAts > 0 ? ("up" as const) : null,
            icon: Brain,
          },
          {
            label: "Avg ATS Score",
            value: avgAts != null && avgAts > 0 ? `${avgAts}%` : "—",
            trend: null as null | "up" | "down",
            icon: ChartLineUp,
          },
          {
            label: "JDs Analyzed",
            value: jds.length > 0 ? jds.length : "—",
            trend: null as null | "up" | "down",
            icon: Briefcase,
          },
        ].map(({ label, value, trend, icon: Icon }) => (
          <div key={label} className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col justify-between h-32 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-label-md text-on-surface-variant">{label}</span>
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon size={18} weight="fill" className="text-primary" />
              </div>
            </div>
            <div className="flex items-baseline gap-sm">
              <span className="text-headline-xl text-on-surface font-bold">{value}</span>
              {trend === "up" && <TrendUp size={16} className="text-success-accent" />}
              {trend === "down" && <TrendDown size={16} className="text-error" />}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
        {/* ATS Score Trend */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
          <h2 className="text-headline-md text-on-surface font-semibold mb-lg">ATS Score Trend</h2>
          {atsTrend.length > 0 ? (
            <div className="flex items-end gap-md h-40">
              {atsTrend.map(({ label, score }) => (
                <div key={label} className="flex-1 flex flex-col items-center gap-sm">
                  <span className="text-caption text-primary font-semibold">{score}</span>
                  <div className="w-full rounded-t-lg bg-primary/10 relative overflow-hidden" style={{ height: "100px" }}>
                    <div
                      className="absolute bottom-0 w-full bg-primary rounded-t-lg transition-all duration-700"
                      style={{ height: `${(score / maxScore) * 100}%` }}
                    />
                  </div>
                  <span className="text-caption text-on-surface-variant">{label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-center">
              <div>
                <p className="text-body-md text-on-surface font-medium mb-xs">No score data yet</p>
                <p className="text-body-sm text-on-surface-variant">Tailor a resume to see trends</p>
              </div>
            </div>
          )}
        </div>

        {/* Weekly Applications */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
          <h2 className="text-headline-md text-on-surface font-semibold mb-lg">Applications per Week</h2>
          {jds.length > 0 ? (
            <div className="flex items-end gap-md h-40">
              {weeklyApps.map(({ week, count }) => (
                <div key={week} className="flex-1 flex flex-col items-center gap-sm">
                  <span className="text-caption text-on-surface-variant font-semibold">{count}</span>
                  <div className="w-full rounded-t-lg bg-secondary-container relative overflow-hidden" style={{ height: "100px" }}>
                    <div
                      className="absolute bottom-0 w-full bg-secondary rounded-t-lg transition-all duration-700"
                      style={{ height: `${(count / maxApps) * 100}%` }}
                    />
                  </div>
                  <span className="text-caption text-on-surface-variant">{week}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-center">
              <div>
                <p className="text-body-md text-on-surface font-medium mb-xs">No applications tracked yet</p>
                <p className="text-body-sm text-on-surface-variant">Analyze your first JD to start tracking</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Application Funnel */}
      <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <h2 className="text-headline-md text-on-surface font-semibold mb-lg">Application Funnel</h2>
        {jds.length > 0 || sessionId ? (
          <div className="flex flex-col gap-sm">
            {funnel.map(({ stage, count, color }) => {
              const pct = Math.round((count / funnelMax) * 100);
              return (
                <div key={stage} className="flex items-center gap-md">
                  <span className="text-label-md text-on-surface w-28 shrink-0">{stage}</span>
                  <div className="flex-1 h-8 bg-surface-container rounded-lg overflow-hidden">
                    <div
                      className={`h-full ${color} rounded-lg flex items-center px-sm transition-all duration-700`}
                      style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }}
                    >
                      {count > 0 && <span className="text-caption text-on-primary font-bold">{count}</span>}
                    </div>
                  </div>
                  <span className="text-label-sm text-on-surface-variant w-10 text-right shrink-0">{pct}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center py-xl text-center">
            <div>
              <p className="text-body-md text-on-surface font-medium mb-xs">No funnel data yet</p>
              <p className="text-body-sm text-on-surface-variant">Start tracking applications by analyzing JDs</p>
            </div>
          </div>
        )}
      </div>

      {/* JD Match Scores — one row per job description, since ATS score is a
          property of "this resume against that job", not of a resume file. */}
      {jds.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
          <h2 className="text-headline-md text-on-surface font-semibold mb-lg">JD Match Scores</h2>
          <div className="flex flex-col gap-sm">
            {jds.map((jd) => (
              <div
                key={jd.id}
                onClick={() => router.push(`/jd/${jd.id}`)}
                className="flex items-center gap-md p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="w-10 h-10 bg-surface-container rounded-lg flex items-center justify-center text-primary shrink-0">
                  <FileDashed size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-label-md text-on-surface truncate">{jd.title}</p>
                  <p className="text-caption text-on-surface-variant">
                    {new Date(jd.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-md shrink-0">
                  <div className="text-right">
                    <p className="text-label-md text-primary font-bold">
                      {jd.ats_score != null ? `${jd.ats_score}%` : "—"}
                    </p>
                    <p className="text-caption text-on-surface-variant">ATS Score</p>
                  </div>
                  <ArrowRight size={18} className="text-on-surface-variant" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
