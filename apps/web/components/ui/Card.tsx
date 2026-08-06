import { cn } from "@/lib/utils";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      className={cn(
        "bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
