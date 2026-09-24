# Editor IA — clips verticales que aprenden tu estilo

Sube un video largo (podcast, entrevista, película) y obtén clips verticales 9:16 con subtítulos palabra por palabra, censura de groserías y blur de elementos sensibles. Pule cada clip conversando con un agente; cada ajuste actualiza tu **perfil de estilo**.

**Principio central:** la IA nunca edita píxeles. El LLM lee la transcripción, las detecciones y el perfil de estilo, y produce o modifica un **Timeline en JSON**. Un motor determinista (FFmpeg + libass) convierte ese JSON en video. Cada edición es un conjunto de `EditOp` tipadas → una nueva versión del Timeline → un nuevo preview.

El plan de arquitectura completo está en [`docs/PLAN.md`](docs/PLAN.md).

## Estructura

```
apps/web            Next.js 16 (App Router) + Tailwind 4: UI, API, chat del agente
apps/mcp            Servidor MCP (stdio + Streamable HTTP) con las mismas herramientas que el agente
packages/schemas    Zod (fuente de verdad) → JSON Schema (json/) → modelos Pydantic
packages/core       Lógica pura: Timeline, EditOps, censura, subtítulos ASS, compilador → FFmpeg, reencuadre, OTIO/SRT
packages/llm        Capa LLM agnóstica (Anthropic / OpenAI) + embeddings
packages/agent      Selección de momentos y aprendizaje del perfil de estilo
packages/tools      Registro único de herramientas (agente interno + MCP) y el orquestador del chat
packages/render     Ejecutor local de RenderPlans (ffmpeg) + utilidades de medición
packages/db         Repositorios Supabase y almacenamiento
packages/jobs       Orquestación: jobs idempotentes, runner inline / Trigger.dev, workers Modal/local
workers/media       Python en Modal: ingesta, WhisperX, caras/hablante activo, detección + SAM 2, render
supabase/           Migraciones (RLS, pgvector) y tests SQL
fixtures/           Video de prueba de 10 s, transcripción sintética, timeline/plan de referencia
assets/fonts        Fuentes OFL usadas por FFmpeg y por el navegador (idénticas)
```

## Puesta en marcha

