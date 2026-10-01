import { useState } from "react";
import { Alert, Button, EmptyState, ErrorState, Field, Modal, Skeleton } from "../../ui";
import { ConfirmDialog } from "../contracts/confirm-dialog";
import { SOD_ROLES_TEXT } from "../../lib/problem-messages";
import { pairError, useAddSodPair, useRemoveSodPair, type RoleError, type SodPairBody } from "./api";
import { groupCatalog, permissionLabel } from "./permission-labels";
import { useSodPairs, type SodPair } from "./requests";

const selectClass =
  "min-h-[var(--row-h)] w-full rounded-r2 border border-line-strong bg-surface px-s3 text-md text-body outline-none focus:border-accent focus:ring-3 focus:ring-accent-soft";

/** Tab "Cặp xung đột": two permissions no role may hold together. Declared / removed by roles:write. */
export function PairsTab({ canWrite, catalog, onOpenRole }: { canWrite: boolean; catalog: readonly string[]; onOpenRole: (id: string) => void }) {
  const query = useSodPairs();
  const remove = useRemoveSodPair();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SodPair | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addButton = canWrite ? (
    <Button type="button" onClick={() => setAdding(true)}>
      + Thêm cặp
    </Button>
  ) : null;

  async function doRemove(pair: SodPair) {
    try {
      await remove.mutateAsync({ id: pair.id });
      setError(null);
    } catch (e) {
      setError(pairError(e).message);
    }
    setRemoving(null);
  }

  return (
    <div className="grid gap-s3">
      <div className="flex flex-wrap items-center justify-between gap-s3">
        <p className="max-w-[720px] text-md text-muted text-wrap-pretty">
          Hai quyền không được nằm chung trong một vai trò — tách người làm với người kiểm.
        </p>
        {query.data && query.data.length > 0 ? addButton : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {query.isPending ? (
        <div className="grid gap-s1" aria-busy="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-row w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message="Không tải được các cặp xung đột. Thử lại sau." onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState title="Chưa có cặp xung đột nào." action={addButton} />
      ) : (
        <ul data-testid="sod-pairs" className="divide-y divide-line rounded-r3 border border-line bg-surface">
          {query.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-s3 px-s4 py-s3">
              <p className="min-w-0 text-md text-body text-wrap-pretty">
                <span className="font-medium text-strong">
                  «{permissionLabel(p.perm_a)}» ⟷ «{permissionLabel(p.perm_b)}»
                </span>
                {p.reason ? <span className="text-muted"> — {p.reason}</span> : null}
              </p>
              {canWrite ? (
                <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => setRemoving(p)}>
                  Xóa cặp
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddPairModal
          catalog={catalog}
          onClose={() => setAdding(false)}
          onOpenRole={(id) => {
            setAdding(false);
            onOpenRole(id);
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          spec={{
            message: `Xóa cặp «${permissionLabel(removing.perm_a)}» ⟷ «${permissionLabel(removing.perm_b)}»? Các vai trò hiện có không đổi.`,
            danger: true,
          }}
          pending={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void doRemove(removing)}
        />
      ) : null}
    </div>
  );
}

function PermSelect({ id, label, value, catalog, onChange }: { id: string; label: string; value: string; catalog: readonly string[]; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-s2">
      <label htmlFor={id} className="text-md font-semibold leading-head text-body">
        {label}
      </label>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Chọn quyền…</option>
        {groupCatalog(catalog).map(({ group, codes }) => (
          <optgroup key={group} label={group}>
            {codes.map((c) => (
              <option key={c} value={c}>
                {permissionLabel(c)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function AddPairModal({ catalog, onClose, onOpenRole }: { catalog: readonly string[]; onClose: () => void; onOpenRole: (id: string) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<RoleError | null>(null);
  const add = useAddSodPair();

  async function submit() {
    if (add.isPending) return;
    if (a === "" || b === "" || a === b) {
      setError({ slug: "validation", message: "Chọn hai quyền khác nhau.", fieldErrors: {} });
      return;
    }
    try {
      await add.mutateAsync({
        body: { perm_a: a as SodPairBody["perm_a"], perm_b: b as SodPairBody["perm_b"], ...(reason.trim() !== "" ? { reason: reason.trim() } : {}) },
      });
      onClose();
    } catch (e) {
      setError(pairError(e));
    }
  }

  return (
    <Modal
      open
      title="Thêm cặp xung đột"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button type="button" loading={add.isPending} onClick={() => void submit()}>
            Thêm cặp
          </Button>
        </>
      }
    >
      <form
        className="grid gap-s4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <PermSelect id="sod-a" label="Quyền thứ nhất" value={a} catalog={catalog} onChange={(v) => { setA(v); setError(null); }} />
        <PermSelect id="sod-b" label="Quyền thứ hai" value={b} catalog={catalog} onChange={(v) => { setB(v); setError(null); }} />
        <Field id="sod-reason" label="Lý do" name="reason" value={reason} maxLength={200} autoComplete="off" onChange={(e) => setReason(e.target.value)} />
        {error ? (
          <Alert tone="danger">
            {error.slug === "sod-conflict" && error.roles ? (
              <p>
                {SOD_ROLES_TEXT.prefix}
                {error.roles.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 ? ", " : ""}
                    <button type="button" className="font-semibold underline" onClick={() => onOpenRole(r.id)}>
                      {r.label}
                    </button>
                  </span>
                ))}
                {SOD_ROLES_TEXT.suffix}
              </p>
            ) : (
              <p>{error.message}</p>
            )}
          </Alert>
        ) : null}
      </form>
    </Modal>
  );
}
