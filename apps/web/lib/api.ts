import { DbError } from "@editor/db";
import { ZodError, type z } from "zod";
import { currentUser } from "./auth";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type Ctx = Awaited<ReturnType<typeof currentUser>> & { user: NonNullable<Awaited<ReturnType<typeof currentUser>>["user"]> };

/** Route handler wrapper: auth, JSON errors, typed body parsing. */
export function route<P extends Record<string, string>>(fn: (req: Request, ctx: Ctx, params: P) => Promise<Response | unknown>) {
  return async (req: Request, context: { params: Promise<P> }) => {
    try {
      const auth = await currentUser();
      if (!auth.user) throw new HttpError(401, "No has iniciado sesión");
      const out = await fn(req, auth as Ctx, await context.params);
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "El cuerpo debe ser JSON");
  }
  return schema.parse(raw);
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof ZodError) return Response.json({ error: "Datos inválidos", details: e.issues }, { status: 400 });
  if (e instanceof DbError) {
    const status = e.isNotFound ? 404 : e.isConflict ? 409 : 500;
    return Response.json({ error: e.message }, { status });
  }
  console.error(e);
  return Response.json({ error: e instanceof Error ? e.message : "Error interno" }, { status: 500 });
}
