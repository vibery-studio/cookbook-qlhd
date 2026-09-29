import { formatVietnameseMoney } from "../../lib/vn-money";

/** Customer card line: only issued contracts count; the total comes from the API. */
export function formatIssuedLine(count: number, total: number): string {
  if (count <= 0) return "Chưa có hợp đồng đã phát hành";
  return `${count} hợp đồng · ${formatVietnameseMoney(total)}`;
}
