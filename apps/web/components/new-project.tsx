"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client-api";

export function NewProject() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [clipCount, setClipCount] = useState(5);
  const [language, setLanguage] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { project } = await api<{ project: { id: string } }>("/api/projects", { body: { name, clipCount, language: language || null } });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="card space-y-4 p-5">
      <h2 className="font-semibold">Nuevo proyecto</h2>
      <div>
        <label className="label" htmlFor="pname">Nombre</label>
        <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Podcast episodio 12" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="count">Clips automáticos</label>
          <input id="count" className="input" type="number" min={0} max={20} value={clipCount} onChange={(e) => setClipCount(Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="lang">Idioma</label>
          <select id="lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Detectar</option>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
          </select>
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <button className="btn-primary w-full" disabled={busy || !name.trim()}>
        Crear
      </button>
    </form>
  );
}
