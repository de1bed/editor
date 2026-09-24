import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Editor IA — clips verticales",
  description: "Convierte videos largos en clips verticales con subtítulos, censura y blur. La IA aprende tu estilo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/projects" className="flex items-center gap-2 font-semibold">
              <span className="inline-block h-5 w-3 rounded-sm bg-accent" aria-hidden />
              Editor IA
            </Link>
            <nav className="flex items-center gap-4 text-sm text-muted">
              <Link href="/projects" className="hover:text-white">
                Proyectos
              </Link>
              <Link href="/style" className="hover:text-white">
                Mi estilo
              </Link>
              <form action="/auth/signout" method="post">
                <button className="hover:text-white">Salir</button>
              </form>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
