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
