"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ChatCircleDots, Star, X, CheckCircle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";

/**
 * "Send feedback" trigger, rendered inline in TopNav's header row next to
 * the search bar / CreditMeter (not floating — a fixed-position button
 * used to overlap the mobile bottom tab bar). Opens a small modal with a
 * 1-5 star rating and an optional comment, submitted to POST /feedback.
 * No persisted UI state beyond the open/closed flag, so a submitted
 * rating just resets on next open.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const pathname = usePathname();

  const { mutate, isPending, isSuccess, reset } = useMutation({
    mutationFn: () =>
      apiClient.submitFeedback({
        rating,
        comment: comment.trim() || undefined,
        page: pathname,
      }),
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setRating(0);
    setHoverRating(0);
    setComment("");
    reset();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="p-sm rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors shrink-0"
      >
        <ChatCircleDots size={20} />
      </button>

      {open &&
        createPortal(
          <>
          <div className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm" onClick={close} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
            <div className="pointer-events-auto w-full max-w-[26rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl overflow-hidden">
              {isSuccess ? (
                <div className="p-lg flex flex-col items-center gap-md text-center">
                  <CheckCircle size={40} weight="fill" className="text-primary" />
                  <p className="text-label-md text-on-surface font-semibold">Thanks for the feedback!</p>
                  <button
                    onClick={close}
                    className="px-lg py-sm rounded-lg text-label-sm text-on-surface-variant hover:bg-surface-container transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <div className="p-lg flex flex-col gap-md">
                  <div className="flex items-center justify-between">
                    <p className="text-label-md text-on-surface font-semibold">How's KripaX working for you?</p>
                    <button
                      onClick={close}
                      className="p-xs rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex items-center justify-center gap-xs">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(n)}
                        onMouseEnter={() => setHoverRating(n)}
                        onMouseLeave={() => setHoverRating(0)}
                        aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
                        className="p-xs"
                      >
                        <Star
                          size={28}
                          weight={n <= (hoverRating || rating) ? "fill" : "regular"}
                          className={n <= (hoverRating || rating) ? "text-tertiary" : "text-outline-variant"}
                        />
                      </button>
                    ))}
                  </div>

                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Anything you'd like us to know? (optional)"
                    rows={3}
                    maxLength={4000}
                    className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                  />

                  <div className="flex items-center justify-end gap-sm">
                    <button
                      onClick={close}
                      className="px-lg py-sm rounded-lg text-label-sm text-on-surface-variant hover:bg-surface-container transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => mutate()}
                      disabled={rating === 0 || isPending}
                      className="px-lg py-sm rounded-lg text-label-sm text-on-primary bg-primary hover:opacity-90 transition-opacity disabled:opacity-40"
                    >
                      {isPending ? "Sending..." : "Send feedback"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          </>,
          document.body
        )}
    </>
  );
}
