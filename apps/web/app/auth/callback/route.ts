import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const sb = await userClient();
    await sb.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/projects", url.origin));
}
