const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";

function parts(timestamp: number): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("vi-VN", {
      timeZone: VIETNAM_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function formatVietnamTimestamp(seconds: number, now = Date.now()): string {
  const date = parts(seconds * 1000);
  const today = parts(now);
  if (date.year === today.year && date.month === today.month && date.day === today.day) {
    return `Hôm nay ${date.hour}:${date.minute}`;
  }
  return `${date.day}/${date.month}/${date.year}`;
}
