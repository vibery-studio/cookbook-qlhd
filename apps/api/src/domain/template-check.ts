import { ROLE_NAMES, isPermission } from "@runway/rbac";
import { LIMITS, isResolvableSource } from "./template-sources";

export type TemplateCheckCode =
  | "placeholder_without_field"
  | "required_field_without_source"
  | "unresolvable_source"
  | "policy_invalid"
  | "internal_note"
  | "html_not_allowed"
  | "too_large"
  | "unbalanced_if"
  | "all_or_none_invalid";

export interface TemplateCheckError {
  code: TemplateCheckCode;
  key?: string;
  source?: string;
  message: string;
}

export interface FieldDef {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  source?: string | null;
  [extra: string]: unknown;
}

export interface FieldRule {
  all_or_none: string[];
}

export interface TemplateCheckInput {
  body: string;
  fields: FieldDef[];
  field_rules?: FieldRule[];
  approval_policy: unknown;
}

const ALLOWED_TAGS = new Set(["p", "h1", "h2", "h3", "br", "strong", "em", "ul", "ol", "li", "table", "tr", "td", "th", "div", "span"]);
const ALLOWED_CLASSES = new Set(["center", "right", "b", "sig"]);
const KEY_RE = /^[a-z][a-z0-9_]*$/;
// Strict tag grammar: optional single class="…" attribute, nothing else. Anything that does not match is refused.
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:\s+class\s*=\s*"([^"<>]*)")?\s*(\/?)>/;
const INTERNAL_NOTE_PHRASES = ["ghi chu noi bo", "xoa truoc khi gui khach"];

const POLICY_MODES = ["none", "steps", "threshold", "combined"];
const POLICY_OPS = ["gt", "gte", "lt", "lte", "eq"];
const POLICY_VARS = ["discount_bps", "total"];

function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase();
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkHtml(body: string, push: (e: TemplateCheckError) => void): void {
  const seen = new Set<string>();
  const bad = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    push({ code: "html_not_allowed", message });
  };
  if (/javascript\s*:/i.test(body)) bad("Chữ mẫu chứa \"javascript:\", không được phép.");
  let i = body.indexOf("<");
  while (i !== -1) {
    const m = TAG_RE.exec(body.slice(i, i + 400));
    if (!m) {
      const snippet = body.slice(i, i + 30).replace(/\s+/g, " ");
      bad(`Thẻ HTML không hợp lệ hoặc không được phép (thẻ chú thích, thuộc tính, thẻ chưa đóng): "${snippet}".`);
      i = body.indexOf("<", i + 1);
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) bad(`Thẻ <${tag}> không được phép trong chữ mẫu.`);
    if (m[3] !== undefined) {
      for (const c of m[3].split(/\s+/).filter(Boolean)) {
        if (!ALLOWED_CLASSES.has(c)) bad(`Giá trị class "${c}" không nằm trong danh sách cho phép.`);
      }
    }
    i = body.indexOf("<", i + m[0].length);
  }
}

function checkPlaceholders(body: string, declared: Set<string>, push: (e: TemplateCheckError) => void): void {
  const reported = new Set<string>();
  const missing = (key: string, message: string) => {
    if (reported.has(key)) return;
    reported.add(key);
    push({ code: "placeholder_without_field", key, message });
  };
  let depth = 0;
  let unbalancedReported = false;
  const unbalanced = (message: string) => {
    if (unbalancedReported) return;
    unbalancedReported = true;
    push({ code: "unbalanced_if", message });
  };
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    last = m.index + m[0].length;
    const inner = m[1]!;
    if (inner === "/if") {
      if (depth === 0) unbalanced("Có {{/if}} thừa, không có {{#if}} tương ứng.");
      else depth--;
    } else if (inner.startsWith("#if ")) {
      const key = inner.slice(4);
      if (!KEY_RE.test(key)) missing(m[0], `Điều kiện ${m[0]} sai cú pháp (key phải là chữ thường, số, gạch dưới).`);
      else if (!declared.has(key)) missing(key, `{{#if ${key}}} dùng trường "${key}" chưa khai báo trong fields.`);
      depth++;
    } else if (KEY_RE.test(inner)) {
      if (!declared.has(inner)) missing(inner, `Placeholder {{${inner}}} không có trường "${inner}" trong fields.`);
    } else {
      missing(m[0], `Placeholder ${m[0]} sai cú pháp (key phải là chữ thường, số, gạch dưới, không có khoảng trắng).`);
      if (inner.startsWith("#if")) depth++;
    }
  }
  const tail = body.slice(last);
  const open = tail.indexOf("{{");
  if (open !== -1) missing(tail.slice(open, open + 40), "Placeholder \"{{\" không có \"}}\" đóng.");
  if (depth > 0) unbalanced(`Có ${depth} khối {{#if}} chưa đóng bằng {{/if}}.`);
}

