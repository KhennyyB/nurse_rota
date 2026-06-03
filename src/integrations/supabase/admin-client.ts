import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Supabase client initialised with the service-role key.
 *
 * Used ONLY for privileged admin operations (user creation).
 * The service-role key bypasses Row Level Security and must never be
 * used for regular data access.
 */
function createAdminClient() {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string;

  if (!serviceKey || serviceKey.startsWith("paste-")) {
    throw new Error(
      "VITE_SUPABASE_SERVICE_ROLE_KEY is not set. " +
        "Copy the service_role key from Supabase Dashboard → Project Settings → API and add it to your .env file.",
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create a new auth user without sending a confirmation email.
 * The account is immediately active — the user can log in right away.
 */
export async function adminCreateUser(opts: {
  email: string;
  password: string;
  fullName?: string;
}): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true, // mark email as confirmed — no confirmation email sent
    user_metadata: { full_name: opts.fullName || opts.email },
  });

  if (error) throw new Error(error.message);
  if (!data.user?.id) throw new Error("User created but no ID returned.");
  return data.user.id;
}

/**
 * Permanently delete a user from Supabase Auth and all related rows.
 * Deleting from auth.users cascades to profiles and user_roles in most
 * Supabase setups; we also delete them explicitly to be safe.
 */
export async function adminDeleteUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
