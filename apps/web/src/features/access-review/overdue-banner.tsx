import { Link } from "react-router";
import { useCurrentUser } from "../../app/me";
import { useCurrentReview } from "./api";
import { overdueDays, overdueText } from "./review-view";

/** Overdue quarterly review → a banner for whoever holds reviews:write (SPEC-07 §3.4). */
export function OverdueReviewBanner() {
  const me = useCurrentUser();
  const allowed = me.permissions.includes("reviews:write");
  const current = useCurrentReview(allowed);
  const data = current.data;
  if (!allowed || !data?.review || !data.overdue || data.review.status !== "open") return null;
  const days = Math.max(1, overdueDays(data.review.due_at, Date.now()));
  return (
    <div data-testid="review-overdue-banner" className="flex flex-wrap items-center justify-between gap-s3 border border-danger-border bg-danger-bg px-s4 py-s3">
      <p className="text-md font-medium text-danger">
        {overdueText(data.review.period, days)} —{" "}
        <Link to="/ra-soat-quyen" className="font-semibold text-accent underline">Rà soát ngay</Link>
      </p>
    </div>
  );
}
