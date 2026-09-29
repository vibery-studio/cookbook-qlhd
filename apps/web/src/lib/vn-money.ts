const vietnameseMoney = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/** FEEL money copy: dot thousands, followed by a separated Vietnamese đồng sign. */
export function formatVietnameseMoney(value: number | bigint): string {
  return `${vietnameseMoney.format(value)} ₫`;
}
