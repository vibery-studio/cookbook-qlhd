import { useState } from "react";
import { Button, Field, Modal } from "../../ui";

export type ConfirmSpec = {
  message: string;
  /** Show the "Lý do" field; `reasonRequired` refuses an empty one. */
  askReason?: boolean;
  reasonRequired?: boolean;
  danger?: boolean;
  /** Label of the confirm button (default "Xác nhận"). */
  confirmLabel?: string;
  cancelLabel?: string;
};

/** The single "Xác nhận" dialog for reject / issue / void / withdraw / delete. */
export function ConfirmDialog({
  spec,
  pending,
  onCancel,
  onConfirm,
}: {
  spec: ConfirmSpec;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();

  function submit() {
    if (pending) return;
    const trimmed = reason.trim();
    if (spec.reasonRequired && trimmed === "") {
      setError("Nhập lý do.");
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <Modal
      open
      title="Xác nhận"
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>{spec.cancelLabel ?? "Không"}</Button>
          <Button type="button" variant={spec.danger ? "danger" : "primary"} loading={pending} onClick={submit}>{spec.confirmLabel ?? "Xác nhận"}</Button>
        </>
      }
    >
      <form
        className="grid gap-s4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="text-md text-body text-wrap-pretty">{spec.message}</p>
        {spec.askReason ? (
          <Field
            id="confirm-reason"
            label="Lý do"
            name="reason"
            value={reason}
            required={spec.reasonRequired}
            data-autofocus
            autoComplete="off"
            onChange={(event) => {
              setReason(event.target.value);
              setError(undefined);
            }}
            {...(error ? { error } : {})}
          />
        ) : null}
      </form>
    </Modal>
  );
}
