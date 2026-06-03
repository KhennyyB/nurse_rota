import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import logo from "@/assets/logo.jpeg";
import { toast } from "sonner";
import {
  rememberSelectedRole,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  selectedRoleStorageKey,
  useAuth,
  type AppRole,
} from "@/lib/auth-context";

const APP_ROLES: AppRole[] = ["admin", "cno", "chief_matron", "head_nurse", "hr_admin", "nurse"];

function toAppRoles(rawRoles: unknown): AppRole[] {
  if (!Array.isArray(rawRoles)) return [];
  return rawRoles.filter((role): role is AppRole => APP_ROLES.includes(role as AppRole));
}

async function getCurrentRoles() {
  const { data, error } = await supabase.rpc("get_my_roles");
  if (error) throw error;
  return toAppRoles(data);
}

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;

    const roles = await getCurrentRoles();
    const stored =
      typeof sessionStorage === "undefined"
        ? null
        : (sessionStorage.getItem(selectedRoleStorageKey(data.session.user.id)) as AppRole | null);

    if (roles.length > 1 && (!stored || !roles.includes(stored))) return;
    throw redirect({ to: "/" });
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
  const { user, roles, needsRoleSelection, selectRole } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleOptions, setRoleOptions] = useState<AppRole[]>([]);
  const [selectedRole, setSelectedRole] = useState<AppRole | "">("");
  const [signedInUserId, setSignedInUserId] = useState<string | null>(null);

  const isChoosingRole = roleOptions.length > 1;

  useEffect(() => {
    if (!needsRoleSelection || roles.length <= 1) return;
    setRoleOptions(roles);
    setSelectedRole((current) => (current && roles.includes(current) ? current : roles[0]));
    setSignedInUserId(user?.id ?? null);
  }, [needsRoleSelection, roles, user?.id]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isChoosingRole) {
      continueWithRole();
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const userId = data.user?.id;
      const nextRoles = await getCurrentRoles();

      if (userId && nextRoles.length > 1) {
        sessionStorage.removeItem(selectedRoleStorageKey(userId));
        setSignedInUserId(userId);
        setRoleOptions(nextRoles);
        setSelectedRole(nextRoles[0]);
        toast.success("Select a role to continue");
        return;
      }

      if (userId && nextRoles.length === 1) {
        rememberSelectedRole(userId, nextRoles[0]);
        selectRole(nextRoles[0]);
      }

      toast.success("Welcome back");
      navigate({ to: "/" });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  function continueWithRole() {
    if (!selectedRole) {
      toast.error("Select a role to continue");
      return;
    }

    const userId = signedInUserId ?? user?.id;
    if (userId) rememberSelectedRole(userId, selectedRole);
    selectRole(selectedRole);
    toast.success(`Signed in as ${ROLE_LABELS[selectedRole]}`);
    navigate({ to: "/" });
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

          <h2 className="text-2xl font-bold">{isChoosingRole ? "Choose your role" : "Sign in"}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {isChoosingRole
              ? "Select the role you want to use for this session."
              : "Enter your credentials to continue."}
          </p>

          <form onSubmit={submit} className="space-y-4 mt-6">
            {isChoosingRole ? (
              <div>
                <label htmlFor="login-role" className="text-sm font-medium">
                  Login role
                </label>
                <select
                  id="login-role"
                  required
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as AppRole)}
                  className="mt-1 w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                {selectedRole && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ROLE_DESCRIPTIONS[selectedRole]}
                  </p>
                )}
              </div>
            ) : (
              <>
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
                <div>
                  <label htmlFor="login-password" className="text-sm font-medium">
                    Password
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full h-10 px-3 rounded-md border bg-card text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </>
            )}
            <button
              disabled={busy}
              type="submit"
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isChoosingRole ? "Open dashboard" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
