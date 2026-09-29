import { useMe } from "../../app/me";
import { formatApprovalCount, useApprovalQueue } from "./queue";

/** Nav pill hook: no request without contract:approve. */
export function useApprovalsBadge(): number | string | undefined {
  const me = useMe();
  const allowed = me.data?.permissions.includes("contract:approve") ?? false;
  const queue = useApprovalQueue(allowed);
  return allowed ? formatApprovalCount(queue.data) : undefined;
}
