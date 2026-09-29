import { useState } from "react";
import { Alert, Button, Field, Modal, Skeleton } from "../../ui";
import { ApiProblemError, queryClient } from "../../lib/client";
import { problemMessage } from "../../lib/problem-messages";
import {
  customerToForm,
  emptyCustomerForm,
  toCustomerPayload,
  useCreateCustomer,
  useCustomer,
  useUpdateCustomer,
  type Customer,
  type CustomerFormValues,
} from "./api";
import { customerError } from "./errors";

type CreateModalProps = {
  mode: "create";
  idempotencyKey: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Called with the customer to use: the new one, or the existing one on a duplicate ("Dùng khách này"). */
  onCreated?: (customer: Customer) => void;
};

type EditModalProps = {
  mode: "edit";
  customer: Customer;
  onClose: () => void;
  onSaved: (message: string) => void;
};

export type CustomerModalProps = CreateModalProps | EditModalProps;

type FieldKey = keyof CustomerFormValues;

const modalClassName = "max-mobile:fixed max-mobile:inset-0 max-mobile:h-full max-mobile:max-h-none max-mobile:max-w-none max-mobile:rounded-none max-mobile:border-0";

export function CustomerModal(props: CustomerModalProps) {
  const { mode, onClose, onSaved } = props;
  const initialCustomer = mode === "edit" ? props.customer : undefined;
  const [form, setForm] = useState<CustomerFormValues>(() => (initialCustomer ? customerToForm(initialCustomer) : emptyCustomerForm()));
  const [version, setVersion] = useState(initialCustomer?.version ?? 0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<{ message: string; requestId?: string } | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | undefined>();
  const [showExisting, setShowExisting] = useState(false);
  const [stale, setStale] = useState(false);

  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const existingCustomer = useCustomer(duplicateId);
  const latestCustomer = useCustomer(initialCustomer?.id, mode === "edit" && stale);
  const isPending = createCustomer.isPending || updateCustomer.isPending;

  function changeField(field: FieldKey, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmitError(null);
    if (duplicateId) {
      setDuplicateId(undefined);
      setShowExisting(false);
    }
  }

  function handleFailure(error: unknown) {
    const translated = customerError(error);
    setFieldErrors(translated.fieldErrors);
    if (translated.forbidden) void queryClient.invalidateQueries({ queryKey: ["me"] });

    if (translated.slug === "duplicate" && translated.existingId) {
      setDuplicateId(translated.existingId);
      setShowExisting(false);
      setSubmitError(null);
      return;
    }

    if (translated.slug === "stale") {
      setStale(true);
      setSubmitError(null);
      return;
    }

    setSubmitError({ message: translated.message, ...(translated.requestId ? { requestId: translated.requestId } : {}) });
  }

  async function submit() {
    if (isPending || (mode === "edit" && stale)) return;
    if (!form.name.trim()) {
      setFieldErrors({ name: "Tên khách hàng là bắt buộc" });
      return;
    }

    setSubmitError(null);
    setFieldErrors({});

    try {
      const payload = toCustomerPayload(form);
      if (mode === "create") {
        const created = await createCustomer.mutateAsync({ body: payload, idempotencyKey: props.idempotencyKey });
        props.onCreated?.(created);
        onSaved("Đã thêm khách");
      } else {
        await updateCustomer.mutateAsync({
          id: props.customer.id,
          body: { ...payload, expected_version: version },
        });
        onSaved("Đã lưu");
      }
    } catch (error) {
      handleFailure(error);
    }
  }

  async function loadLatest() {
    if (mode !== "edit") return;
    try {
      const result = await latestCustomer.refetch();
      if (!result.data) {
        if (result.error) handleFailure(result.error);
        return;
      }
      setForm(customerToForm(result.data));
      setVersion(result.data.version);
      setStale(false);
      setFieldErrors({});
      setSubmitError(null);
    } catch (error) {
      handleFailure(error);
    }
  }

  const existingName = existingCustomer.data?.name;
  const onUseExisting = mode === "create" ? props.onCreated : undefined;
  const existingData = existingCustomer.data;
  const title = mode === "create" ? "Thêm khách" : "Sửa khách";

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      className={modalClassName}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>Hủy</Button>
          <Button type="button" loading={isPending} disabled={stale} onClick={() => void submit()}>Lưu</Button>
        </>
      }
    >
      <form
        className="grid gap-s4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {duplicateId ? (
          <DuplicateNotice
            existingName={existingName}
            onView={() => {
              setShowExisting(true);
              void existingCustomer.refetch();
            }}
            {...(onUseExisting && existingData
              ? { onUse: () => { onUseExisting(existingData); onSaved("Đã chọn khách"); } }
              : {})}
          />
        ) : null}

        {stale ? (
          <Alert tone="danger">
            <div className="grid gap-s3">
              <p>Người khác vừa sửa khách này</p>
              <Button type="button" variant="secondary" className="justify-self-start" loading={latestCustomer.isFetching} onClick={() => void loadLatest()}>
                Tải bản mới
              </Button>
            </div>
          </Alert>
        ) : null}

        {showExisting ? <ExistingCustomer customer={existingCustomer.data} loading={existingCustomer.isPending} error={existingCustomer.error} /> : null}

        <Field
          id="customer-name"
          label="Tên khách hàng"
          name="name"
          value={form.name}
          onChange={(event) => changeField("name", event.target.value)}
          error={fieldErrors.name}
          required
          autoComplete="organization"
          data-autofocus
        />
        <Field
          id="customer-contact-person"
          label="Người đại diện"
          name="contact_person"
          value={form.contact_person}
          onChange={(event) => changeField("contact_person", event.target.value)}
          error={fieldErrors.contact_person}
          autoComplete="name"
        />
        <Field
          id="customer-tax-code"
          label="Mã số thuế"
          name="tax_code"
          value={form.tax_code}
          onChange={(event) => changeField("tax_code", event.target.value)}
          error={fieldErrors.tax_code}
          inputMode="numeric"
        />
        <Field
          id="customer-phone"
          label="Số điện thoại"
          name="phone"
          value={form.phone}
          onChange={(event) => changeField("phone", event.target.value)}
          error={fieldErrors.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
        />
        <Field
          id="customer-email"
          label="Email"
          name="email"
          value={form.email}
          onChange={(event) => changeField("email", event.target.value)}
          error={fieldErrors.email}
          type="email"
          autoComplete="email"
        />
        <Field
          id="customer-address"
          label="Địa chỉ"
          name="address"
          value={form.address}
          onChange={(event) => changeField("address", event.target.value)}
          error={fieldErrors.address}
          autoComplete="street-address"
        />

        {submitError ? (
          <Alert tone="danger">
            <p>{submitError.message}</p>
            {submitError.requestId ? <p className="mt-s1 font-mono text-sm">Mã hỗ trợ: {submitError.requestId}</p> : null}
          </Alert>
        ) : null}
      </form>
    </Modal>
  );
}

