"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileText } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

export default function StudioIndexPage() {
  const router = useRouter();
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: resumes = [], isLoading } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
    staleTime: 2 * 60 * 1000,
  });

  // If they have resumes, redirect to the most recently updated one
  useEffect(() => {
    if (!isLoading && resumes.length > 0) {
      const sorted = [...resumes].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      router.replace(`/studio/${sorted[0].id}`);
    }
  }, [resumes, isLoading, router]);

  async function createNewResume() {
    setCreateError(null);
    try {
      const resume = await apiClient.createResume({
        title: "Untitled Resume",
        content: {
          contact: { name: "", email: "" },
          experience: [],
          education: [],
          skills: [],
        },
      });
      router.push(`/studio/${resume.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create resume");
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-lg p-gutter">
      <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center">
        <FileText size={32} className="text-primary" />
      </div>
      <div className="text-center">
        <h2 className="text-headline-md text-on-surface font-semibold mb-sm">Resume Builder</h2>
        <p className="text-body-md text-on-surface-variant">
          Create and tailor your resume with AI assistance.
        </p>
      </div>
      <button
        onClick={createNewResume}
        className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
      >
        Create New Resume
      </button>
      {createError && (
        <p className="text-body-sm text-error text-center">{createError}</p>
      )}
    </div>
  );
}
