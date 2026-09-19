import { Hash, ChatCircleText, Repeat } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "./Reveal";

/**
 * What a recruiter notices that a keyword score doesn't: measured results,
 * varied wording, and being ready for the interview the tailoring leads to.
 */
export function BeyondTheScore() {
  return (
    <section id="beyond" className="mx-auto grid max-w-[1200px] scroll-mt-28 items-center gap-xxl px-gutter py-[72px] lg:grid-cols-2 lg:gap-[72px]">
      {/* Two panels, staggered in depth. */}
      <Reveal className="relative order-2 flex flex-col gap-md lg:order-1 lg:block lg:min-h-[26rem]">
        <div className="rounded-3xl lg:absolute lg:left-0 lg:top-0 lg:w-[88%] border border-outline-variant/40 bg-white p-lg shadow-[0_24px_60px_-28px_rgba(23,24,29,0.35)]">
          <p className="mb-md flex items-center gap-sm text-body-md font-semibold text-on-surface">
            <Hash size={18} className="text-primary" /> Add numbers
            <span className="ml-auto text-caption font-normal text-on-surface-variant">40% of bullets have one</span>
          </p>
          <div className="rounded-2xl border border-outline-variant/40 p-md">
            <p className="text-body-sm text-on-surface">Built internal reporting tools for three departments.</p>
            <p className="mt-sm text-body-sm font-medium text-primary">How many people used them each week?</p>
            <div className="mt-sm flex items-center gap-sm">
              <span className="flex-1 rounded-lg border border-primary/40 bg-surface px-sm py-1.5 text-caption text-on-surface-variant">
                …used by <span className="font-semibold text-on-surface">40</span> people across three departments
              </span>
              <span className="rounded-lg bg-primary px-sm py-1.5 text-caption font-semibold text-on-primary">Save</span>
            </div>
          </div>
        </div>
        <div className="rounded-3xl sm:ml-xxl lg:absolute lg:bottom-0 lg:right-0 lg:ml-0 lg:w-[78%] border border-white/70 bg-white/85 p-lg shadow-[0_30px_70px_-26px_rgba(27,58,143,0.45)] backdrop-blur-xl">
          <p className="mb-sm flex items-center gap-sm text-caption font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
            <ChatCircleText size={16} className="text-primary" /> Interview prep · from your gaps
          </p>
          <p className="text-body-md font-medium leading-snug text-on-surface">
            “You haven&apos;t run Kubernetes in production — walk us through how you&apos;d approach moving your
            deploy pipeline onto it.”
          </p>
          <p className="mt-sm text-caption text-on-surface-variant">
            Bridges from what you have (CI/CD) to what they want.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1} className="order-1 lg:order-2">
        <p className="mb-sm text-caption font-semibold uppercase tracking-[0.14em] text-primary">Beyond the score</p>
        <h2 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-on-surface sm:text-[44px]">
          Keywords get you seen.{" "}
          <span className="font-[family-name:var(--font-display)] font-normal italic text-primary">Proof gets you hired.</span>
        </h2>
        <ul className="mt-xl flex flex-col gap-lg">
          <Point icon={Hash} title="Real numbers, from you">
            We never invent a figure. For each bullet without one, KripaX asks the question a recruiter
            would — you add the number you actually know.
          </Point>
          <Point icon={Repeat} title="Wording that doesn’t repeat itself">
            Overused verbs and phrases are pointed out as you review, before a checker or a hiring manager
            notices them.
          </Point>
          <Point icon={ChatCircleText} title="Interview questions for this job">
            Grounded in the posting and your own résumé — including the gaps, so you&apos;re not caught
            out by the obvious follow-up.
          </Point>
        </ul>
      </Reveal>
    </section>
  );
}

function Point({
  icon: Icon, title, children,
}: { icon: typeof Hash; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-md">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed">
        <Icon size={20} weight="duotone" className="text-primary" />
      </span>
      <div>
        <p className="mb-1 text-body-md font-semibold text-on-surface">{title}</p>
        <p className="text-body-sm text-on-surface-variant">{children}</p>
      </div>
    </li>
  );
}