export function DuplicateNotice({ existingName, onView, onUse }: { existingName: string | undefined; onView: () => void; onUse?: () => void }) {
  return (
    <Alert tone="danger">
      <div className="grid gap-s3">
        <p>
          Đã có khách dùng SĐT/MST này{existingName ? `: ${existingName}` : ""}
        </p>
        <div className="flex flex-wrap gap-s3">
          <Button type="button" variant="secondary" onClick={onView}>Xem khách đó</Button>
          {onUse ? <Button type="button" onClick={onUse}>Dùng khách này</Button> : null}
        </div>
      </div>
    </Alert>
  );
}

function ExistingCustomer({ customer, loading, error }: { customer?: Customer; loading: boolean; error: unknown }) {
  if (loading) return <Skeleton className="h-[var(--row-h)]" />;
  if (!customer) {
    if (error instanceof ApiProblemError) {
      return <Alert tone="danger">{problemMessage(error.problem).message}</Alert>;
    }
    return null;
  }

  return (
    <section className="grid gap-s3 rounded-r2 bg-sunken p-s4" aria-label="Thông tin khách đã có">
      <div>
        <h3 className="truncate text-md font-semibold text-strong" title={customer.name}>{customer.name}</h3>
        <p className="text-sm text-muted">Thông tin khách đã có</p>
      </div>
      <dl className="grid gap-s2 text-md text-body">
        <CustomerDetail label="Người đại diện" value={customer.contact_person} />
        <CustomerDetail label="Mã số thuế" value={customer.tax_code} />
        <CustomerDetail label="Số điện thoại" value={customer.phone} />
        <CustomerDetail label="Email" value={customer.email} />
        <CustomerDetail label="Địa chỉ" value={customer.address} />
      </dl>
    </section>
  );
}

function CustomerDetail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-s1">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words">{value || "Chưa cập nhật"}</dd>
    </div>
  );
}
