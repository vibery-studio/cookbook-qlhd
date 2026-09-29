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
  usePriceListCodes,
  useTemplate,
  useTemplates,
  type Contract,
  type TemplateField,
} from "./api";
import { CustomerCombobox, type PickedCustomer } from "./customer-combobox";
import { Dialog, DialogHeader } from "./dialog";
import { parseSnapshot } from "./snapshot";
import {
  VALUE_LABELS,
  activeKeys,
  buildValues,
  emptyForm,
  formFromInputs,
  isValueKey,
  requiredKeys,
  type FormState,
  type ValueKey,
} from "./values";

export type ContractFormProps =
  | { mode: "create"; templateId?: string; onClose: () => void; onCreated: (contract: Contract) => void }
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

  const templates = useTemplates();
  const [templateId, setTemplateId] = useState<string>(props.mode === "create" ? (props.templateId ?? "") : (editing?.template_id ?? ""));
  useEffect(() => {
    // one template only: nothing to choose
    if (props.mode === "create" && templateId === "" && templates.data?.length === 1) setTemplateId(templates.data[0]?.id ?? "");
  }, [props.mode, templateId, templates.data]);
  const template = useTemplate(templateId || undefined);
  const fields: TemplateField[] = useMemo(() => template.data?.version.fields ?? [], [template.data]);
  const keys = useMemo(() => activeKeys(fields), [fields]);
  const required = useMemo(() => requiredKeys(fields), [fields]);
  const maGoiField = fields.find((f) => f.key === "ma_goi");
  const priceCodes = usePriceListCodes(Boolean(maGoiField && !maGoiField.options && maGoiField.options_from));
  const packageOptions = maGoiField?.options ?? priceCodes.data ?? [];

  const [customer, setCustomer] = useState<PickedCustomer | null>(editing ? { id: editing.customer_id, name: editing.customer_name } : null);
  const [form, setForm] = useState<FormState>(() => (editing ? formFromInputs(parseSnapshot(editing.snapshot).inputs) : emptyForm()));
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

  const canAddCustomer = me.permissions.includes("contract:write");
  const setField = useCallback((key: ValueKey, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setMessage(null);
  }, []);

  function applyServerError(error: unknown) {
    const info = errorMessage(error);
    const next: Partial<Record<ValueKey | "customer" | "template", string>> = {};
    for (const [path, text] of Object.entries(info.fieldErrors)) {
      const key = path.replace(/^values\./, "");
      if (isValueKey(key)) next[key] = text;
    }
    setErrors(next);
    setStale(error instanceof ApiProblemError && problemSlug(error.problem.type) === "stale");
    setMessage(info.message);
  }

  async function submit() {
    if (pending) return;
    if (!templateId) {
      setErrors({ template: "Chọn mẫu hợp đồng" });
      setMessage("Chọn mẫu hợp đồng trước khi tạo.");
      return;
    }
    if (!customer) {
      setErrors({ customer: "Chọn khách hàng" });
      setMessage("Thiếu: Khách hàng. Chọn khách rồi tạo lại.");
      return;
    }
    const built = buildValues(form, fields);
    if (!built.ok) {
      setErrors(built.errors);
      setMessage(built.message);
      return;
    }
    setErrors({});
    setMessage(null);
    setPending(true);
    try {
      let contract: Contract;
      if (props.mode === "create") {
        const body = { template_id: templateId, customer_id: customer.id, values: built.values };
        contract = await createContract(body, keeper.keyFor(JSON.stringify(body)));
      } else {
        contract = await updateContract(props.contract.id, {
          expected_version: version,
          customer_id: customer.id,
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
    setForm(formFromInputs(parseSnapshot(result.data.snapshot).inputs));
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

  const title = props.mode === "create" ? "Tạo hợp đồng" : "Sửa hợp đồng nháp";
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
            <Row id="cf-template" label="Mẫu hợp đồng" required error={errors.template}>
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

          {loadingTemplate ? <Skeleton className="h-[calc(var(--row-h)*3)]" /> : null}
          {template.isError ? <p className="text-md text-danger">Không tải được mẫu. Đóng rồi mở lại.</p> : null}

          {keys.includes("ma_goi") && !loadingTemplate && templateId ? (
            <Row id="cf-ma_goi" label={VALUE_LABELS.ma_goi} required error={errors.ma_goi}>
              <select id="cf-ma_goi" value={form.ma_goi} onChange={(e) => setField("ma_goi", e.target.value)} className={cn(INPUT_CLASS, errors.ma_goi ? "border-danger" : "border-line-strong")}>
                <option value="">Chọn gói</option>
                {packageOptions.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
            </Row>
          ) : null}

          {keys
            .filter((k) => k !== "ma_goi")
            .map((k) => {
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
                  {...(k === "so_cua_hang" ? { hint: "Từ 1 đến 999" } : k === "giam_gia" ? { hint: "0–100, gõ 7,5 hoặc 7.5" } : {})}
                >
                  <input
                    id={id}
                    name={k}
                    type={isDate ? "date" : "text"}
                    inputMode={k === "so_cua_hang" ? "numeric" : k === "giam_gia" ? "decimal" : undefined}
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

          {auto.length > 0 && !loadingTemplate ? <p className="text-sm text-muted text-wrap-pretty">Tự điền từ khách và bảng giá: {auto.join(", ")}.</p> : null}

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
