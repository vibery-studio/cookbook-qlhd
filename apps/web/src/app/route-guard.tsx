import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ErrorState, Skeleton } from "../ui";
import { networkProblemMessage, problemMessage } from "../lib/problem-messages";
import { ApiProblemError, isClientError } from "../lib/client";
import { AppShell } from "./layout";
import { CurrentUserProvider, useCurrentUser, useMe } from "./me";
import { visibleNavItems } from "./nav";
import type { FeatureRoute } from "./route-types";
import { ForbiddenScreen } from "./forbidden-screen";

export function ProtectedLayout() {
  const meQuery = useMe();
  const location = useLocation();

  if (meQuery.isPending) return <ShellLoading />;

  if (meQuery.error) {
    if (meQuery.error instanceof ApiProblemError && meQuery.error.problem.status === 401) {
      const next = `${location.pathname}${location.search}${location.hash}`;
      return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
    }
    const message = meQuery.error instanceof ApiProblemError
      ? problemMessage(meQuery.error.problem).message
      : isClientError(meQuery.error)
        ? networkProblemMessage()
        : "Không thể tải phiên đăng nhập. Thử lại sau.";
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-app p-s5">
        <ErrorState message={message} onRetry={() => void meQuery.refetch()} className="w-full max-w-[var(--drawer-w)]" />
      </div>
    );
  }

  if (!meQuery.data) return <ShellLoading />;

  return (
    <CurrentUserProvider user={meQuery.data}>
      <AppShell>
        <Outlet />
      </AppShell>
    </CurrentUserProvider>
  );
}

export function PermissionGate({ requiredPermissions, children }: { requiredPermissions?: readonly string[]; children: ReactNode }) {
  const user = useCurrentUser();
  const allowed = (requiredPermissions ?? []).every((permission) => user.permissions.includes(permission));
  return allowed ? <>{children}</> : <ForbiddenScreen />;
}

export function protectFeatureRoutes(routes: readonly FeatureRoute[]): FeatureRoute[] {
  return routes.map((route) => ({
    ...route,
    element: <PermissionGate requiredPermissions={route.requiredPermissions}>{route.element}</PermissionGate>,
  }));
}

export function HomeRedirect() {
  const user = useCurrentUser();
  return <Navigate to={visibleNavItems(user)[0]?.to ?? "/khach-hang"} replace />;
}

export function ShellLoading() {
  return (
    <div className="grid min-h-[100dvh] grid-cols-[var(--sidebar-w)_minmax(0,1fr)] bg-app max-mobile:grid-cols-1">
      <aside className="border-r border-line bg-sidebar p-s4 max-mobile:hidden">
        <Skeleton className="mb-s5 h-[26px] w-[120px]" />
        <div className="grid gap-s2"><Skeleton className="h-[var(--row-h)]" /><Skeleton className="h-[var(--row-h)]" /></div>
      </aside>
      <main className="p-s5 max-mobile:p-s4">
        <Skeleton className="mb-s5 h-[var(--row-h)] w-[220px]" />
        <Skeleton className="h-[180px] w-full" />
      </main>
    </div>
  );
}

export function useHasPermission(permission: string): boolean {
  return useCurrentUser().permissions.includes(permission);
}
