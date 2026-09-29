const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"] as const;
const SCALES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ", "tỷ tỷ"] as const;

function unitsWord(unit: number, tens: number): string {
  if (unit === 1 && tens >= 2) return "mốt";
  if (unit === 4 && tens >= 2) return "tư";
  if (unit === 5 && tens >= 1) return "lăm";
  return DIGITS[unit] ?? "";
}

function underThousand(value: number, forceHundreds: boolean): string {
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const words: string[] = [];

  if (hundreds > 0 || forceHundreds) {
    words.push(`${DIGITS[hundreds] ?? ""} trăm`);
    if (remainder > 0 && remainder < 10) {
      words.push(`lẻ ${DIGITS[remainder] ?? ""}`);
    } else if (remainder >= 10) {
      const tens = Math.floor(remainder / 10);
      const unit = remainder % 10;
      words.push(tens === 1 ? "mười" : `${DIGITS[tens] ?? ""} mươi`);
      if (unit > 0) words.push(unitsWord(unit, tens));
    }
    return words.join(" ");
  }

  if (remainder === 0) return "";
  if (remainder < 10) return DIGITS[remainder] ?? "";
  const tens = Math.floor(remainder / 10);
  const unit = remainder % 10;
  words.push(tens === 1 ? "mười" : `${DIGITS[tens] ?? ""} mươi`);
  if (unit > 0) words.push(unitsWord(unit, tens));
  return words.join(" ");
}

/** Convert a non-negative integer amount of Vietnamese đồng to words. */
export function amountInWords(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("amount must be a non-negative safe integer");
  }
  if (amount === 0) return "Không đồng";

  let rest = BigInt(amount);
  const groups: number[] = [];
  while (rest > 0n) {
    groups.push(Number(rest % 1000n));
    rest /= 1000n;
  }

  const words: string[] = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index] ?? 0;
    if (group === 0) continue;
    const forceHundreds = index < groups.length - 1 && group < 100;
    const groupWords = underThousand(group, forceHundreds);
    const scale = SCALES[index] ?? "";
    words.push(scale === "" ? groupWords : `${groupWords} ${scale}`);
  }

  const result = `${words.join(" ")} đồng`;
  return result.charAt(0).toUpperCase() + result.slice(1);
}
