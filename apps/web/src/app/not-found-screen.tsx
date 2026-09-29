import { useNavigate } from "react-router";
import { Button } from "../ui";

export function NotFoundScreen() {
  const navigate = useNavigate();

  return (
    <section className="grid justify-items-start gap-s4 border border-line bg-surface px-s5 py-s6" role="status">
      <div className="grid gap-s2">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted">404</p>
        <h1 className="text-xl font-bold leading-head text-strong">Không tìm thấy màn hình</h1>
        <p className="max-w-[var(--drawer-w)] text-md text-body text-wrap-pretty">Đường dẫn này không tồn tại hoặc đã được thay đổi.</p>
      </div>
      <Button variant="secondary" onClick={() => { void navigate("/", { replace: true }); }}>
        Về trang đầu
      </Button>
    </section>
  );
}
