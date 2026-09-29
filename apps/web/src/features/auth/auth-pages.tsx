import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMe, type Me } from "../../app/me";
import { visibleNavItems } from "../../app/nav";
import {
  ApiProblemError,
  client,
  isClientError,
} from "../../lib/client";
import {
  loginProblemMessage,
  networkProblemMessage,
  problemMessage,
  type ProblemMessage,
} from "../../lib/problem-messages";
import { Alert, Button, Field, Skeleton } from "../../ui";
import type { Problem } from "@runway/client";
import { safeNext } from "./safe-next";

const ACTIVATION_EXPIRED_MESSAGE = "Link đã hết hạn hoặc đã dùng — nhờ Giám đốc tạo lại link.";

type FormNotice = Pick<ProblemMessage, "message" | "fieldErrors" | "requestId">;

function firstAllowedPath(user: Me): string {
  return visibleNavItems(user)[0]?.to ?? "/phan-quyen";
}

function noticeFromProblem(problem: Problem, labels: Record<string, string> = {}): FormNotice {
  return problemMessage(problem, labels);
}

function noticeFromError(error: unknown): FormNotice {
  if (error instanceof ApiProblemError) return noticeFromProblem(error.problem);
  if (isClientError(error)) return { message: networkProblemMessage(), fieldErrors: {} };
  return { message: networkProblemMessage(), fieldErrors: {} };
}

function Notice({ notice }: { notice: FormNotice }) {
  return (
    <Alert tone="danger">
      <p>{notice.message}</p>
      {notice.requestId ? <p className="mt-s1 font-mono text-sm">Mã hỗ trợ: {notice.requestId}</p> : null}
    </Alert>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-s2">
      <div className="grid h-s6 w-s6 shrink-0 place-items-center rounded-r2 bg-accent text-lg font-bold text-surface" aria-hidden="true">
        H
      </div>
      <div>
        <div className="text-md font-semibold text-strong">Hợp đồng</div>
        <div className="font-mono text-sm text-faint">nội bộ · của bạn</div>
      </div>
    </div>
  );
}

function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-app p-s4">
      <section className="grid w-full max-w-[var(--drawer-w)] gap-s5 rounded-r3 border border-line bg-surface p-s6 max-mobile:p-s5">
        <div className="grid gap-s5">
          <Brand />
          <div className="grid gap-s2">
            <h1 className="text-2xl font-bold leading-head text-strong">{title}</h1>
            <p className="text-md text-muted text-wrap-pretty">{description}</p>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}

