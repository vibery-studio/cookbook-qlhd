import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "../../ui";
import { cn } from "../../lib/cn";
import { ApiProblemError } from "../../lib/client";
import { problemSlug } from "../../lib/problem-messages";
import { useIdempotencyKeeper } from "../../lib/idempotency-key";
import { useCurrentUser } from "../../app/me";
import { APPROVALS_KEY } from "../approvals";
import { CustomerFormModal } from "../customers";
import {
  CONTRACTS_KEY,
  contractKey,
  createContract,
  errorMessage,
  updateContract,
  useContract,
  usePreview,
  useProducts,
  useTemplate,
  useTemplates,
  type Contract,
  type TemplateField,
} from "./api";
import { CustomerCombobox, type PickedCustomer } from "./customer-combobox";
import { Dialog, DialogHeader } from "./dialog";
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from "./doc-type-labels";
import { FrozenLines, LineItems, type KnownProduct } from "./line-items";
import { parseSnapshot } from "./snapshot";
import { TotalsBox } from "./totals-box";
import {
  VALUE_LABELS,
  activeKeys,
  buildLines,
  buildValues,
  emptyForm,
  formFromInputs,
  isValueKey,
  newRow,
  previewBody,
  productsFor,
  requiredKeys,
  rowsFromInputs,
  type FormState,
  type LineRow,
  type LinesResult,
  type ValueKey,
} from "./values";

export type ContractFormProps =
  | { mode: "create"; templateId?: string; docType?: DocType; onClose: () => void; onCreated: (contract: Contract) => void }
  | { mode: "edit"; contract: Contract; onClose: () => void; onSaved: (contract: Contract) => void };

const INPUT_CLASS =
  "motion-colors min-h-[var(--row-h)] w-full rounded-r2 border bg-surface px-s3 text-md text-body outline-none placeholder:text-faint focus:border-accent focus:ring-3 focus:ring-accent-soft";

