import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiProblemError } from "../../../lib/client";
import { useIdempotencyKeeper } from "../../../lib/idempotency-key";
import { problemMessage, problemSlug, type ProblemWithExtensions } from "../../../lib/problem-messages";
import { Alert, Button, Field, Modal, Skeleton } from "../../../ui";
import { SELECT_CLASS } from "../../products/price-fields";
import { createTemplate, createTemplateVersion, previewDocx } from "./api";
import { FieldTable } from "./field-table";
import {
  createBody,
  errorsByRow,
  mergeRows,
  previewDocument,
  rowsFromPreview,
  templateNameFromFile,
  touchRow,
  unresolvedErrors,
  versionBody,
  type FieldRow,
  type ImportPreview,
  type RowError,
} from "./import-logic";
import { TypeSelect, type ImportType } from "./type-select";

const MODAL_CLASS =
  "max-w-[1180px]! max-mobile:fixed max-mobile:inset-0 max-mobile:h-full max-mobile:max-h-none max-mobile:max-w-none! max-mobile:rounded-none max-mobile:border-0";

export type ImportDialogProps = {
  templates: ReadonlyArray<{ id: string; name: string }>;
  /** "version" presets the template picked in the drawer. */
  initial: { mode: "new" } | { mode: "version"; templateId: string };
  onClose: () => void;
  onSaved: (templateId: string, versionNo: number) => void;
  onOpenTemplate: (templateId: string) => void;
};

type Failure = { message: string; existingId?: string };

function failureOf(error: unknown): { failure: Failure; slug: string; errors: RowError[] } {
  if (error instanceof ApiProblemError) {
    const problem = error.problem as ProblemWithExtensions;
    const m = problemMessage(problem);
    return {
      failure: { message: m.message, ...(m.existingId ? { existingId: m.existingId } : {}) },
      slug: problemSlug(problem.type),
      errors: ((problem.errors ?? []) as Array<{ path: string; message: string; key?: string }>).map((e) => ({ path: e.path, message: e.message, ...(e.key ? { key: e.key } : {}) })),
    };
  }
  return { failure: { message: "Hệ thống đang bận, thử lại sau." }, slug: "", errors: [] };
}

