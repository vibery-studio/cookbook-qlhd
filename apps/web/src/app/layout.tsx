import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { client, queryClient } from "../lib/client";
import { cn } from "../lib/cn";
import { Icon } from "../ui";
import { roleLabel, useCurrentUser } from "./me";
import { navRegistry } from "./nav";
import type { NavItem } from "./route-types";

function initials(displayName: string | null, email: string): string {
  const source = displayName?.trim() || email.split("@")[0] || email;
  const words = source.split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : source.slice(0, 2)).toUpperCase();
}

function Brand({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={cn("flex items-center gap-s2", mobile ? "min-w-0" : "px-s2 py-s2 pb-s5")}>
      <div className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-r2 bg-accent text-md font-bold text-surface">H</div>
      <div className="min-w-0">
        <div className="truncate text-md font-semibold text-strong">Hợp đồng</div>
        <div className="truncate font-mono text-micro text-faint">nội bộ · của bạn</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const userLabel = user.display_name?.trim() || user.email;

  async function handleLogout() {
    try {
      await client.logout();
    } finally {
      queryClient.clear();
      setMenuOpen(false);
      void navigate("/login", { replace: true });
    }
  }

  return (
    <div className="grid h-[100dvh] grid-cols-[var(--sidebar-w)_minmax(0,1fr)] overflow-hidden bg-app max-mobile:grid-cols-1">
      <div
        className={cn(
          "pointer-events-none fixed inset-0 z-40 bg-strong/20 opacity-0 motion-colors max-mobile:block",
          menuOpen && "pointer-events-auto opacity-100",
        )}
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />
      <aside
        data-testid="sidebar"
        className={cn(
          "motion-panel z-50 flex min-h-0 flex-col border-r border-line bg-sidebar p-s4 max-mobile:fixed max-mobile:inset-y-0 max-mobile:left-0 max-mobile:w-[var(--sidebar-w)] max-mobile:-translate-x-full",
          menuOpen && "max-mobile:translate-x-0",
        )}
      >
        <Brand />
        <nav aria-label="Điều hướng chính" className="grid gap-s1">
          {navRegistry
            .filter((item) => item.section === "workspace")
            .filter((item) => (item.requiredPermissions ?? []).every((permission) => user.permissions.includes(permission)))
            .map((item) => (
              <ShellNavLink key={item.id} item={item} onNavigate={() => setMenuOpen(false)} />
            ))}
        </nav>
        <div className="mb-s2 mt-s5 px-s3 text-micro font-semibold uppercase tracking-wide text-faint">HỆ THỐNG</div>
        <nav aria-label="Điều hướng hệ thống" className="grid gap-s1">
          {navRegistry
            .filter((item) => item.section === "system")
            .filter((item) => (item.requiredPermissions ?? []).every((permission) => user.permissions.includes(permission)))
            .map((item) => (
              <ShellNavLink key={item.id} item={item} onNavigate={() => setMenuOpen(false)} />
            ))}
        </nav>
        <div className="mt-auto border-t border-line pt-s4">
          <div className="flex items-center gap-s2 px-s2 py-s2">
            <div className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-surface" aria-hidden="true">
              {initials(user.display_name, user.email)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-md font-semibold text-strong" title={userLabel}>{userLabel}</div>
              <div className="truncate text-sm text-muted" title={user.email}>{user.email}</div>
            </div>
            <span className="shrink-0 rounded-full border border-accent-border bg-accent-soft px-s2 py-s1 text-sm font-medium text-accent">{roleLabel(user.roles)}</span>
          </div>
          <button
            type="button"
            className="motion-colors mt-s2 flex min-h-[var(--row-h)] w-full items-center gap-s2 rounded-r2 px-s3 text-md font-medium text-muted hover:bg-hover hover:text-strong"
            onClick={() => void handleLogout()}
          >
            <Icon name="logout" />
            Đăng xuất
          </button>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 overflow-y-auto bg-app shell-scroll">
        <header className="sticky top-0 z-30 hidden min-h-[var(--row-h)] items-center gap-s3 border-b border-line bg-surface px-s4 py-s2 max-mobile:flex">
          <button
            type="button"
            className="motion-colors grid min-h-[var(--row-h)] min-w-[var(--row-h)] place-items-center rounded-r2 text-muted hover:bg-hover hover:text-strong"
            aria-label={menuOpen ? "Đóng menu" : "Mở menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
          <Brand mobile />
        </header>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-s5 px-s5 py-s5 max-mobile:px-s4 max-mobile:py-s4">
          {children ?? <Outlet />}
        </div>
      </main>
    </div>
  );
}

function ShellNavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "motion-colors flex min-h-[var(--row-h)] items-center gap-s3 rounded-r2 px-s3 text-md font-medium text-muted hover:bg-hover",
          isActive && "bg-accent-soft font-semibold text-accent hover:bg-accent-soft",
        )
      }
    >
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge ? <NavBadge item={item} useValue={item.badge} /> : null}
    </NavLink>
  );
}

function NavBadge({ item, useValue }: { item: NavItem; useValue: () => number | string | undefined }) {
  const value = useValue();
  if (value === undefined || value === "" || value === 0) return null;
  return (
    <span
      data-testid={`nav-badge-${item.id}`}
      aria-label={item.badgeLabel ? item.badgeLabel(value) : String(value)}
      className="shrink-0 rounded-full bg-accent px-s2 text-sm font-semibold leading-head text-surface"
    >
      {value}
    </span>
  );
}
