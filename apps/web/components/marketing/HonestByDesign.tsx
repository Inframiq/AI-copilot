import { Hash, Wrench, Scissors, UserCheck, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { Reveal } from "./Reveal";

const CHECKS = [
  { icon: Hash, title: "A number you didn't write", body: "“for 2M users” appears from nowhere — flagged, never slipped in." },
  { icon: Wrench, title: "A tool that isn't yours", body: "Kubernetes on a résumé that never mentions it — yours to confirm." },
  { icon: Scissors, title: "Filler dressed as impact", body: "“…ensuring seamless alignment” — called out, so you can cut it." },
];

/**
 * The page's dark beat. What makes KripaX different is not that it rewrites
 * — everything does — but what it refuses to do, and that it asks.
 */
export function HonestByDesign() {
  return (
    <section id="honest" className="scroll-mt-28 px-gutter py-md">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] bg-[#0f1220] px-lg py-[56px] text-white sm:px-xxl sm:py-[72px]">
        {/* Light from above, and a faint engineering grid. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_50%_-10%,rgba(58,96,214,0.45),transparent_70%)]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(70%_70%_at_50%_30%,black,transparent)]"
        />

        <div className="relative grid gap-xxl lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
          <Reveal>
            <p className="mb-sm text-caption font-semibold uppercase tracking-[0.14em] text-[#9db3ff]">Honest by design</p>
            <h2 className="text-[34px] font-bold leading-[1.08] tracking-[-0.025em] sm:text-[46px]">
              Assertive about keywords.{" "}
              <span className="font-[family-name:var(--font-display)] font-normal italic text-[#b9c8ff]">
                Strict about facts.
              </span>
            </h2>
            <p className="mt-lg max-w-[30rem] text-body-lg text-white/70">
              KripaX pushes the job&apos;s own phrases into your bullets wherever your
              work supports them. Every rewrite is then fact-checked in code. Anything it
              can&apos;t verify still reaches you — switched off, with the reason — so the
              call is always yours.
            </p>
          </Reveal>

          {/* The fact-check, drawn as the flow it is. */}
          <Reveal delay={0.1} className="flex flex-col gap-md">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-md backdrop-blur">
              <p className="mb-xs text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">AI rewrite</p>
              <p className="text-body-sm text-white/85">
                Scaled the checkout service on <span className="rounded bg-[#f0bd8b]/20 px-1 text-[#ffd7ae]">Kubernetes</span> for{" "}
                <span className="rounded bg-[#f0bd8b]/20 px-1 text-[#ffd7ae]">2M users</span>
                <span className="text-white/40">, ensuring seamless alignment</span>
              </p>
            </div>

            <ul className="grid gap-sm sm:grid-cols-3">
              {CHECKS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-md">
                  <Icon size={18} weight="duotone" className="mb-sm text-[#9db3ff]" />
                  <p className="mb-1 text-body-sm font-semibold text-white">{title}</p>
                  <p className="text-caption text-white/55">{body}</p>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-md rounded-2xl border border-[#9db3ff]/30 bg-[#1b3a8f]/40 p-md">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <UserCheck size={20} weight="duotone" className="text-white" />
              </span>
              <p className="text-body-sm text-white/85">
                <span className="font-semibold text-white">You decide.</span> Flagged points start switched
                off. Keep them only if they&apos;re true.
              </p>
              <ArrowRight size={18} className="ml-auto hidden shrink-0 text-white/40 sm:block" />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
