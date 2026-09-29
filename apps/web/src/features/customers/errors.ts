import type { Problem } from "@runway/client";
import { ApiProblemError, isClientError } from "../../lib/client";
import { networkProblemMessage, problemMessage, problemSlug } from "../../lib/problem-messages";

type CustomerProblem = Problem & { existing_id?: string };

export const customerFieldLabels: Record<string, string> = {
  name: "Tên khách hàng",
  contact_person: "Người đại diện",
  tax_code: "Mã số thuế",
  phone: "Số điện thoại",
  email: "Email",
  address: "Địa chỉ",
};

export type CustomerError = {
  message: string;
  fieldErrors: Record<string, string>;
  requestId?: string;
  existingId?: string;
  slug?: string;
  forbidden: boolean;
};

export function customerError(error: unknown): CustomerError {
  if (error instanceof ApiProblemError) {
    const translated = problemMessage(error.problem as CustomerProblem, customerFieldLabels);
    const slug = problemSlug(error.problem.type);
    return {
      message: translated.message,
      fieldErrors: translated.fieldErrors,
      ...(translated.requestId ? { requestId: translated.requestId } : {}),
      ...(translated.existingId ? { existingId: translated.existingId } : {}),
      slug,
      forbidden: error.problem.status === 403 || slug === "forbidden",
    };
  }

  return {
    message: isClientError(error) ? networkProblemMessage() : networkProblemMessage(),
    fieldErrors: {},
    forbidden: false,
  };
}

export function withoutLockPrefix(message: string): string {
  return message.replace(/^🔒\s*/, "");
}
