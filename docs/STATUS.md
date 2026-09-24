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

## Fase 3 — censura y blur ✅

**Qué quedó**
- Censura es/en: listas base con normalización (acentos, alargamientos "puuuta", leetspeak, prefijos como "chingad*") y palabras añadidas o permitidas por el usuario. Cada palabra censurada genera un bip o silencio en su rango exacto (con margen configurable) y una máscara en el subtítulo (`m*****`, `******`, `#$%&`). Clic sobre una palabra la censura o descensura (la decisión manual gana a las listas). Panel por clip: activar, bip/silencio, máscara, idiomas y palabras extra (`set_censorship`).
- Blur:
  - Detección por texto libre ("el logo de la gorra"): job `detect_objects`. Grounding DINO + SAM 2 en Modal producen tracks con keyframes, que se muestran como resultados y se convierten en blur con un clic.
  - Blur automático al crear el timeline según el perfil (caras, placas, pantallas, logos).
  - Blur dibujado a mano sobre el preview: la caja se convierte del cuadro 9:16 a coordenadas del original teniendo en cuenta el recorte activo o el modo letterbox (`outputBoxToSource`).
  - Efectos: desenfoque, pixelado o tapado. Las caras usan elipse.
- Todo sigue siendo JSON: `add_blur` / `update_blur` / `remove_blur` / `set_censorship` son `EditOp` que el agente de la fase 4 usará igual.

**Cómo probarlo**
- `pnpm test`: listas y normalización, idempotencia de la censura, overrides, `set_censorship`, geometría salida → original, detección → blur válido. En render real: el bip sustituye al tono en el rango de la palabra, el modo silencio anula ambos, y el blur suaviza la región sin tocar el resto.
- App: en el editor de un clip, prueba el panel de censura y dibuja un blur sobre el video. Con `MEDIA_WORKER=modal`, escribe "el logo de la gorra" → *Detectar* → *Aplicar blur*.

**Qué falta**
- El blur usa la caja envolvente de SAM 2; el enmascarado por píxel (máscaras RLE) queda preparado en el esquema pero no se renderiza aún.
- Un blur dibujado a mano es estático. Para seguir un objeto en movimiento hay que usar la detección.
