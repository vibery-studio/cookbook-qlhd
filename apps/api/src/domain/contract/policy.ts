import type { ApprovalPolicy, PolicyRule, RequiredStep } from "./types";

function holds(rule: PolicyRule, vars: Record<string, number | undefined>): boolean {
  const actual = vars[rule.when.var];
  if (actual === undefined || !Number.isFinite(actual)) return true;

  switch (rule.when.op) {
    case "gt":
      return actual > rule.when.value;
    case "gte":
      return actual >= rule.when.value;
    case "lt":
      return actual < rule.when.value;
    case "lte":
      return actual <= rule.when.value;
    case "eq":
      return actual === rule.when.value;
  }
}

export function requiredSteps(policy: ApprovalPolicy, vars: Record<string, number | undefined>): RequiredStep[] {
  const steps: RequiredStep[] = [];
  const fixed = policy.mode === "steps" || policy.mode === "combined" ? policy.steps ?? [] : [];
  for (const step of fixed) {
    steps.push({
      step_no: 0,
      label: step.label,
      required_permission: step.permission,
      required_role: step.role ?? null,
    });
  }

  const rules = policy.mode === "threshold" || policy.mode === "combined" ? policy.rules ?? [] : [];
  for (const rule of rules) {
    if (!holds(rule, vars)) continue;
    for (const step of rule.add_steps) {
      steps.push({
        step_no: 0,
        label: step.label,
        required_permission: step.permission,
        required_role: step.role ?? null,
      });
    }
  }

  return steps.map((step, index) => ({ ...step, step_no: index + 1 }));
}
