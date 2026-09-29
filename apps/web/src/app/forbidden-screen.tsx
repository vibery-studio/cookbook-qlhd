import { useNavigate } from "react-router";
import { cn } from "../lib/cn";
import { visibleNavItems } from "./nav";
import { useCurrentUser } from "./me";
import { Button } from "../ui";

export function ForbiddenScreen({ className }: { className?: string }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const firstAllowed = visibleNavItems(user)[0]?.to ?? "/";

  return (
    <section className={cn("grid justify-items-start gap-s4 border border-danger-border bg-st-rejected-bg px-s5 py-s6", className)} role="alert">
      <div className="text-2xl leading-head" aria-hidden="true">
        🔒
      </div>
      <div className="grid gap-s2">
        <h1 className="text-xl font-bold leading-head text-strong">Không có quyền truy cập</h1>
        <p className="max-w-[var(--drawer-w)] text-md text-body text-wrap-pretty">Bạn không có quyền xem màn hình này.</p>
      </div>
      <Button variant="secondary" onClick={() => { void navigate(firstAllowed, { replace: true }); }}>
        Về màn được phép
      </Button>
    </section>
  );
}
