import Link from "next/link";
import { projects } from "@editor/db";
import { requireUser } from "@/lib/auth";
import { NewProject } from "@/components/new-project";

const STATUS: Record<string, string> = { created: "Sin video", uploading: "Subiendo", processing: "Procesando", ready: "Listo", failed: "Error" };

export default async function ProjectsPage() {
  const { sb, user } = await requireUser();
  const list = await projects.list(sb, user.id);
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_320px]">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Proyectos</h1>
        {list.length === 0 ? (
          <p className="card p-6 text-sm text-muted">Todavía no tienes proyectos. Crea uno y sube tu primer video.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="card flex items-center justify-between p-4 hover:border-neutral-500">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted">
                    {STATUS[p.status] ?? p.status} · {new Date(p.createdAt).toLocaleDateString("es")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside>
        <NewProject />
      </aside>
    </div>
  );
}
