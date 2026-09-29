import { describe, expect, it } from "vitest";
import { amountInWords } from "../../src/domain/contract/amount-words";

describe("Vietnamese amount words", () => {
  it("uses the approved wording and capitalization", () => {
    expect(amountInWords(2_565_000)).toBe("Hai triệu năm trăm sáu mươi lăm nghìn đồng");
    expect(amountInWords(8_160_000)).toBe("Tám triệu một trăm sáu mươi nghìn đồng");
    expect(amountInWords(105_000)).toBe("Một trăm lẻ năm nghìn đồng");
    expect(amountInWords(0)).toBe("Không đồng");
  });

  it("handles Vietnamese unit transformations", () => {
    expect(amountInWords(15)).toBe("Mười lăm đồng");
    expect(amountInWords(21)).toBe("Hai mươi mốt đồng");
    expect(amountInWords(25)).toBe("Hai mươi lăm đồng");
    expect(amountInWords(1_000_000_000)).toBe("Một tỷ đồng");
  });
});
