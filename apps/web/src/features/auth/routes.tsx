import type { RouteObject } from "react-router";
import { Button } from "../../ui";

function PublicAuthStub({ title, description }: { title: string; description: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-app p-s5">
      <section className="grid w-full max-w-[var(--drawer-w)] gap-s5 rounded-r3 border border-line bg-surface p-s6">
        <div className="grid gap-s2">
          <div className="flex items-center gap-s2">
            <div className="grid h-[26px] w-[26px] place-items-center rounded-r2 bg-accent text-md font-bold text-surface">H</div>
            <span className="text-md font-semibold text-strong">Hợp đồng</span>
          </div>
          <h1 className="text-2xl font-bold leading-head text-strong">{title}</h1>
          <p className="text-md text-muted text-wrap-pretty">{description}</p>
        </div>
        <Button type="button" variant="secondary" disabled>
          Sắp có trong card xác thực
        </Button>
      </section>
    </main>
  );
}

export const authRoutes: RouteObject[] = [
  {
    path: "/login",
    element: <PublicAuthStub title="Đăng nhập" description="Đăng nhập để tiếp tục vào không gian hợp đồng nội bộ." />,
  },
  {
    path: "/activate",
    element: <PublicAuthStub title="Kích hoạt tài khoản" description="Liên kết kích hoạt sẽ được xử lý ở màn hình xác thực." />,
  },
];