function checkPolicy(policy: unknown, push: (e: TemplateCheckError) => void): void {
  const bad = (message: string) => push({ code: "policy_invalid", message });
  if (!isObj(policy)) return bad("approval_policy phải là một đối tượng.");
  const mode = policy.mode;
  if (typeof mode !== "string" || !POLICY_MODES.includes(mode)) {
    return bad("approval_policy.mode phải là một trong: none, steps, threshold, combined.");
  }
  let stepCount = 0;
  const checkStep = (s: unknown, where: string) => {
    if (!isObj(s)) return bad(`${where}: bước duyệt phải là một đối tượng.`);
    if (typeof s.label !== "string" || s.label.trim() === "") bad(`${where}: thiếu nhãn (label).`);
    if (typeof s.permission !== "string" || !isPermission(s.permission)) {
      bad(`${where}: quyền "${String(s.permission)}" không tồn tại.`);
    }
    if (s.role !== undefined && (typeof s.role !== "string" || !(ROLE_NAMES as readonly string[]).includes(s.role))) {
      bad(`${where}: vai trò "${JSON.stringify(s.role)}" không tồn tại.`);
    }
  };
  if (mode === "steps" || mode === "combined") {
    if (!Array.isArray(policy.steps) || policy.steps.length === 0) {
      bad(`approval_policy.steps phải có ít nhất một bước khi mode = "${mode}".`);
    } else {
      stepCount += policy.steps.length;
      policy.steps.forEach((s, i) => checkStep(s, `steps[${i}]`));
    }
  } else if (Array.isArray(policy.steps)) {
    stepCount += policy.steps.length;
  }
  if (mode === "threshold" || mode === "combined") {
    if (!Array.isArray(policy.rules) || policy.rules.length === 0) {
      bad(`approval_policy.rules phải có ít nhất một luật khi mode = "${mode}".`);
    }
  }
  if (Array.isArray(policy.rules)) {
    policy.rules.forEach((r, i) => {
      const where = `rules[${i}]`;
      if (!isObj(r) || !isObj(r.when)) return bad(`${where}: thiếu điều kiện "when".`);
      const w = r.when;
      if (typeof w.var !== "string" || !POLICY_VARS.includes(w.var)) bad(`${where}: biến "${String(w.var)}" không hợp lệ (discount_bps, total).`);
      if (typeof w.op !== "string" || !POLICY_OPS.includes(w.op)) bad(`${where}: phép so sánh "${String(w.op)}" không hợp lệ (gt, gte, lt, lte, eq).`);
      if (typeof w.value !== "number" || !Number.isFinite(w.value)) bad(`${where}: giá trị so sánh phải là số.`);
      if (!Array.isArray(r.add_steps) || r.add_steps.length === 0) {
        bad(`${where}: add_steps phải có ít nhất một bước.`);
      } else {
        stepCount += r.add_steps.length;
        r.add_steps.forEach((s, j) => checkStep(s, `${where}.add_steps[${j}]`));
      }
    });
  } else if (policy.rules !== undefined) {
    bad("approval_policy.rules phải là một mảng.");
  }
  if (stepCount > LIMITS.steps) {
    push({ code: "too_large", message: `Quy trình duyệt có ${stepCount} bước (tính cả bước thêm theo luật), tối đa ${LIMITS.steps}.` });
  }
}

/** Pure, never throws. `[]` = the version may be stored. Order is deterministic. */
export function checkTemplate(input: TemplateCheckInput): TemplateCheckError[] {
  const errors: TemplateCheckError[] = [];
  const push = (e: TemplateCheckError) => errors.push(e);
  try {
    const body = typeof input.body === "string" ? input.body : "";
    const fields = Array.isArray(input.fields) ? input.fields : [];

    // size
    const bytes = new TextEncoder().encode(body).length;
    if (bytes > LIMITS.bodyBytes) {
      push({ code: "too_large", message: `Chữ mẫu ${bytes} byte, vượt giới hạn ${LIMITS.bodyBytes} byte (64 KB).` });
    }
    if (fields.length > LIMITS.fields) {
      push({ code: "too_large", message: `Mẫu có ${fields.length} trường, tối đa ${LIMITS.fields}.` });
    }

    // body: html, internal note, placeholders/if
    checkHtml(body, push);
    const folded = fold(body);
    for (const phrase of INTERNAL_NOTE_PHRASES) {
      if (folded.includes(phrase)) {
        push({ code: "internal_note", message: "Chữ mẫu còn ghi chú nội bộ (\"Ghi chú nội bộ\" / \"xóa trước khi gửi khách\"); hãy chuyển thành approval_policy hoặc xóa." });
        break;
      }
    }
    const declared = new Set(fields.map((f) => f?.key).filter((k): k is string => typeof k === "string"));
    checkPlaceholders(body, declared, push);

    // fields: sources
    for (const f of fields) {
      if (!isObj(f)) continue;
      const key = typeof f.key === "string" ? f.key : "";
      const label = typeof f.label === "string" && f.label ? `"${f.label}" (${key})` : `"${key}"`;
      const src = f.source;
      const empty = src === undefined || src === null || src === "";
      if (empty) {
        if (f.required === true) {
          push({ code: "required_field_without_source", key, message: `Trường bắt buộc ${label} chưa có nguồn dữ liệu (source).` });
        }
      } else if (!isResolvableSource(src)) {
        push({ code: "unresolvable_source", key, source: String(src), message: `Trường ${label} có nguồn "${String(src)}" không tồn tại trong hệ thống.` });
      }
    }

    // field_rules
    (Array.isArray(input.field_rules) ? input.field_rules : []).forEach((r, i) => {
      const keys = isObj(r) ? r.all_or_none : undefined;
      if (!Array.isArray(keys) || keys.length !== 2 || keys.some((k) => typeof k !== "string")) {
        return push({ code: "all_or_none_invalid", message: `field_rules[${i}].all_or_none phải là đúng hai key trường.` });
      }
      for (const k of keys) {
        if (!declared.has(k)) {
          push({ code: "all_or_none_invalid", key: k, message: `field_rules[${i}]: trường "${k}" chưa khai báo trong fields.` });
        }
      }
      if (keys[0] === keys[1]) {
        push({ code: "all_or_none_invalid", key: keys[0], message: `field_rules[${i}]: hai key phải khác nhau.` });
      }
    });

    checkPolicy(input.approval_policy, push);
  } catch {
    push({ code: "policy_invalid", message: "Dữ liệu mẫu không đọc được." });
  }
  return errors;
}
