const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function assertInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in the range ${min}..${max}`);
  }
}

/** Calculate integer VND amounts using half-up rounding in basis points. */
export function computeAmounts(i: { unitPrice: number; qty: number; discountBps: number }): {
  gross: number;
  discountAmount: number;
  total: number;
} {
  assertInteger("unitPrice", i.unitPrice, 0, Number.MAX_SAFE_INTEGER);
  assertInteger("qty", i.qty, 1, 999);
  assertInteger("discountBps", i.discountBps, 0, 10_000);

  const gross = BigInt(i.unitPrice) * BigInt(i.qty);
  if (gross > MAX_SAFE) {
    throw new RangeError("gross amount exceeds the safe integer range");
  }

  const discountAmount = (gross * BigInt(i.discountBps) + 5_000n) / 10_000n;
  const total = gross - discountAmount;
  if (discountAmount > MAX_SAFE || total > MAX_SAFE) {
    throw new RangeError("amount exceeds the safe integer range");
  }

  return {
    gross: Number(gross),
    discountAmount: Number(discountAmount),
    total: Number(total),
  };
}
