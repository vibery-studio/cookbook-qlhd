import type { Candidate, RequiredStep } from "./types";

export function isEligible(step: RequiredStep, c: Candidate, excluded: ReadonlySet<string>): boolean {
  if (excluded.has(c.id)) return false;
  if (!c.permissions.includes(step.required_permission)) return false;
  return step.required_role === null || c.roles.includes(step.required_role);
}

export function eligibleAssignment(
  steps: RequiredStep[],
  candidates: Candidate[],
  excluded: ReadonlySet<string>,
): { ok: true; assignment: Record<number, string> } | { ok: false; step: RequiredStep } {
  const orderedSteps = [...steps].sort((a, b) => a.step_no - b.step_no);
  const uniqueCandidates = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (!uniqueCandidates.has(candidate.id)) uniqueCandidates.set(candidate.id, candidate);
  }

  const ownerByCandidate = new Map<string, number>();
  const stepByNumber = new Map(orderedSteps.map((step) => [step.step_no, step]));

  const visit = (step: RequiredStep, seen: Set<string>): boolean => {
    for (const candidate of uniqueCandidates.values()) {
      if (!isEligible(step, candidate, excluded) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const previousStepNo = ownerByCandidate.get(candidate.id);
      if (previousStepNo === undefined) {
        ownerByCandidate.set(candidate.id, step.step_no);
        return true;
      }
      const previousStep = stepByNumber.get(previousStepNo);
      if (previousStep !== undefined && visit(previousStep, seen)) {
        ownerByCandidate.set(candidate.id, step.step_no);
        return true;
      }
    }
    return false;
  };

  for (const step of orderedSteps) {
    if (!visit(step, new Set<string>())) return { ok: false, step };
  }

  const assignment: Record<number, string> = {};
  for (const [candidateId, stepNo] of ownerByCandidate) assignment[stepNo] = candidateId;
  return { ok: true, assignment };
}
