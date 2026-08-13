"use client";
import { useEffect, useState } from "react";

interface ScoreRingProps {
  score: number;
  size?: number;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#22c55e"; // green
  if (score >= 60) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

export function ScoreRing({ score, size = 80 }: ScoreRingProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedScore(score);
    }, 100);
    return () => clearTimeout(timer);
  }, [score]);

  const strokeWidth = 10;
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (animatedScore / 100) * circ;
  const color = getScoreColor(score);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`ATS Score: ${score}`}
      role="img"
    >
      {/* Track circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="#e3eafc"
        strokeWidth={strokeWidth}
        fill="none"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s ease-in-out" }}
      />
      {/* Score text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#050a30"
        fontSize={size / 4}
        fontWeight="700"
        fontFamily="var(--font-hanken), sans-serif"
      >
        {score}
      </text>
    </svg>
  );
}
