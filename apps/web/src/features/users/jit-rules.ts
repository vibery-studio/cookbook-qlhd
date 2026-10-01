/** SPEC-07 §3.4 — temporary admin (JIT) rules for the UI. The API decides; these only avoid offering dead ends. */
export const SELF_GRANT_REASON = "Không tự cấp cho mình";
export const ALREADY_ADMIN_REASON = "Đã là quản trị hệ thống thường trực";
export const NOT_ACTIVE_REASON = "Chỉ cấp cho tài khoản đang hoạt động";

export const GRANT_DURATIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: "15 phút" },
  { minutes: 30, label: "30 phút" },
  { minutes: 60, label: "1 giờ" },
  { minutes: 120, label: "2 giờ" },
  { minutes: 240, label: "4 giờ" },
  { minutes: 480, label: "8 giờ" },
];

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export function validReason(reason: string): boolean {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
}

export type ActiveGrant = { id: string; user_id: string; expires_at: number };
export type JitRowAction =
  | { kind: "grant" }
  | { kind: "revoke"; grant: ActiveGrant }
  | { kind: "locked"; reason: string };

/** What the JIT control of a Người dùng row shows, for a caller holding `jit:grant`. */
export function jitRowAction(
  user: { id: string; status: "pending" | "active" | "disabled"; roles: readonly string[] },
  me: { id: string },
  activeGrant: ActiveGrant | undefined,
): JitRowAction {
  if (user.id === me.id) return { kind: "locked", reason: SELF_GRANT_REASON };
  if (activeGrant) return { kind: "revoke", grant: activeGrant };
  if (user.roles.includes("admin")) return { kind: "locked", reason: ALREADY_ADMIN_REASON };
  if (user.status !== "active") return { kind: "locked", reason: NOT_ACTIVE_REASON };
  return { kind: "grant" };
}

const clock = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });

/** "15:30" on the Vietnam wall clock, from unix seconds. */
export function hhmm(seconds: number): string {
  const part = (type: string) => clock.formatToParts(new Date(seconds * 1000)).find((p) => p.type === type)?.value ?? "";
  const hour = part("hour") === "24" ? "00" : part("hour");
  return `${hour}:${part("minute")}`;
}

/** "Tự thu hồi lúc HH:MM" for a grant of `minutes` starting at `nowMs`. */
export function expiryText(minutes: number, nowMs: number): string {
  return `Tự thu hồi lúc ${hhmm(nowMs / 1000 + minutes * 60)}`;
}

/** "còn 2 giờ 10 phút" · "còn 1 giờ" · "còn 15 phút" — rounded up to the minute. */
export function remainingText(expiresAt: number, nowMs: number): string {
  const seconds = expiresAt - nowMs / 1000;
  if (seconds <= 0) return "đã hết hạn";
  const total = Math.ceil(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `còn ${m} phút`;
  return m === 0 ? `còn ${h} giờ` : `còn ${h} giờ ${m} phút`;
}
