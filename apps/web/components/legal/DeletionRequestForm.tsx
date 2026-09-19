"use client";
import { useState } from "react";
import { ApiError, submitDeletionRequest, type DeletionRequestInput } from "@/lib/api-client";

const CONTACT_EMAIL = "support@inframiq.com";

const EMPTY: DeletionRequestInput = {
  email: "",
  name: "",
  requester_type: "account_holder",
  details: "",
  website: "",
};

const inputCls =
  "w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-md py-sm text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30";

export function DeletionRequestForm() {
  const [form, setForm] = useState(EMPTY);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const set = <K extends keyof DeletionRequestInput>(key: K, value: DeletionRequestInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError("");
    try {
      await submitDeletionRequest(form);
      setState("sent");
    } catch (e) {
      setState("idle");
      setError(
        e instanceof ApiError && e.status === 429
          ? `Too many requests from this network. Please try again later, or email ${CONTACT_EMAIL}.`
          : `That didn't send. Please try again, or email ${CONTACT_EMAIL}.`,
      );
    }
  }

  if (state === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-lg">
        <p className="text-body-md text-on-surface font-semibold">Request received.</p>
        <p className="text-body-md text-on-surface-variant mt-xs">
          We&apos;ll email <strong className="text-on-surface">{form.email}</strong> from {CONTACT_EMAIL} within
          7 days to confirm the request came from you. Nothing is deleted until you reply.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-md rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-lg"
    >
      <div className="flex flex-col gap-xs">
        <label htmlFor="dr-email" className="text-label-md text-on-surface font-semibold">
          Your email address
        </label>
        <input
          id="dr-email"
          type="email"
          required
          maxLength={255}
          autoComplete="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          className={inputCls}
        />
        <p className="text-body-sm text-on-surface-variant">
          If you have an account, use the email you signed in with. We&apos;ll reply to this address.
        </p>
      </div>

      <div className="flex flex-col gap-xs">
        <label htmlFor="dr-name" className="text-label-md text-on-surface font-semibold">
          Your name <span className="font-normal text-on-surface-variant">(optional)</span>
        </label>
        <input
          id="dr-name"
          maxLength={255}
          autoComplete="name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputCls}
        />
      </div>

      <fieldset className="flex flex-col gap-xs">
        <legend className="text-label-md text-on-surface font-semibold mb-xs">Which describes you?</legend>
        <label className="flex items-start gap-sm text-body-md text-on-surface-variant cursor-pointer">
          <input
            type="radio"
            name="requester_type"
            checked={form.requester_type === "account_holder"}
            onChange={() => set("requester_type", "account_holder")}
            className="mt-[5px]"
          />
          I have, or had, a KripaX account and can&apos;t delete it myself
        </label>
        <label className="flex items-start gap-sm text-body-md text-on-surface-variant cursor-pointer">
          <input
            type="radio"
            name="requester_type"
            checked={form.requester_type === "not_a_user"}
            onChange={() => set("requester_type", "not_a_user")}
            className="mt-[5px]"
          />
          I don&apos;t use KripaX, but I think a user entered my details
        </label>
      </fieldset>

      <div className="flex flex-col gap-xs">
        <label htmlFor="dr-details" className="text-label-md text-on-surface font-semibold">
          What should we delete? <span className="font-normal text-on-surface-variant">(optional)</span>
        </label>
        <textarea
          id="dr-details"
          rows={4}
          maxLength={2000}
          value={form.details}
          onChange={(e) => set("details", e.target.value)}
          placeholder="For example: my whole account, or my details in someone's contact list."
          className={`${inputCls} resize-none`}
        />
        <p className="text-body-sm text-on-surface-variant">
          Please don&apos;t include passwords, ID numbers or other sensitive details. We&apos;ll never ask for them.
        </p>
      </div>

      {/* Hidden from people and screen readers. Bots fill every field. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="dr-website">Website</label>
        <input
          id="dr-website"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={(e) => set("website", e.target.value)}
        />
      </div>

      {error && <p role="alert" className="text-body-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={state === "sending"}
        className="self-start rounded-xl bg-primary px-lg py-sm text-label-md font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Send deletion request"}
      </button>
    </form>
  );
}
