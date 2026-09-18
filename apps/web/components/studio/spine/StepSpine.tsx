"use client";
import { motion } from "motion/react";
import type { Step, StepId } from "@/lib/studio-steps";
import { StepNode } from "./StepNode";
import { AtsRing } from "./AtsRing";

export function StepSpine({
  steps,
  activeStep,
  onSelect,
  score,
  projected,
}: {
  steps: Step[];
  activeStep: StepId;
  onSelect: (id: StepId) => void;
  score: number | null;
  projected: number | null;
}) {
  return (
    <div className="flex items-center gap-md px-lg h-16 border-b border-outline-variant/20 bg-surface-container-lowest/80 backdrop-blur-md">
      <nav
        aria-label="Tailoring progress"
        className="flex items-center gap-sm flex-1 min-w-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center gap-sm shrink-0">
            <StepNode
              step={step}
              index={i}
              isActive={step.id === activeStep}
              onSelect={onSelect}
            />
            {i < steps.length - 1 && (
              <span aria-hidden className="relative h-0.5 w-8 sm:w-12 bg-outline-variant/30 rounded-full overflow-hidden">
                <motion.span
                  className="absolute inset-0 origin-left bg-primary rounded-full"
                  initial={false}
                  animate={{ scaleX: step.status === "done" ? 1 : 0 }}
                  transition={{ type: "spring", stiffness: 140, damping: 24 }}
                />
              </span>
            )}
          </div>
        ))}
      </nav>
      <AtsRing score={score} projected={projected} />
    </div>
  );
}
