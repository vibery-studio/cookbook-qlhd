import { formatVietnameseMoney } from "../../lib/vn-money";
import { Pill } from "../../ui";
import type { Contract } from "./api";
import { DOC_TYPE_LABEL } from "./doc-type-labels";
import { STATUS_TONE, numberLabel, statusLabel } from "./status";

type Ref = NonNullable<Contract["parent"]>;

function RelatedRow({ doc, direction, onOpen }: { doc: Ref; direction: "parent" | "child"; onOpen: (id: string) => void }) {
  const label = DOC_TYPE_LABEL[doc.type];
  return (
    <li>
      <button
        type="button"
        data-testid="related-doc"
        onClick={() => onOpen(doc.id)}
        className="motion-colors flex min-h-[var(--row-h)] w-full flex-wrap items-center gap-x-s2 gap-y-s1 rounded-r2 border border-line bg-surface px-s3 py-s2 text-left text-md hover:bg-hover"
      >
        <span aria-hidden="true" title={direction === "parent" ? "Tài liệu gốc" : "Tài liệu con"} className="text-muted">{direction === "parent" ? "↑" : "↓"}</span>
        <span className="font-semibold text-strong">{label}</span>
        <span aria-hidden="true" className="text-faint">·</span>
        <span className="font-mono text-body">{numberLabel(doc.number, doc.status)}</span>
        <span aria-hidden="true" className="text-faint">·</span>
        <Pill tone={STATUS_TONE[doc.status]}>{statusLabel(doc.status)}</Pill>
        <span aria-hidden="true" className="text-faint">·</span>
        <span className="font-mono ml-auto text-strong">{formatVietnameseMoney(doc.total)}</span>
      </button>
    </li>
  );
}

/** "Tài liệu liên quan": the parent above (↑), the children below (↓, oldest first); a click opens that document's drawer. Nothing to show → nothing rendered. */
export function RelatedDocs({ parent, children, onOpen }: { parent: Contract["parent"]; children: Contract["children"]; onOpen: (id: string) => void }) {
  const kids = children.filter((c): c is Ref => c !== null);
  if (!parent && kids.length === 0) return null;
  return (
    <section className="grid gap-s2" data-testid="related-docs">
      <h3 className="text-md font-bold leading-head text-strong">Tài liệu liên quan</h3>
      <ul className="grid gap-s2">
        {parent ? <RelatedRow doc={parent} direction="parent" onOpen={onOpen} /> : null}
        {kids.map((c) => (
          <RelatedRow key={c.id} doc={c} direction="child" onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
