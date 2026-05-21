import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import logo from "@/assets/logo.jpeg";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Nurses Rota" },
      {
        name: "description",
        content:
          "Sign in to Nurses Rota to manage nursing schedules, wards and staff for Iwosan Lagoon Hospitals.",
      },
      { property: "og:title", content: "Sign in — Nurses Rota" },
      {
        property: "og:description",
        content: "Secure access for Lagoon Hospitals nursing staff and administrators.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
        navigate({ to: "/" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back");
        navigate({ to: "/" });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-white grid place-items-center overflow-hidden">
            <img
              src={logo}
              alt="Iwosan Lagoon Hospitals"
              className="h-full w-full object-contain"
            />
          </div>
          <div>
            <p className="font-bold">Nurses Rota</p>
            <p className="text-xs text-sidebar-foreground/60">Iwosan Lagoon Hospitals</p>
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">Safer staffing, automated.</h1>
          <p className="mt-4 text-sidebar-foreground/70 max-w-md">
            Automated rota generation, ward safety rules, leave management and a layered approval
            workflow — built for the nursing department.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">© Iwosan Lagoon Hospitals</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="h-12 w-12 rounded-lg bg-white grid place-items-center overflow-hidden border">
              <img
                src={logo}
                alt="Iwosan Lagoon Hospitals"
                className="h-full w-full object-contain"
              />
            </div>
            <p className="font-bold text-lg">Nurses Rota</p>
          </div>

          <h2 className="text-2xl font-bold">{mode === "login" ? "Sign in" : "Create account"}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "login"
              ? "Enter your credentials to continue."
              : "New staff start as Nurse — an admin can elevate your role."}
          </p>

          <form onSubmit={submit} className="space-y-4 mt-6">
            {mode === "signup" && (
              <div>
                <label htmlFor="login-fullname" className="text-sm font-medium">
                  Full name
                </label>
                <input
                  id="login-fullname"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            <div>
              <label htmlFor="login-email" className="text-sm font-medium">
                Email
              </label>
              <input
                id="login-email"
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {mode === "login" ? (
              <div>
                <label htmlFor="login-password-current" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="login-password-current"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="login-password-new" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="login-password-new"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            <button
              disabled={busy}
              type="submit"
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="text-sm text-muted-foreground mt-6 text-center">
            {mode === "login" ? "No account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
              className="text-primary hover:underline font-medium"
            >
              {mode === "login" ? "Create one" : "Sign in"}
            </button>
          </p>

          <p className="text-xs text-muted-foreground mt-8 text-center">
            <Link to="/" className="hover:underline">
              Back to app
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
