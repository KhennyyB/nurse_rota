import { supabase } from "@/integrations/supabase/client";

export async function logAudit(action: string, target?: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .limit(1);
  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    actor_name: prof?.full_name ?? user.email ?? "Unknown",
    actor_role: roles?.[0]?.role ?? "nurse",
    action,
    target: target ?? null,
  });
}
