import type { ReactNode } from "react";
import { EmptyState } from "../ui";

export function FeatureStub({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <section className="grid gap-s5">
      <div className="grid gap-s2">
        <p className="font-mono text-sm uppercase tracking-wide text-faint">Nền tảng giao diện</p>
        <h1 className="text-2xl font-bold leading-head text-strong">{title}</h1>
        <p className="max-w-[720px] text-md text-muted text-wrap-pretty">{description}</p>
      </div>
      {children ?? <EmptyState title="Màn hình này đang chờ dữ liệu từ API." />}
    </section>
  );
}
