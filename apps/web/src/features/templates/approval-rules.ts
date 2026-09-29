export type PolicyStep = { step_no?: number; label: string; permission: string; role?: string };
export type PolicyRule = {
  when: { var: string; op: "gt" | "gte" | "lt" | "lte" | "eq"; value: number };
  add_steps: PolicyStep[];
};
export type ApprovalPolicy = { mode: "none" | "steps" | "threshold" | "combined"; steps?: PolicyStep[]; rules?: PolicyRule[] };

const OPS: Record<PolicyRule["when"]["op"], string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" };

/** Basis points → "10", "7,5", "7,25" by integer arithmetic (no float). */
export function bpsToPercentText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** One rule → "giảm > 10% → thêm Giám đốc duyệt". Unknown variable/op/shape → null (skipped, never breaks). */
export function ruleSentence(rule: unknown): string | null {
  if (!rule || typeof rule !== "object") return null;
  const { when, add_steps } = rule as Partial<PolicyRule>;
  if (!when || typeof when !== "object" || !Array.isArray(add_steps) || add_steps.length === 0) return null;
  if (when.var !== "discount_bps") return null;
  const op = OPS[when.op];
  if (!op || !Number.isInteger(when.value) || when.value < 0) return null;
  const labels = add_steps.map((s) => (s && typeof s.label === "string" ? s.label : "")).filter(Boolean);
  if (labels.length === 0) return null;
  return `giảm ${op} ${bpsToPercentText(when.value)}% → thêm ${labels.join(", ")}`;
}

export function policySteps(policy: unknown): { steps: string[]; rules: string[]; none: boolean } {
  if (!policy || typeof policy !== "object") return { steps: [], rules: [], none: false };
  const p = policy as Partial<ApprovalPolicy>;
  const steps = (Array.isArray(p.steps) ? p.steps : []).map((s) => (s && typeof s.label === "string" ? s.label : "")).filter(Boolean);
  const rules = (Array.isArray(p.rules) ? p.rules : []).map(ruleSentence).filter((s): s is string => s !== null);
  return { steps, rules, none: p.mode === "none" };
}
