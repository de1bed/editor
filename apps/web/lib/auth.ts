import { redirect } from "next/navigation";
import { userClient } from "./supabase/server";

export async function currentUser() {
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
}

/** For pages: redirects to /login when signed out. */
export async function requireUser() {
  const { sb, user } = await currentUser();
  if (!user) redirect("/login");
  return { sb, user };
}
