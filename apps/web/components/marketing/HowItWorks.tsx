import { FilePdf, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "./Reveal";

/**
 * Three steps on one rail — paste, review, export — each shown as a small
 * piece of the real interface rather than an icon and a paragraph.
 */
export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-[1200px] scroll-mt-28 px-gutter py-[72px]">
      <Reveal className="mb-xl max-w-[40rem]">
        <p className="mb-sm text-caption font-semibold uppercase tracking-[0.14em] text-primary">How it works</p>
        <h2 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-on-surface sm:text-[44px]">
          From job post to tailored PDF{" "}
          <span className="whitespace-nowrap font-[family-name:var(--font-display)] font-normal italic text-primary">in minutes.</span>
        </h2>
      </Reveal>

      <ol className="relative grid gap-xl md:grid-cols-3 md:gap-lg">
        {/* The rail joining the three steps. */}
        <span
          aria-hidden
          className="absolute left-[1.15rem] top-6 hidden h-px w-[calc(100%-2.3rem)] bg-gradient-to-r from-primary/40 via-primary/20 to-primary/40 md:block"
        />
        <Step n={1} title="Paste the job" delay={0}
          text="We read it the way an ATS does: the tools, methods and phrases it will screen for, and which ones your résumé is missing.">
          <div className="flex flex-col gap-xs">
            <div className="h-2 w-4/5 rounded-full bg-surface-container-high" />
            <div className="flex flex-wrap items-center gap-1 text-[11px] leading-none text-on-surface-variant">
              <span>Own</span>
              <Chip>roadmap prioritisation</Chip>
              <span>and ship with</span>
              <Chip>CI/CD</Chip>
            </div>
            <div className="h-2 w-3/5 rounded-full bg-surface-container-high" />
            <div className="mt-xs flex flex-wrap gap-1">
              <Tag tone="miss">Kubernetes</Tag>
              <Tag tone="miss">roadmap prioritisation</Tag>
              <Tag tone="hit">Python</Tag>
            </div>
          </div>
        </Step>
        <Step n={2} title="Review every change" delay={0.1}
          text="Each rewrite has a switch and shows the points it adds. Anything unverified starts off, with the reason, until you say it's true.">
          <div className="flex flex-col gap-xs">
            {[
              { on: true, w: "w-11/12" },
              { on: true, w: "w-4/5" },
              { on: false, w: "w-3/4" },
            ].map((row, i) => (
              <div key={i} className="flex items-center gap-sm rounded-lg bg-white px-sm py-1.5 shadow-[0_1px_2px_rgba(23,24,29,0.06)]">
                <div className={`h-1.5 rounded-full ${row.on ? "bg-on-surface/25" : "bg-on-surface/10"} ${row.w}`} />
                <span className={`relative ml-auto h-3.5 w-6 shrink-0 rounded-full ${row.on ? "bg-primary" : "bg-outline-variant"}`}>
                  <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white ${row.on ? "right-0.5" : "left-0.5"}`} />
                </span>
              </div>
            ))}
            <p className="tabular text-right text-[11px] font-semibold text-success">58 → 69</p>
          </div>
        </Step>
        <Step n={3} title="Export and apply" delay={0.2}
          text="One click to a clean PDF in a template ATS systems read correctly — saved against the job, so each application keeps its own version.">
          <div className="flex items-end gap-md">
            <div className="flex h-[92px] w-[72px] flex-col gap-1 rounded-md bg-white p-1.5 shadow-[0_6px_16px_-8px_rgba(23,24,29,0.35)]">
              <div className="h-1.5 w-2/3 rounded-full bg-on-surface/40" />
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className={`h-1 rounded-full bg-on-surface/12 ${i % 3 === 2 ? "w-3/4" : "w-full"}`} />
              ))}
            </div>
            <div className="flex flex-col gap-1 text-[11px] text-on-surface-variant">
              <span className="inline-flex items-center gap-1 font-semibold text-on-surface">
                <FilePdf size={14} weight="fill" className="text-primary" /> résumé.pdf
              </span>
              <span className="inline-flex items-center gap-1">
                <CheckCircle size={12} weight="fill" className="text-success" /> Saved to this job
              </span>
            </div>
          </div>
        </Step>
      </ol>
    </section>
  );
}

function Step({
  n, title, text, delay, children,
}: { n: number; title: string; text: string; delay: number; children: React.ReactNode }) {
  return (
    <li>
      <Reveal delay={delay} className="relative flex flex-col gap-md">
        <span className="tabular relative z-[1] flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-white text-body-md font-bold text-primary shadow-[0_6px_18px_-8px_rgba(27,58,143,0.45)]">
          {n}
        </span>
        <div className="rounded-2xl border border-outline-variant/40 bg-surface-container-low/80 p-md backdrop-blur-sm">
          {children}
        </div>
        <div>
          <h3 className="mb-xs text-body-lg font-semibold text-on-surface">{title}</h3>
          <p className="text-body-sm text-on-surface-variant">{text}</p>
        </div>
      </Reveal>
    </li>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-primary-fixed px-1 py-0.5 font-medium text-on-primary-fixed">{children}</mark>;
}

function Tag({ tone, children }: { tone: "hit" | "miss"; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
        tone === "hit" ? "bg-success-container text-success" : "bg-error-container text-error"
      }`}
    >
      {tone === "hit" ? "✓ " : "✕ "}
      {children}
    </span>
  );
}
