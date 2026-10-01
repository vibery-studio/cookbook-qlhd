import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { useCurrentUser } from "../../app/me";
import { cn } from "../../lib/cn";
import { client } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";
import { Button, EmptyState, ErrorState, Icon, LockedNote, Pill, Skeleton } from "../../ui";
import { policySteps } from "./approval-rules";

class LoadError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly status: number,
  ) {
    super(userMessage);
  }
}

type Failure = { error?: unknown; response: Response };

function toLoadError({ error, response }: Failure): LoadError {
  const problem =
    error && typeof error === "object" && "type" in error
      ? (error as { type: string; title: string; status: number })
      : { type: "about:blank", title: response.statusText, status: response.status };
  return new LoadError(problemMessage(problem).message, response.status);
}

async function fetchTemplates() {
  const r = await client.typed.GET("/templates", {});
  if (r.response.ok && r.data) return r.data.items;
  throw toLoadError(r);
}

async function fetchTemplate(id: string) {
  const r = await client.typed.GET("/templates/{id}", { params: { path: { id } } });
  if (r.response.ok && r.data) return r.data;
  throw toLoadError(r);
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Văn bản",
  paragraph: "Đoạn văn",
  money: "Tiền",
  number: "Số",
  percent: "Phần trăm",
  date: "Ngày",
  choice: "Chọn một",
  lines: "Bảng dòng hàng",
};