function Row({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-s2">
      <label htmlFor={id} className="text-md font-semibold leading-head text-body">
        {label}
        {required ? <span aria-hidden="true" className="ml-s1 text-danger">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function ContractFormModal(props: ContractFormProps) {
  const { onClose } = props;
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const keeper = useIdempotencyKeeper();
  const editing = props.mode === "edit" ? props.contract : undefined;

  // create from "+ Tạo": the type is known → only that type's templates; edit / from the templates screen: all, the type comes from the template
  const templates = useTemplates(props.mode === "create" ? props.docType : undefined);
  const [templateId, setTemplateId] = useState<string>(props.mode === "create" ? (props.templateId ?? "") : (editing?.template_id ?? ""));
  const pickedType = templates.data?.find((t) => t.id === templateId)?.type;
  const docType: DocType = editing?.type ?? (props.mode === "create" ? props.docType : undefined) ?? DOC_TYPES.find((t) => t === pickedType) ?? "contract";
  const noun = DOC_TYPE_LABEL[docType].toLocaleLowerCase("vi");
  // a child draft keeps its lines + price from the parent (SPEC-09 FR-5): lines read-only, no discount
  const parent = editing?.parent ?? null;
  const frozen = parent !== null;
  useEffect(() => {
    // one template only: nothing to choose
    if (props.mode === "create" && templateId === "" && templates.data?.length === 1) setTemplateId(templates.data[0]?.id ?? "");
  }, [props.mode, templateId, templates.data]);
  const template = useTemplate(templateId || undefined);
  const fields: TemplateField[] = useMemo(() => template.data?.version.fields ?? [], [template.data]);
  const keys = useMemo(() => activeKeys(fields, docType, { frozen }), [fields, docType, frozen]);
  const required = useMemo(() => requiredKeys(fields, docType, { frozen }), [fields, docType, frozen]);
  const goodsOnly = docType === "delivery_note";

  const [customer, setCustomer] = useState<PickedCustomer | null>(editing ? { id: editing.customer_id, name: editing.customer_name } : null);
  const [form, setForm] = useState<FormState>(() => (editing ? formFromInputs(parseSnapshot(editing.snapshot).inputs) : emptyForm()));
  const [rows, setRows] = useState<LineRow[]>(() => (editing ? rowsFromInputs(parseSnapshot(editing.snapshot).inputLines) : [newRow()]));
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [linesError, setLinesError] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState(editing?.version ?? 0);
  const [errors, setErrors] = useState<Partial<Record<ValueKey | "customer" | "template", string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [useLatest, setUseLatest] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState<string | null>(null);

  const latest = editing ? templates.data?.find((t) => t.id === editing.template_id)?.current_version : undefined;
  const pinnedVersionId = editing ? parseSnapshot(editing.snapshot).templateVersionId : null;
  const newerTemplate = latest && pinnedVersionId && latest.id !== pinnedVersionId ? latest : undefined;
  const latestContract = useContract(editing?.id ?? "", false);

  const products = useProducts();
  const productList = useMemo(
    () => ({ isPending: products.isPending, isError: products.isError, items: productsFor(docType, products.data ?? []), refetch: () => void products.refetch() }),
    [products.isPending, products.isError, products.data, products.refetch, docType],
  );
  const frozenLines = useMemo(
    () =>
      editing && frozen
        ? parseSnapshot(editing.snapshot).lines.map((l, i) => ({ key: `${l.productId}-${i}`, code: l.code, name: l.name, unit: l.unit, qty: l.qty }))
        : [],
    [editing, frozen],
  );
  const frozenNote = parent
    ? parent.type === "quote"
      ? `Giữ giá báo giá ${parent.number ?? "(nháp)"}`
      : `Giữ theo ${DOC_TYPE_LABEL[parent.type].toLocaleLowerCase("vi")} ${parent.number ?? "(nháp)"}`
    : "";
  // old drafts: names for products that are no longer on sale come from the snapshot the contract already holds
  const known = useMemo(() => {
    const m = new Map<string, KnownProduct>();
    if (editing) for (const l of parseSnapshot(editing.snapshot).lines) m.set(l.productId, { id: l.productId, code: l.code, name: l.name, unit: l.unit });
    return m;
  }, [editing]);

  // totals: POST /pricing/preview, debounced ~300 ms; an error shows its sentence and never blocks typing (DEC-13 A)
  const noMoney = goodsOnly || frozen; // PXK carries no money; a child's money is the parent's
  const wanted = useMemo(() => (noMoney ? null : previewBody(rows, form.giam_gia)), [rows, form.giam_gia, noMoney]);
  const [debounced, setDebounced] = useState(wanted);
  const wantedKey = JSON.stringify(wanted);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(wanted), 300);
    return () => clearTimeout(t);
  }, [wantedKey]);
  const preview = usePreview(debounced);
  const previewData = wanted === null ? undefined : preview.data;
  const previewError = wanted !== null && preview.isError ? errorMessage(preview.error).message : null;
  const amounts = useMemo(() => new Map((previewData?.lines ?? []).map((l) => [l.product_id, l.amount_ex_vat] as const)), [previewData]);

  const canAddCustomer = me.permissions.includes("contract:write");
  const setField = useCallback((key: ValueKey, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setMessage(null);
  }, []);

  function applyServerError(error: unknown) {
    const info = errorMessage(error, docType);
    const next: Partial<Record<ValueKey | "customer" | "template", string>> = {};
    const nextLines: Record<number, string> = {};
    let block: string | undefined;
    for (const [path, text] of Object.entries(info.fieldErrors)) {
      const row = /^lines\.(\d+)(\.|$)/.exec(path);
      if (row) nextLines[Number(row[1])] = text;
      else if (path === "lines") block = text;
      else {
        const key = path.replace(/^values\./, "");
        if (isValueKey(key)) next[key] = text;
      }
    }
    setErrors(next);
    setLineErrors(nextLines);
    setLinesError(block);
    setStale(error instanceof ApiProblemError && problemSlug(error.problem.type) === "stale");
    setMessage(info.message);
  }

  async function submit() {
    if (pending) return;
    if (!templateId) {
      setErrors({ template: `Chọn mẫu ${noun}` });
      setMessage(`Chọn mẫu ${noun} trước khi tạo.`);
      return;
    }
    if (!customer) {
      setErrors({ customer: "Chọn khách hàng" });
      setMessage("Thiếu: Khách hàng. Chọn khách rồi tạo lại.");
      return;
    }
    const built = buildValues(form, fields, docType, { frozen });
    const builtLines: LinesResult = frozen ? { ok: true, lines: [] } : buildLines(rows);
    if (!builtLines.ok || !built.ok) {
      setErrors(built.ok ? {} : built.errors);
      setLineErrors(builtLines.ok ? {} : builtLines.errors);
      setLinesError(undefined);
      setMessage(!builtLines.ok ? builtLines.message : !built.ok ? built.message : null);
      return;
    }
    setErrors({});
    setLineErrors({});
    setLinesError(undefined);
    setMessage(null);
    setPending(true);
    try {
      let contract: Contract;
      if (props.mode === "create") {
        const body = { template_id: templateId, customer_id: customer.id, lines: builtLines.lines, values: built.values };
        contract = await createContract(body, keeper.keyFor(JSON.stringify(body)));
      } else {
        contract = await updateContract(props.contract.id, {
          expected_version: version,
          // a child draft: only the hand-typed values go (lines, price and customer stay the parent's)
          ...(frozen ? {} : { customer_id: customer.id, lines: builtLines.lines }),
          values: built.values,
          ...(useLatest && newerTemplate ? { use_latest_template: true } : {}),
        });
      }
      queryClient.setQueryData(contractKey(contract.id), contract);
      void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY });
      void queryClient.invalidateQueries({ queryKey: APPROVALS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      if (props.mode === "create") props.onCreated(contract);
      else props.onSaved(contract);
    } catch (error) {
      applyServerError(error);
    } finally {
      setPending(false);
    }
  }

  async function loadLatest() {
    if (!editing) return;
    const result = await latestContract.refetch();
    if (!result.data) return;
    const snap = parseSnapshot(result.data.snapshot);
    setForm(formFromInputs(snap.inputs));
    setRows(rowsFromInputs(snap.inputLines));
    setLineErrors({});
    setLinesError(undefined);
    setCustomer({ id: result.data.customer_id, name: result.data.customer_name });
    setVersion(result.data.version);
    setStale(false);
    setMessage(null);
    setErrors({});
  }

  const guardedClose = useCallback(() => {
    if (addingCustomer) return;
    onClose();
  }, [addingCustomer, onClose]);
  const closeCustomer = useCallback(() => setAddingCustomer(null), []);

  const title = props.mode === "create" ? `Tạo ${noun}` : `Sửa ${noun} nháp`;
  const auto = fields.filter((f) => f.source !== "manual").map((f) => f.label);
  const loadingTemplate = templateId !== "" && template.isPending;

  return (
    <>
      <Dialog label={title} variant="modal" onClose={guardedClose}>
        <DialogHeader title={title} onClose={guardedClose} />
        <form
          className="shell-scroll grid min-h-0 flex-1 content-start gap-s4 overflow-y-auto px-s5 py-s5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {props.mode === "create" ? (
            <Row id="cf-template" label={`Mẫu ${noun}`} required error={errors.template}>
              <select
                id="cf-template"
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                  setErrors((e) => ({ ...e, template: undefined }));
                }}
                className={cn(INPUT_CLASS, errors.template ? "border-danger" : "border-line-strong")}
              >
                <option value="">Chọn mẫu</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Row>
          ) : null}

          {frozen ? (
            <div className="grid gap-s1">
              <span className="text-md font-semibold leading-head text-body">Khách hàng</span>
              <p className="text-md text-strong">{customer?.name}</p>
            </div>
          ) : (
            <div className="grid gap-s2">
              <CustomerCombobox
                label="Khách hàng"
                value={customer}
                invalid={Boolean(errors.customer)}
                autoFocus
                onChange={(c) => {
                  setCustomer(c);
                  setErrors((e) => ({ ...e, customer: undefined }));
                  setMessage(null);
                }}
                {...(canAddCustomer ? { onAddNew: () => setAddingCustomer(crypto.randomUUID()) } : {})}
              />
              {errors.customer ? <p className="text-sm text-danger">{errors.customer}</p> : null}
            </div>
          )}

          {loadingTemplate ? <Skeleton className="h-[calc(var(--row-h)*3)]" /> : null}
          {template.isError ? <p className="text-md text-danger">Không tải được mẫu. Đóng rồi mở lại.</p> : null}

          {!loadingTemplate && templateId && frozen ? <FrozenLines lines={frozenLines} note={frozenNote} /> : null}
          {!loadingTemplate && templateId && !frozen ? (
            <LineItems
              rows={rows}
              onChange={setRows}
              products={productList}
              known={known}
              amounts={amounts}
              rowErrors={lineErrors}
              blockError={linesError}
              showPrice={!goodsOnly}
            />
          ) : null}
          {!loadingTemplate && templateId && docType === "quote" ? <p className="text-sm text-muted">Hiệu lực 15 ngày kể từ ngày lập.</p> : null}

          {keys.map((k) => {
              if (loadingTemplate || !templateId) return null;
              const id = `cf-${k}`;
              const isDate = k === "ngay_bat_dau" || k === "ngay_bao_gia";
              return (
                <Row
                  key={k}
                  id={id}
                  label={VALUE_LABELS[k]}
                  required={required.has(k)}
                  error={errors[k]}
                  {...(k === "giam_gia" ? { hint: "0–100, gõ 7,5 hoặc 7.5" } : {})}
                >
                  <input
                    id={id}
                    name={k}
                    type={isDate ? "date" : "text"}
                    inputMode={k === "giam_gia" ? "decimal" : undefined}
                    value={form[k]}
                    autoComplete="off"
                    aria-invalid={errors[k] ? true : undefined}
                    aria-describedby={errors[k] ? `${id}-error` : undefined}
                    onChange={(e) => setField(k, e.target.value)}
                    className={cn(INPUT_CLASS, errors[k] ? "border-danger" : "border-line-strong")}
                  />
                </Row>
              );
            })}

          {!loadingTemplate && templateId && previewData ? (
            <TotalsBox
              data={{
                subtotalExVat: previewData.subtotal_ex_vat,
                discountAmount: previewData.discount_amount,
                vatGroups: previewData.vat_groups.map((g) => ({ vatRateBps: g.vat_rate_bps, vat: g.vat })),
                total: previewData.total,
              }}
              busy={preview.isFetching}
              note="Máy chủ tính lại khi lưu"
            />
          ) : null}
          {previewError ? <p className="text-sm text-danger">{previewError}</p> : null}

          {auto.length > 0 && !loadingTemplate ? <p className="text-sm text-muted text-wrap-pretty">Tự điền từ khách và dòng hàng: {auto.join(", ")}.</p> : null}

          {newerTemplate ? (
            <label className="flex min-h-[var(--row-h)] items-center gap-s3 text-md text-body">
              <input type="checkbox" checked={useLatest} onChange={(e) => setUseLatest(e.target.checked)} className="size-s4" />
              Dùng phiên bản mẫu mới nhất (v{newerTemplate.version_no})
            </label>
          ) : null}

          {message ? (
            <Alert tone="danger">
              <p>{message}</p>
              {stale ? (
                <Button type="button" variant="secondary" className="mt-s2" loading={latestContract.isFetching} onClick={() => void loadLatest()}>
                  Tải bản mới
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {/* Enter inside a field submits */}
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
        </form>
        <div className="flex flex-wrap justify-end gap-s2 border-t border-line bg-sunken px-s5 py-s4">
          <Button type="button" variant="ghost" onClick={guardedClose}>Hủy</Button>
          <Button type="button" loading={pending} disabled={stale || loadingTemplate || template.isError} onClick={() => void submit()}>
            {props.mode === "create" ? "Tạo & xem văn bản" : "Lưu"}
          </Button>
        </div>
      </Dialog>
      {addingCustomer ? (
        <CustomerFormModal
          mode="create"
          idempotencyKey={addingCustomer}
          onClose={closeCustomer}
          onSaved={closeCustomer}
          onCreated={(c) => {
            setCustomer({ id: c.id, name: c.name });
            setErrors((e) => ({ ...e, customer: undefined }));
            setMessage(null);
          }}
        />
      ) : null}
    </>
  );
}