export function ImportDialog({ templates, initial, onClose, onSaved, onOpenTemplate }: ImportDialogProps) {
  const queryClient = useQueryClient();
  const keeper = useIdempotencyKeeper();
  const [mode, setMode] = useState<"new" | "version">(initial.mode);
  const [templateId, setTemplateId] = useState(initial.mode === "version" ? initial.templateId : (templates[0]?.id ?? ""));
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ImportType>("contract");
  const [linesTable, setLinesTable] = useState<number | undefined>(undefined);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const baseTemplateId = mode === "version" ? templateId : undefined;
  const step = preview ? 2 : 1;
  const { byKey, general } = errorsByRow(errors);

  async function read(opts: { linesTable?: number; keepEdits: boolean }) {
    if (!file) return;
    setLoading(true);
    setFailure(null);
    try {
      const next = await previewDocx(file, { ...(baseTemplateId ? { templateId: baseTemplateId } : {}), ...(opts.linesTable !== undefined ? { linesTable: opts.linesTable } : {}) });
      setPreview(next);
      setRows((prev) => (opts.keepEdits ? mergeRows(prev, next) : rowsFromPreview(next)));
      setErrors(next.check_errors.map((e) => ({ path: e.path, message: e.message, ...(e.key ? { key: e.key } : {}) })));
      setLinesTable(opts.linesTable);
    } catch (error) {
      setFailure(failureOf(error).failure);
    } finally {
      setLoading(false);
    }
  }

  function chooseFile(next: File | null) {
    setFile(next);
    if (next && mode === "new") setName(templateNameFromFile(next.name));
  }

  async function save() {
    if (!file || !preview || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      let saved;
      if (mode === "new") {
        const body = createBody({ type, name, fileName: file.name, preview, rows });
        saved = await createTemplate(body, keeper.keyFor(JSON.stringify(body)));
      } else {
        const body = versionBody({ fileName: file.name, preview, rows });
        saved = await createTemplateVersion(templateId, body, keeper.keyFor(`${templateId}:${JSON.stringify(body)}`));
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["templates"] }), queryClient.invalidateQueries({ queryKey: ["template", saved.id] })]);
      onSaved(saved.id, saved.version.version_no);
    } catch (error) {
      const { failure: f, slug, errors: serverErrors } = failureOf(error);
      if (slug === "duplicate") {
        setFailure({ message: "Tên mẫu đã có", ...(f.existingId ? { existingId: f.existingId } : {}) });
      } else if (slug === "stale") {
        setFailure({ message: "Mẫu vừa có phiên bản mới, đọc lại" });
        setSaving(false);
        await read({ ...(linesTable !== undefined ? { linesTable } : {}), keepEdits: true });
        return;
      } else if (slug === "template-check-failed") {
        setErrors(serverErrors);
        setFailure({ message: f.message });
      } else {
        setFailure(f);
      }
    } finally {
      setSaving(false);
    }
  }

  function edit(key: string, patch: Parameters<typeof touchRow>[2]) {
    setRows((prev) => touchRow(prev, key, patch));
    setErrors((prev) => unresolvedErrors(prev, new Set([key])));
  }

  const nameMissing = mode === "new" && name.trim() === "";
  const canRead = file !== null && !loading && !nameMissing && (mode === "new" || templateId !== "");

  const footer =
    step === 1 ? (
      <>
        <Button variant="secondary" onClick={onClose}>
          Hủy
        </Button>
        <Button onClick={() => void read({ keepEdits: false })} disabled={!canRead} loading={loading}>
          Đọc file
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            setPreview(null);
            setFailure(null);
          }}
        >
          Chọn file khác
        </Button>
        <Button onClick={() => void save()} disabled={errors.length > 0 || loading} loading={saving}>
          Lưu
        </Button>
      </>
    );

  return (
    <Modal open title="Nhập mẫu từ Word" onClose={onClose} footer={footer} className={MODAL_CLASS}>
      <div className="grid gap-s4">
        {failure ? (
          <Alert tone="danger">
            {failure.message}
            {failure.existingId ? (
              <>
                {" "}
                <button type="button" className="font-semibold underline" onClick={() => onOpenTemplate(failure.existingId as string)}>
                  Mở mẫu đó
                </button>
              </>
            ) : null}
          </Alert>
        ) : null}

        {step === 1 ? (
          <div className="grid max-w-[560px] gap-s4">
            <fieldset className="grid gap-s2">
              <legend className="mb-s2 text-md font-semibold text-body">Nhập vào</legend>
              <label className="flex min-h-[var(--row-h)] items-center gap-s3 text-md text-body">
                <input type="radio" name="import-mode" checked={mode === "new"} onChange={() => setMode("new")} />
                Mẫu mới
              </label>
              <label className="flex min-h-[var(--row-h)] items-center gap-s3 text-md text-body">
                <input type="radio" name="import-mode" checked={mode === "version"} disabled={templates.length === 0} onChange={() => setMode("version")} />
                Phiên bản mới của mẫu
              </label>
              {mode === "version" ? (
                <div className="grid gap-s2">
                  <label htmlFor="import-template" className="text-md font-semibold leading-head text-body">
                    Mẫu
                  </label>
                  <select id="import-template" className={SELECT_CLASS} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </fieldset>

            <Field label="File Word (.docx)" type="file" accept=".docx" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />

            {mode === "new" ? (
              <>
                <Field label="Tên mẫu" value={name} onChange={(e) => setName(e.target.value)} />
                <TypeSelect value={type} onChange={setType} />
              </>
            ) : null}

            {loading ? (
              <div className="grid gap-s2" aria-busy="true" aria-label="Đang đọc file">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-row w-full" />
                ))}
              </div>
            ) : null}
          </div>
        ) : preview ? (
          <div className="grid gap-s4">
            <div className="grid gap-s2">
              <h3 className="text-lg font-bold leading-head text-strong">Đã có {rows.length} trường</h3>
              {preview.removed.length > 0 ? (
                <div data-testid="import-removed" className="grid gap-s1 border border-line bg-sunken px-s4 py-s3 text-md text-body">
                  <p className="font-semibold text-strong">Đã bỏ</p>
                  <ul className="grid gap-s1">
                    {preview.removed.map((r, i) => (
                      <li key={i} className="text-wrap-pretty">
                        Ghi chú nội bộ: {r.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.warnings.length > 0 ? (
                <div data-testid="import-warnings" className="grid gap-s1 border border-line bg-sunken px-s4 py-s3 text-md text-body">
                  <p className="font-semibold text-strong">Cảnh báo</p>
                  <ul className="grid gap-s1">
                    {preview.warnings.map((w) => (
                      <li key={w.code} className="text-wrap-pretty">
                        {w.message} ×{w.count}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {general.map((message) => (
                <Alert key={message} tone="danger">
                  {message}
                </Alert>
              ))}
              {preview.tables
                .filter((t) => t.placeholder_keys.length > 0)
                .map((t) => (
                  <div key={t.index} data-testid="import-table" className="flex flex-wrap items-center justify-between gap-s3 border border-line px-s4 py-s3">
                    <p className="text-md text-body">
                      Bảng {t.index + 1} ({t.rows} dòng × {t.cols} cột) có trường: {t.placeholder_keys.join(", ")}
                    </p>
                    <Button variant="secondary" disabled={loading} onClick={() => void read({ linesTable: t.index, keepEdits: true })}>
                      Đây là bảng dòng hàng
                    </Button>
                  </div>
                ))}
            </div>

            <div className="grid items-start gap-s4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <iframe
                title="Xem trước mẫu"
                sandbox="allow-same-origin"
                srcDoc={previewDocument(preview.body)}
                className="h-[420px] w-full rounded-r2 border border-line bg-surface md:h-[60vh]"
              />
              {loading ? (
                <div className="grid gap-s2" aria-busy="true">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-row w-full" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <p className="border border-dashed border-line-strong px-s4 py-s5 text-center text-md text-muted">File không có trường nào</p>
              ) : (
                <FieldTable rows={rows} sources={preview.sources} errorsByKey={byKey} onChange={edit} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