function itemText(item: Record<string, unknown>): string {
  for (const key of ["name", "label", "description", "title", "text", "body"]) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function FlowPills({ labels }: { labels: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-s2">
      {labels.map((label, i) => (
        <span key={`${i}-${label}`} className="inline-flex items-center gap-s2">
          {i > 0 ? (
            <span aria-hidden="true" className="text-faint">
              →
            </span>
          ) : null}
          <Pill tone="accent">{label}</Pill>
        </span>
      ))}
    </div>
  );
}

function TemplateCard({ t, active }: { t: NonNullable<ReturnType<typeof useTemplatesData>["data"]>[number]; active: boolean }) {
  return (
    <Link
      to={`/mau-hop-dong/${t.id}`}
      data-testid="template-card"
      className={cn(
        "motion-colors grid content-start gap-s3 rounded-r3 border bg-surface p-s4 text-left hover:bg-sunken focus-visible:outline-accent-soft",
        active ? "border-accent-border" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-s3">
        <h2 className="text-lg font-bold leading-head text-strong text-wrap-pretty">{t.name}</h2>
        <Pill tone="neutral">v{t.current_version.version_no}</Pill>
      </div>
      <div className="grid gap-s2">
        <p className="text-sm font-semibold text-strong">Trường bắt buộc ({t.required_fields.length})</p>
        <div className="flex flex-wrap gap-s1">
          {t.required_fields.map((name) => (
            <Pill key={name} tone="neutral">
              {name}
            </Pill>
          ))}
        </div>
      </div>
      <div className="grid gap-s2">
        <p className="text-sm font-semibold text-strong">Luồng duyệt</p>
        {t.steps_summary.length > 0 ? <FlowPills labels={t.steps_summary} /> : <p className="text-md text-muted">Không cần duyệt</p>}
      </div>
    </Link>
  );
}

function useTemplatesData() {
  return useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-s2">
      <h3 className="text-md font-bold leading-head text-strong">{title}</h3>
      {children}
    </section>
  );
}

function TemplateDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useCurrentUser();
  const canWrite = me.permissions.includes("contract:write");
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["template", id], queryFn: () => fetchTemplate(id) });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const detail = query.data;
  const version = detail?.version;
  const flow = version ? policySteps(version.approval_policy) : null;

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-strong/20" onMouseDown={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Chi tiết mẫu hợp đồng"
        data-testid="template-drawer"
        className="motion-panel absolute inset-y-0 right-0 flex w-full max-w-[var(--drawer-w)] flex-col border-l border-line bg-surface"
      >
        <div className="flex items-start justify-between gap-s3 border-b border-line px-s5 py-s4">
          <div className="grid gap-s1">
            <p className="text-sm font-medium text-muted">Mẫu hợp đồng{version ? ` · v${version.version_no}` : ""}</p>
            {detail ? <h2 className="text-xl font-bold leading-head text-strong text-wrap-pretty">{detail.name}</h2> : <Skeleton className="h-row w-full" />}
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="motion-colors inline-grid min-h-[var(--row-h)] min-w-[var(--row-h)] place-items-center rounded-r2 text-muted hover:bg-hover hover:text-strong"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="shell-scroll grid min-h-0 flex-1 content-start gap-s5 overflow-y-auto px-s5 py-s5">
          {query.isPending ? (
            <div className="grid gap-s2" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-row w-full" />
              ))}
            </div>
          ) : query.isError ? (
            query.error instanceof LoadError && query.error.status === 403 ? (
              <LockedNote>{query.error.userMessage}</LockedNote>
            ) : query.error instanceof LoadError && query.error.status === 404 ? (
              <EmptyState title="Không tìm thấy mẫu hợp đồng." action={<Button variant="secondary" onClick={onClose}>Về danh sách mẫu</Button>} />
            ) : (
              <ErrorState
                message={query.error instanceof LoadError ? query.error.userMessage : "Không tải được mẫu hợp đồng. Thử lại sau."}
                onRetry={() => void query.refetch()}
              />
            )
          ) : version && flow ? (
            <>
              <Section title="Trường cần điền khi tạo hợp đồng">
                <ul className="grid">
                  {version.fields.map((f) => (
                    <li key={f.key} className="flex items-center justify-between gap-s3 border-b border-line py-s2 text-md last:border-b-0">
                      <span className="text-body">
                        {f.label}
                        {f.required ? (
                          <span className="ml-s1 text-danger" aria-label="bắt buộc">
                            *
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-muted">{FIELD_TYPE_LABELS[f.type] ?? f.type}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted">Trường có dấu * là bắt buộc.</p>
              </Section>

              <Section title="Hạng mục mặc định">
                {version.default_line_items.length > 0 ? (
                  <ul className="grid gap-s1 text-md text-body">
                    {version.default_line_items.map((item, i) => (
                      <li key={i} className="border-b border-line py-s2 last:border-b-0">
                        {itemText(item) || "Hạng mục"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-md text-muted text-wrap-pretty">Mẫu không có hạng mục mặc định — dòng hàng lấy theo gói khi tạo hợp đồng.</p>
                )}
              </Section>

              <Section title="Điều khoản mặc định">
                {version.default_clauses.length > 0 ? (
                  <ol className="grid list-decimal gap-s2 pl-s5 text-md text-body">
                    {version.default_clauses.map((item, i) => (
                      <li key={i} className="text-wrap-pretty">
                        {itemText(item) || "Điều khoản"}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-md text-muted text-wrap-pretty">Điều khoản nằm trong nội dung mẫu, không có điều khoản riêng.</p>
                )}
              </Section>

              <Section title="Luồng duyệt">
                {flow.none ? (
                  <p className="text-md text-muted">Không cần duyệt.</p>
                ) : flow.steps.length > 0 ? (
                  <FlowPills labels={flow.steps} />
                ) : (
                  <p className="text-md text-muted">Chưa có bước duyệt cố định.</p>
                )}
                {flow.rules.length > 0 ? (
                  <ul className="grid gap-s1 text-md text-body" data-testid="template-rules">
                    {flow.rules.map((r) => (
                      <li key={r} className="text-wrap-pretty">
                        Nếu {r}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Section>
            </>
          ) : null}
        </div>

        <div className="grid gap-s3 border-t border-line bg-sunken px-s5 py-s4">
          {detail ? (
            canWrite ? (
              <Button onClick={() => void navigate(`/hop-dong?tao=${encodeURIComponent(detail.id)}`)}>Tạo hợp đồng từ mẫu này →</Button>
            ) : (
              <LockedNote>Bạn không có quyền tạo hợp đồng (cần quyền contract:write).</LockedNote>
            )
          ) : null}
          <p className="text-sm text-muted">🔒 Sửa mẫu qua Giám đốc (chưa có trên giao diện)</p>
        </div>
      </aside>
    </div>
  );
}

export function TemplatesScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const query = useTemplatesData();
  const items = query.data ?? [];

  return (
    <section className="grid gap-s4">
      <div className="grid gap-s2">
        <h1 className="text-2xl font-bold leading-head text-strong">Mẫu hợp đồng</h1>
        <p className="max-w-[720px] text-md text-muted text-wrap-pretty">
          Mỗi mẫu quy định trước các trường cần điền, hạng mục, điều khoản và luồng duyệt. Chỉ xem — khi tạo hợp đồng, hệ thống dựng sẵn theo mẫu.
        </p>
      </div>

      {query.isPending ? (
        <div className="grid gap-s3 md:grid-cols-2" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-row w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof LoadError ? query.error.userMessage : "Không tải được danh sách mẫu. Thử lại sau."}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState title="Chưa có mẫu hợp đồng nào." />
      ) : (
        <div className="grid gap-s3 md:grid-cols-2">
          {items.map((t) => (
            <TemplateCard key={t.id} t={t} active={t.id === id} />
          ))}
        </div>
      )}

      {id ? <TemplateDrawer id={id} onClose={() => void navigate("/mau-hop-dong")} /> : null}
    </section>
  );
}
