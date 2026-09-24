# Estado por fases

## Fase 1 — subida → transcripción → 1 clip con subtítulos → render ✅

**Qué quedó**
- Monorepo pnpm + Turborepo. Esquemas en Zod (`Timeline`, `StyleProfile`, `EditFeedback`, `EditOp`, `Transcript`, contratos de los workers) → JSON Schema → Pydantic, con comprobación de desfase en CI.
- Migraciones de Supabase: todas las tablas con RLS, `commit_timeline_version` con concurrencia optimista, `match_feedback` (pgvector HNSW), bucket privado y políticas de Storage.
- Subida reanudable (TUS) directa a Storage → job `ingest` (proxy CFR 720p, audio 16 kHz, miniatura) → job `transcribe` (WhisperX en Modal, o Deepgram/AssemblyAI) → la transcripción aparece en la UI.
- Selección manual de un fragmento en la transcripción → job `build_timeline` → `render_preview`.
- Editor del clip: preview con subtítulos dibujados en vivo (JASSUB = mismo ASS que FFmpeg), controles de estilo (fuente, tamaño, colores, animación, posición, palabras por línea, mayúsculas), censura por palabra, énfasis, deshacer (cada cambio es una versión) y render final 1080×1920 descargable.
- Censura es/en en el núcleo desde ya: bip o silencio en el rango exacto de la palabra (con margen) y máscara en el subtítulo.
- Jobs idempotentes y reanudables con estado en tiempo real: runner inline para desarrollo, Trigger.dev para producción, workers en Modal o locales con ffmpeg.
- Importación de YouTube detrás de un feature flag (desactivada), con confirmación de derechos.

**Cómo probarlo**
1. `pnpm test && pnpm test:py && pnpm test:db` (ver README).
2. App: configura Supabase y `.env.local` → `pnpm dev` → crea un proyecto → sube un video corto (< 50 MB en el plan Free) → con `TRANSCRIBER=deepgram` espera a que aparezca la transcripción → selecciona (clic y Mayús+clic) → *Crear clip* → edita estilos → *Render final*.
3. Sin backend: `pnpm --filter @editor/web dev:fixture` y abre `/dev/player`: preview del video de prueba con subtítulos en vivo.

**Qué falta / limitaciones conocidas**
- No se probó de punta a punta contra un proyecto real de Supabase desde este entorno (sin acceso a imágenes Docker ni a Modal). El pipeline sí está cubierto por tests de unidad e integración (render real con ffmpeg, migraciones en Postgres real).
- Las transiciones distintas de corte seco (crossfade, whip) se guardan en el Timeline, pero el render las trata como cortes por ahora.
- El modo de reencuadre `split` (dos hablantes apilados) cae en `track`.
- Los blurs de tipo `mask` se renderizan con su caja envolvente; el enmascarado por píxel de SAM 2 queda pendiente.

## Fase 2 — selección automática de clips + reencuadre 9:16 ✅

**Qué quedó**
- `packages/llm`: capa agnóstica (`LLM_PROVIDER=anthropic|openai`) con salida estructurada validada con Zod (reintenta una vez con el error), bucle de herramientas propio (llamadas en paralelo; los errores vuelven como `is_error`), caché de prompt en Anthropic y embeddings (OpenAI). Modelos por defecto: `claude-opus-5` (agente) y `claude-haiku-4-5` (puntuación masiva).
- `packages/agent/selectMoments`: divide la transcripción en bloques de 12 min solapados. El modelo rápido propone momentos referenciando **ids de oración** (nunca inventa tiempos) y los puntúa en hook, cierre, autonomía y emoción. El ajuste de duración se calcula de forma determinista a partir del perfil, y se eligen los N mejores sin solapes. El prompt incluye las reglas aprendidas y las decisiones pasadas similares (pgvector).
- Job `select_moments` (idempotente: reutiliza propuestas con el mismo rango) → `build_timeline` por clip → preview. Se lanza solo tras la transcripción (`clipCount` del proyecto) o con el botón "Proponer clips con IA".
- Reencuadre: `analyze_faces` (YuNet + asignación de hablante por actividad de boca frente a la diarización) → `planReframe`: tomas por hablante que ignoran interjecciones cortas (< 1,2 s) y una cámara suavizada con zona muerta. En el editor: seguir al que habla / fijo (con posición) / completo con fondo desenfocado.
- Aprobar o descartar un clip queda registrado como `EditFeedback` con su embedding (base de la fase 4).

**Cómo probarlo**
- `pnpm test`: `selectMoments` con un LLM falso (ids → tiempos, ranking, bloques solapados, reglas en el prompt), el bucle de herramientas y la salida estructurada del adaptador de Anthropic, `planReframe` y un render real en el que el recorte salta de la barra amarilla a la azul al cambiar de hablante.
- App: configura `ANTHROPIC_API_KEY` y crea un proyecto con "Clips automáticos" > 0. Al terminar la transcripción aparecen los clips ordenados por puntuación, con su justificación. Con `MEDIA_WORKER=modal`, el encuadre sigue al hablante activo.

**Qué falta**
- La detección del hablante activo es heurística (movimiento de boca frente a diarización). Un modelo ASD (LR-ASD/TalkNet) mejoraría los casos con varias caras de perfil.
- El modo `split` (dos hablantes apilados) aún no se renderiza.
