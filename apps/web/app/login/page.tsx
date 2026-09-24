"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = browserClient();
    const res =
      mode === "signin"
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setBusy(false);
    if (res.error) return setMsg(res.error.message);
    if (mode === "signup" && !res.data.session) return setMsg("Revisa tu correo para confirmar la cuenta.");
    router.replace("/projects");
    router.refresh();
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold">{mode === "signin" ? "Entrar" : "Crear cuenta"}</h1>
      <p className="mb-6 text-sm text-muted">Sube un video largo y obtén clips verticales listos para publicar.</p>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="email">Correo</label>
          <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input id="password" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        </div>
        {msg && <p className="text-sm text-amber-300">{msg}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "…" : mode === "signin" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
      <button className="mt-4 text-sm text-muted hover:text-white" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Entra"}
      </button>
    </div>
  );
}