Requisitos: Node 22+, pnpm 10, `ffmpeg`, Python 3.11 con [uv](https://docs.astral.sh/uv/) (solo para los workers).

```bash
pnpm install
cp .env.example apps/web/.env.local    # y rellena los valores
```

### 1. Supabase

1. Crea un proyecto (el plan Free sirve para probar).
2. Aplica las migraciones: `supabase link --project-ref <ref> && supabase db push`, o pega en el SQL editor, en orden, los archivos de `supabase/migrations/`. Crean las tablas con RLS, pgvector, las funciones y el bucket privado `media`.
3. Copia la URL, la anon key y la service role key a `apps/web/.env.local`.
4. **Tamaño de subida:** el plan Free limita cada archivo a 50 MB. Para videos de varios GB sube el límite global en *Storage → Settings* (requiere plan Pro). La subida es reanudable (TUS, bloques de 6 MB).

### 2. Transcripción y workers

| Modo | Configuración | Qué hace |
|---|---|---|
| Local (desarrollo) | `MEDIA_WORKER=local`, `TRANSCRIBER=deepgram` o `assemblyai` | ffmpeg en tu máquina para ingesta y render; transcripción por API. Sin GPU: el reencuadre queda centrado y no hay detección de objetos. |
| Modal (producción) | `MEDIA_WORKER=modal`, `TRANSCRIBER=whisperx` | WhisperX + diarización, caras y hablante activo, Grounding DINO + SAM 2, render en CPU. Escala a cero. |

Desplegar los workers en Modal:

```bash
cd workers/media && uv sync --extra modal
modal secret create editor-supabase SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
modal secret create editor-worker MEDIA_WORKER_TOKEN=$(openssl rand -hex 24)
modal secret create editor-hf HF_TOKEN=…   # acepta antes los términos de pyannote en Hugging Face
modal deploy media/modal_app.py            # imprime la URL de `api` → MODAL_API_URL
```

### 3. Jobs

- `JOB_RUNNER=inline`: los jobs corren dentro del servidor de Next.js (basta para desarrollo con `pnpm dev`).
- `JOB_RUNNER=trigger`: se despachan a Trigger.dev (`cd packages/jobs && npx trigger.dev@latest login && pnpm trigger:deploy`). Las esperas a Modal usan `wait.for`, que no factura cómputo mientras esperan.

Cada job es **asíncrono, idempotente y reanudable**: la clave de idempotencia es un hash del tipo, la entrada y la versión del handler. Las salidas van a rutas deterministas del almacenamiento. Un job ya terminado se reutiliza en lugar de repetirse, y la UI muestra el estado y el progreso en tiempo real (Supabase Realtime).

### 4. Ejecutar

```bash
pnpm dev            # http://localhost:3000
```

Flujo de la fase 1: **Nuevo proyecto → subir video → (ingesta + transcripción) → seleccionar un fragmento en la transcripción → Crear clip → preview → Render final 1080×1920**.

### 5. Servidor MCP

El servidor MCP expone las mismas herramientas que usa el asistente interno: `list_projects`, `list_clips`, `get_transcript`, `propose_clips`, `get_timeline`, `patch_timeline`, `add_blur_region`, `detect_objects`, `get_detections`, `set_censorship`, `get_style_profile`, `update_style_profile`, `render_preview`, `render_final`, `get_clip`, `get_job` y `export_otio`.

1. En la app, ve a **Mi estilo → Tokens MCP** y crea un token (se muestra una sola vez; en la base de datos solo se guarda su hash).
2. **stdio** (Claude Desktop o Claude Code):
   ```json
   {
     "mcpServers": {
       "editor-ia": {
         "command": "pnpm",
         "args": ["--dir", "/ruta/al/repo/apps/mcp", "start:stdio"],
         "env": { "MCP_TOKEN": "edmcp_…", "SUPABASE_URL": "…", "SUPABASE_SERVICE_ROLE_KEY": "…", "JOB_RUNNER": "trigger", "TRIGGER_SECRET_KEY": "…" }
       }
     }
   }
   ```
3. **HTTP** (clientes remotos): `pnpm --filter @editor/mcp start:http` → `POST http://host:8787/mcp` con `Authorization: Bearer edmcp_…`. El servidor no guarda sesión; cada token tiene ámbitos (`read` / `edit` / `render`).

### 6. Exportar a DaVinci Resolve / Premiere

En el editor del clip, **Exportar OTIO** (o la herramienta `export_otio`) genera tres archivos:

- `.otio`: los cortes exactos sobre el video original en V1/A1, con los bips, blurs y cambios de cámara como marcadores.
- `.srt` y `.ass`: los subtítulos.

El reencuadre 9:16 y el blur no se pueden representar en OTIO; van descritos en los metadatos. En Resolve: *File → Import → Timeline* y reenlaza el video original.

## Tests

```bash
pnpm test           # TypeScript: validador del Timeline, EditOps (property tests), censura, ASS, compilador y render real con ffmpeg
pnpm test:py        # Python: paridad de esquemas TS↔Python, conversión WhisperX, tracking, ingesta y render con el plan compilado en TS
pnpm test:db        # Migraciones + RLS + funciones contra Postgres/pgvector (TEST_DATABASE_URL)
```

El render se prueba sobre `fixtures/video/sample_10s.mp4` (se regenera con `pnpm gen:fixtures`). Los tests verifican la duración y el tamaño 9:16, que el bip sustituye a la groseria (análisis espectral del audio) y que el blur suaviza la región sin tocar el resto de la imagen.

## Decisiones y licencias

- **Render con FFmpeg + ASS/libass en lugar de Remotion.** Remotion exige licencia de empresa a partir de 4 empleados y renderiza con Chrome fotograma a fotograma, lo que es lento y caro. libass cubre los subtítulos animados (karaoke, pop, rebote, énfasis). En el navegador, **JASSUB** (libass en WASM) dibuja exactamente el mismo archivo ASS sobre el preview, así que los cambios de subtítulos se ven al instante sin volver a renderizar.
- **Sin Ultralytics YOLO (AGPL-3.0).** La detección usa YuNet para caras (MIT), Grounding DINO para texto libre y SAM 2 para el seguimiento, ambos Apache-2.0.
- **YouTube** está detrás de `NEXT_PUBLIC_FEATURE_YOUTUBE_INGEST=false` y exige confirmar que tienes derechos sobre el contenido.
- `next build` usa webpack (`--webpack`). En el desarrollo (`next dev`) se usa Turbopack.

## Estado por fases

Consulta [`docs/STATUS.md`](docs/STATUS.md).
