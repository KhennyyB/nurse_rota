/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "cno" | "chief_matron" | "head_nurse" | "hr_admin" | "nurse";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  fullName: string | null;
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: AppRole[]) => boolean;
  isAdmin: boolean;
  canManageRoles: boolean;
  canDelete: boolean;
  canManageStaff: boolean;
  canApproveLeave: boolean;
  canRequestShiftSwitch: boolean;
  canApproveShiftSwitch: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [fullName, setFullName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setRoles([]);
        setFullName(null);
      }
    });

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(uid: string) {
    try {
      const [{ data: roleRows }, { data: prof }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("profiles").select("full_name").eq("id", uid).maybeSingle(),
      ]);
      setRoles((roleRows ?? []).map((r) => r.role as AppRole));
      setFullName(prof?.full_name ?? null);
    } catch {
      setRoles([]);
      setFullName(null);
    }
  }

  const hasRole = (r: AppRole) => roles.includes(r);
  const hasAnyRole = (rs: AppRole[]) => rs.some((r) => roles.includes(r));

  const value: AuthCtx = {
    user,
    session,
    roles,
    fullName,
    loading,
    hasRole,
    hasAnyRole,
    isAdmin: hasRole("admin"),
    canManageRoles: hasRole("admin"),
    canDelete: hasRole("admin"),
    canManageStaff: hasAnyRole(["admin", "cno", "chief_matron", "head_nurse", "hr_admin"]),
    canApproveLeave: hasAnyRole(["admin", "cno", "chief_matron", "head_nurse", "hr_admin"]),
    canRequestShiftSwitch: hasAnyRole(["admin", "cno"]),
    canApproveShiftSwitch: hasRole("admin"),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "System Administrator",
  cno: "Chief Nursing Officer",
  chief_matron: "Chief Matron",
  head_nurse: "Head Nurse",
  hr_admin: "HR / Admin",
  nurse: "Nurse",
};
