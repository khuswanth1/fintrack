import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftRight, PiggyBank, Sparkles, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { ThemeToggle } from "../components/Layout.jsx";
import GoogleSignIn from "../components/GoogleSignIn.jsx";
import { Button, Input } from "../components/ui.jsx";

const PERKS = [
  { icon: Wallet, text: "Every rupee, dollar and euro in one place" },
  { icon: PiggyBank, text: "Budgets that nudge you before you overspend" },
  { icon: Sparkles, text: "AI insights on habits, subscriptions and savings" },
];

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-400 via-brand-500 to-[#f2541b] p-12 text-white lg:flex lg:flex-col">
        <span className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10" aria-hidden />
        <span className="pointer-events-none absolute -bottom-32 -left-20 size-[28rem] rounded-full bg-white/10" aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-11 place-items-center rounded-2xl bg-white text-brand-500 shadow-lg">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 16l5-5 4 3 7-8" /></svg>
          </span>
          <span className="text-2xl font-extrabold tracking-tight">FinTrack</span>
        </div>
        <div className="relative my-auto max-w-md">
          <h2 className="text-5xl leading-[1.05] font-extrabold tracking-tight text-white">Track money.<br />Not receipts.</h2>
          <p className="mt-4 text-lg font-medium text-white/85">Your spending, budgets and goals, delivered in one tidy dashboard.</p>
          <ul className="mt-10 space-y-4">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 font-semibold">
                <span className="grid size-10 place-items-center rounded-full bg-white/20 ring-1 ring-white/30"><Icon className="size-5" aria-hidden /></span>{text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs font-medium text-white/70">All demo data is fictional. Insights are budgeting guidance, not financial advice.</p>
      </aside>

      <div className="relative flex flex-col">
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-400 to-brand-600 px-6 pt-8 pb-16 text-white lg:hidden">
          <span className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-white/10" aria-hidden />
          <div className="relative flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-2xl bg-white text-brand-500"><ArrowLeftRight className="size-5" /></span>
            <span className="text-xl font-extrabold">FinTrack</span>
          </div>
          <p className="relative mt-6 text-2xl font-extrabold">Track money. Not receipts.</p>
        </div>
        <div className="absolute top-4 right-4 z-10 rounded-full bg-white/80 backdrop-blur lg:bg-transparent dark:bg-transparent"><ThemeToggle /></div>
        <div className="-mt-10 flex flex-1 flex-col items-center px-4 pb-12 lg:mt-0 lg:justify-center">
          <div className="card w-full max-w-sm p-6 sm:p-7 lg:shadow-none lg:ring-0 lg:dark:ring-0 lg:bg-transparent lg:dark:bg-transparent">
            <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
            <p className="mt-1 mb-6 text-sm text-slate-500">{subtitle}</p>
            <div className="mb-6 h-[3px] w-10 rounded-full bg-brand-500" aria-hidden />
            {children}
          </div>
          <p className="mt-5 text-sm text-slate-500">{footer}</p>
        </div>
      </div>
    </div>
  );
}

const fieldErrors = (err) => Object.fromEntries((err?.details || []).map((d) => [d.field, d.message]));

/** Google button wired to sign-in-or-sign-up; shared by both auth pages. */
function useGoogleAuth({ setBusy, setError, redirectTo }) {
  const { loginWithGoogle } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  return async (credential) => {
    setBusy(true);
    setError(null);
    try {
      const isNew = await loginWithGoogle(credential);
      if (isNew) notify("Welcome to FinTrack! Your account is ready.");
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
}

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onGoogle = useGoogleAuth({ setBusy, setError, redirectTo: location.state?.from || "/" });

  if (status === "authenticated") return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) { setError({ message: "Email and password are required" }); return; }
    setBusy(true);
    setError(null);
    try {
      await login(form.email, form.password);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your account"
      footer={<>New to FinTrack? <Link className="font-medium link" to="/register">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Email" type="email" autoComplete="email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" autoComplete="current-password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error.message}</p>}
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      </form>
      <GoogleSignIn text="signin_with" onCredential={onGoogle} onError={setError} />
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onGoogle = useGoogleAuth({ setBusy, setError, redirectTo: "/" });

  if (status === "authenticated") return <Navigate to="/" replace />;
  const errs = fieldErrors(error);
  const weak = form.password && !(form.password.length >= 8 && /[a-z]/i.test(form.password) && /\d/.test(form.password));

  const submit = async (e) => {
    e.preventDefault();
    if (weak) return;
    setBusy(true);
    setError(null);
    try {
      await register(form);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Start tracking your money in minutes"
      footer={<>Already have an account? <Link className="font-medium link" to="/login">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Full name" autoComplete="name" value={form.full_name} error={errs.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <Input label="Email" type="email" autoComplete="email" required value={form.email} error={errs.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" autoComplete="new-password" required value={form.password}
          error={errs.password || (weak ? "At least 8 characters with a letter and a number" : null)}
          hint="At least 8 characters with a letter and a number"
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && !Object.keys(errs).length && <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error.message}</p>}
        <Button type="submit" className="w-full" loading={busy}>Create account</Button>
      </form>
      <GoogleSignIn text="signup_with" onCredential={onGoogle} onError={setError} />
    </AuthShell>
  );
}