function AuthLoading({ title = "Đang kiểm tra phiên" }: { title?: string }) {
  return (
    <AuthFrame title={title} description="Một chút thôi, mình đang chuẩn bị không gian làm việc của bạn.">
      <div className="grid gap-s3" aria-busy="true" aria-label={title}>
        <Skeleton className="h-[var(--row-h)] w-full" />
        <Skeleton className="h-[var(--row-h)] w-full" />
        <Skeleton className="h-[var(--row-h)] w-1/3" />
      </div>
    </AuthFrame>
  );
}

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const meQuery = useMe();
  const destination = safeNext(new URLSearchParams(location.search).get("next"));
  const redirected = useRef(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!meQuery.data || redirected.current) return;
    redirected.current = true;
    void navigate(destination ?? firstAllowedPath(meQuery.data), { replace: true });
  }, [destination, meQuery.data, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setSubmitting(true);

    try {
      const result = await client.login({ email: email.trim(), password });
      if (!result.ok) {
        setNotice(
          result.status === 401 || result.status === 403 || result.status === 429
            ? { message: loginProblemMessage(result.status), fieldErrors: {} }
            : noticeFromProblem(result.problem, { email: "Email", password: "Mật khẩu" }),
        );
        return;
      }

      const meResult = await meQuery.refetch();
      if (!meResult.data) {
        setNotice(noticeFromError(meResult.error));
      }
    } catch (error) {
      setNotice(noticeFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (meQuery.isPending || meQuery.data) return <AuthLoading />;

  return (
    <AuthFrame title="Đăng nhập" description="Đăng nhập để tiếp tục vào không gian hợp đồng nội bộ.">
      <form className="grid gap-s4" onSubmit={(event) => void handleSubmit(event)}>
        {notice ? <Notice notice={notice} /> : null}
        <Field
          id="login-email"
          name="email"
          type="email"
          label="Email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Field
          id="login-password"
          name="password"
          type="password"
          label="Mật khẩu"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Button type="submit" loading={submitting}>
          Đăng nhập
        </Button>
      </form>
    </AuthFrame>
  );
}

function readAndRemoveActivationToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return token;
}

export function ActivatePage() {
  const navigate = useNavigate();
  const tokenRead = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [activated, setActivated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (tokenRead.current) return;
    tokenRead.current = true;
    setToken(readAndRemoveActivationToken());
    setTokenReady(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    if (!token) {
      setNotice({ message: ACTIVATION_EXPIRED_MESSAGE, fieldErrors: {} });
      return;
    }
    if (password !== passwordConfirmation) {
      setNotice({
        message: "Hai mật khẩu chưa khớp.",
        fieldErrors: { password_confirmation: "Mật khẩu nhập lại chưa khớp." },
      });
      return;
    }

    setSubmitting(true);
    try {
      const response = await client.typed.POST("/auth/activate", {
        body: { token, password },
      });
      if (response.response.status === 204) {
        setActivated(true);
        return;
      }
      if (response.response.status === 400) {
        setNotice({ message: ACTIVATION_EXPIRED_MESSAGE, fieldErrors: {} });
        return;
      }
      if (response.error) {
        setNotice(
          noticeFromProblem(response.error as Problem, {
            token: "Liên kết kích hoạt",
            password: "Mật khẩu",
          }),
        );
        return;
      }
      setNotice({ message: networkProblemMessage(), fieldErrors: {} });
    } catch (error) {
      setNotice(noticeFromError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (!tokenReady) return <AuthLoading title="Đang mở liên kết kích hoạt" />;

  if (activated) {
    return (
      <AuthFrame title="Đã kích hoạt" description="Tài khoản của bạn đã sẵn sàng. Hãy đăng nhập để tiếp tục.">
        <div className="grid gap-s4">
          <Alert tone="success">Đã kích hoạt</Alert>
          <Button type="button" onClick={() => void navigate("/login", { replace: true })}>
            Đăng nhập
          </Button>
        </div>
      </AuthFrame>
    );
  }

  if (!token) {
    return (
      <AuthFrame title="Kích hoạt tài khoản" description="Liên kết này không còn dùng được.">
        <div className="grid gap-s4">
          <Alert tone="danger">{ACTIVATION_EXPIRED_MESSAGE}</Alert>
          <Button type="button" variant="secondary" onClick={() => void navigate("/login", { replace: true })}>
            Về đăng nhập
          </Button>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Kích hoạt tài khoản" description="Đặt mật khẩu để bắt đầu sử dụng không gian hợp đồng nội bộ.">
      <form className="grid gap-s4" onSubmit={(event) => void handleSubmit(event)}>
        {notice ? <Notice notice={notice} /> : null}
        <Field
          id="activate-password"
          name="password"
          type="password"
          label="Mật khẩu mới"
          hint="Ít nhất 12 ký tự."
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={notice?.fieldErrors.password}
          required
        />
        <Field
          id="activate-password-confirmation"
          name="password_confirmation"
          type="password"
          label="Nhập lại mật khẩu"
          autoComplete="new-password"
          value={passwordConfirmation}
          onChange={(event) => setPasswordConfirmation(event.target.value)}
          error={notice?.fieldErrors.password_confirmation}
          required
        />
        <Button type="submit" loading={submitting}>
          Kích hoạt tài khoản
        </Button>
      </form>
    </AuthFrame>
  );
}
