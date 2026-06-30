/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "cno" | "chief_matron" | "head_nurse" | "hr_admin" | "nurse";

const CAPABILITIES_KEY = "nurse_rota_capabilities";

function capabilityRoles(key: string, defaults: AppRole[]): AppRole[] {
  try {
    const raw = localStorage.getItem(CAPABILITIES_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as { key: string; roles: AppRole[] }[];
    return saved.find((s) => s.key === key)?.roles ?? defaults;
  } catch {
    return defaults;
  }
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  activeRole: AppRole | null;
  fullName: string | null;
  nurseFacility: string | null;
  nurseId: string | null;
  loading: boolean;
  needsRoleSelection: boolean;
  mustChangePassword: boolean;
  clearMustChangePassword: () => void;
  selectRole: (role: AppRole) => void;
  hasRole: (r: AppRole) => boolean;
  hasAnyRole: (rs: AppRole[]) => boolean;
  isAdmin: boolean;
  canManageRoles: boolean;
  canDelete: boolean;
  canManageStaff: boolean;
  canApproveLeave: boolean;
  canRequestShiftSwitch: boolean;
  canApproveShiftSwitch: boolean;
  canCreateLogin: boolean;
  canEditTargetHours: boolean;
  canPrintStaff: boolean;
  canPrintSchedule: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export const selectedRoleStorageKey = (uid: string) => `nurse_rota_role_${uid}`;

export function rememberSelectedRole(uid: string, role: AppRole) {
  sessionStorage.setItem(selectedRoleStorageKey(uid), role);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Incremented whenever capabilities change so can* values are recomputed.
  const [capabilitiesVersion, setCapabilitiesVersion] = useState(0);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [activeRole, setActiveRole] = useState<AppRole | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [nurseFacility, setNurseFacility] = useState<string | null>(null);
  const [nurseId, setNurseId] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
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
        setActiveRole(null);
        setFullName(null);
        setNurseFacility(null);
        setNurseId(null);
        setMustChangePassword(false);
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

  // Pull capability overrides from DB once on mount so every device gets the admin's settings.
  useEffect(() => {
    supabase
      .from("portal_settings")
      .select("value")
      .eq("key", "capabilities")
      .single()
      .then(({ data }) => {
        if (data?.value) {
          localStorage.setItem(
            CAPABILITIES_KEY,
            JSON.stringify(data.value as { key: string; roles: AppRole[] }[]),
          );
          setCapabilitiesVersion((v) => v + 1);
        }
      });
  }, []);

  // Re-read capabilities from localStorage whenever the permissions page fires a save event.
  useEffect(() => {
    const handler = () => setCapabilitiesVersion((v) => v + 1);
    window.addEventListener("capabilities-changed", handler);
    return () => window.removeEventListener("capabilities-changed", handler);
  }, []);

  async function loadProfile(uid: string) {
    try {
      const [{ data: roleData }, { data: profRows }, { data: profDetail }] = await Promise.all([
        supabase.rpc("get_my_roles"),
        supabase.rpc("get_my_profile"),
        supabase.from("profiles").select("must_change_password").eq("id", uid).maybeSingle(),
      ]);
      const name = (profRows as { full_name: string | null }[] | null)?.[0]?.full_name ?? null;
      const loadedRoles = ((roleData as string[]) ?? []).map((r) => r as AppRole);
      setMustChangePassword((profDetail as { must_change_password?: boolean } | null)?.must_change_password ?? false);

      setRoles(loadedRoles);
      setFullName(name);

      // Resolve active role:
      // - Single role → use it automatically (no selection needed)
      // - Multiple roles → restore from sessionStorage, or require selection
      if (loadedRoles.length === 1) {
        setActiveRole(loadedRoles[0]);
      } else if (loadedRoles.length > 1) {
        const stored = sessionStorage.getItem(selectedRoleStorageKey(uid)) as AppRole | null;
        if (stored && loadedRoles.includes(stored)) {
          setActiveRole(stored);
        } else {
          setActiveRole(null); // Triggers role selection screen
        }
      } else {
        setActiveRole(null);
      }

      if (name) {
        const { data: nurseRow } = await supabase
          .from("nurses")
          .select("id, facility")
          .eq("name", name)
          .maybeSingle();
        setNurseFacility(nurseRow?.facility ?? null);
        setNurseId(nurseRow?.id ?? null);
      } else {
        setNurseFacility(null);
        setNurseId(null);
      }
    } catch {
      setRoles([]);
      setActiveRole(null);
      setFullName(null);
      setNurseFacility(null);
      setNurseId(null);
    }
  }

  function selectRole(role: AppRole) {
    if (user) rememberSelectedRole(user.id, role);
    setActiveRole(role);
  }

  function clearMustChangePassword() {
    setMustChangePassword(false);
  }

  const ar = activeRole;
  // capabilitiesVersion read here so a change triggers recomputation of can* flags below.
  void capabilitiesVersion;
  const hasRole = (r: AppRole) => ar === r;
  const hasAnyRole = (rs: AppRole[]) => ar !== null && rs.includes(ar);
  const isInActiveRole = (...rs: AppRole[]) => ar !== null && rs.includes(ar);

  const value: AuthCtx = {
    user,
    session,
    roles,
    activeRole,
    fullName,
    nurseFacility,
    nurseId,
    loading,
    needsRoleSelection: roles.length > 1 && activeRole === null,
    mustChangePassword,
    clearMustChangePassword,
    selectRole,
    hasRole,
    hasAnyRole,
    isAdmin: ar === "admin",
    canManageRoles: ar === "admin",
    canDelete: ar === "admin",
    canManageStaff: isInActiveRole("admin", "cno", "chief_matron", "head_nurse", "hr_admin"),
    canApproveLeave: isInActiveRole("admin", "cno", "chief_matron", "head_nurse", "hr_admin"),
    canRequestShiftSwitch: isInActiveRole("admin", "chief_matron"),
    canApproveShiftSwitch: isInActiveRole("admin", "cno"),
    canCreateLogin: ar === "admin",
    canEditTargetHours: ar !== null && capabilityRoles("edit_target_hours", ["admin"]).includes(ar),
    canPrintStaff:
      ar !== null &&
      capabilityRoles("print_staff_list", [
        "admin",
        "cno",
        "chief_matron",
        "head_nurse",
        "hr_admin",
      ]).includes(ar),
    canPrintSchedule:
      ar !== null &&
      capabilityRoles("print_schedule", [
        "admin",
        "cno",
        "chief_matron",
        "head_nurse",
        "hr_admin",
      ]).includes(ar),
    signOut: async () => {
      if (user) sessionStorage.removeItem(selectedRoleStorageKey(user.id));
      setActiveRole(null);
      setNurseId(null);
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

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Full system access — manage staff, wards, users and all settings",
  cno: "Approve rotas, manage shift switches and oversee all facilities",
  chief_matron: "Review and approve rotas, manage leave and ward staffing",
  head_nurse: "Provide coverage across wards, manage schedules and approve leave",
  hr_admin: "Manage staff records, leave requests and HR administration",
  nurse: "View your schedule, submit leave requests and access rota",
};
