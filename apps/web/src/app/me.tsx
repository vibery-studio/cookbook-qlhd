import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { client, ApiProblemError } from "../lib/client";

export type Me = {
  id: string;
  email: string;
  display_name: string | null;
  roles: string[];
  permissions: string[];
};

export const roleLabels: Record<string, string> = {
  admin: "Quản trị hệ thống",
  member: "Thành viên",
  giam_doc: "Giám đốc",
  quan_ly: "Quản lý",
  nhan_vien: "Nhân viên",
};

export function roleLabel(roles: readonly string[]): string {
  return roleLabels[roles[0] ?? ""] ?? roles[0] ?? "Thành viên";
}

async function fetchMe(): Promise<Me> {
  const result = await client.me();
  if (!result.ok) throw new ApiProblemError(result.problem);
  const data = result.data as typeof result.data & { display_name?: string | null };
  return {
    id: data.id,
    email: data.email,
    display_name: data.display_name ?? null,
    roles: data.roles,
    permissions: data.permissions,
  };
}

export function useMe() {
  return useQuery<Me, Error>({
    queryKey: ["me"],
    queryFn: fetchMe,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

const CurrentUserContext = createContext<Me | null>(null);

export function CurrentUserProvider({ user, children }: { user: Me; children: ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): Me {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("CurrentUserProvider is missing");
  return user;
}
