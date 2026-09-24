import {
  StyleSettings,
  Timeline,
  Transcript,
  type EditOp,
  type JsonPatchOp,
  type LearnedRule,
  type Provenance,
  type StyleSettingsInput,
} from "@editor/schemas";
import { must, type Db, DbError } from "./client";

// ------------------------------------------------------------------ types

export interface Project {
  id: string;
  userId: string;
  name: string;
  mode: "clips" | "reels";
  styleProfileId: string | null;
  status: "created" | "uploading" | "processing" | "ready" | "failed";
  settings: ProjectSettings;
  createdAt: string;
}

export interface ProjectSettings {
  /** How many clips to propose automatically after transcription (0 = manual only). */
  clipCount?: number;
  language?: string | null;
  diarize?: boolean;
}

export type AssetKind = "source" | "proxy" | "audio" | "thumb" | "waveform" | "music" | "mask" | "render" | "export";

export interface MediaAsset {
  id: string;
  userId: string;
  projectId: string;
  kind: AssetKind;
  parentAssetId: string | null;
  bucket: string;
  path: string;
  status: "pending" | "uploaded" | "ready" | "failed";
  originalFilename: string | null;
  mimeType: string | null;
  bytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: { num: number; den: number } | null;
  hasAudio: boolean | null;
  createdAt: string;
}

export interface Clip {
  id: string;
  userId: string;
  projectId: string;
  sourceAssetId: string;
  status: "proposed" | "approved" | "rejected" | "final";
  rank: number | null;
  title: string;
  justification: string | null;
  scores: Record<string, number> | null;
  sourceStartMs: number;
  sourceEndMs: number;
  currentVersion: number;
  createdBy: "llm" | "user" | "system";
  createdAt: string;
}

export interface TimelineVersionRow {
  id: string;
  clipId: string;
  version: number;
  parentVersion: number | null;
  timeline: Timeline;
  ops: EditOp[];
  jsonPatch: JsonPatchOp[];
  author: "user" | "agent" | "system";
  createdAt: string;
}

export interface RenderRow {
  id: string;
  userId: string;
  clipId: string;
  timelineVersion: number;
  quality: "preview" | "final";
  planHash: string;
  status: "queued" | "running" | "succeeded" | "failed";
  assetId: string | null;
  jobId: string | null;
  error: string | null;
  createdAt: string;
}

export interface StyleProfileVersionRow {
  id: string;
  profileId: string;
  userId: string;
  version: number;
  parentVersionId: string | null;
  settings: StyleSettings;
  learnedRules: LearnedRule[];
  provenance: Record<string, Provenance>;
  changeSummary: string;
  createdBy: "user" | "agent" | "system";
  createdAt: string;
}

type Row = Record<string, unknown>;

// ------------------------------------------------------------------ mappers

const toProject = (r: Row): Project => ({
  id: r.id as string,
  userId: r.user_id as string,
  name: r.name as string,
  mode: r.mode as Project["mode"],
  styleProfileId: (r.style_profile_id as string) ?? null,
  status: r.status as Project["status"],
  settings: (r.settings as ProjectSettings) ?? {},
  createdAt: r.created_at as string,
});

const toAsset = (r: Row): MediaAsset => ({
  id: r.id as string,
  userId: r.user_id as string,
  projectId: r.project_id as string,
  kind: r.kind as AssetKind,
  parentAssetId: (r.parent_asset_id as string) ?? null,
  bucket: r.storage_bucket as string,
  path: r.storage_path as string,
  status: r.status as MediaAsset["status"],
  originalFilename: (r.original_filename as string) ?? null,
  mimeType: (r.mime_type as string) ?? null,
  bytes: (r.bytes as number) ?? null,
  durationMs: (r.duration_ms as number) ?? null,
  width: (r.width as number) ?? null,
  height: (r.height as number) ?? null,
  fps: r.fps_num ? { num: r.fps_num as number, den: (r.fps_den as number) || 1 } : null,
  hasAudio: (r.has_audio as boolean) ?? null,
  createdAt: r.created_at as string,
});

const toClip = (r: Row): Clip => ({
  id: r.id as string,
  userId: r.user_id as string,
  projectId: r.project_id as string,
  sourceAssetId: r.source_asset_id as string,
  status: r.status as Clip["status"],
  rank: (r.rank as number) ?? null,
  title: r.title as string,
  justification: (r.justification as string) ?? null,
  scores: (r.scores as Record<string, number>) ?? null,
  sourceStartMs: r.source_start_ms as number,
  sourceEndMs: r.source_end_ms as number,
  currentVersion: r.current_version as number,
  createdBy: r.created_by as Clip["createdBy"],
  createdAt: r.created_at as string,
});

const toTimelineVersion = (r: Row): TimelineVersionRow => ({
  id: r.id as string,
  clipId: r.clip_id as string,
  version: r.version as number,
  parentVersion: (r.parent_version as number) ?? null,
  timeline: Timeline.parse(r.timeline),
  ops: (r.ops as EditOp[]) ?? [],
  jsonPatch: (r.json_patch as JsonPatchOp[]) ?? [],
  author: r.author as TimelineVersionRow["author"],
  createdAt: r.created_at as string,
});

const toRender = (r: Row): RenderRow => ({
  id: r.id as string,
  userId: r.user_id as string,
  clipId: r.clip_id as string,
  timelineVersion: r.timeline_version as number,
  quality: r.quality as RenderRow["quality"],
  planHash: r.plan_hash as string,
  status: r.status as RenderRow["status"],
  assetId: (r.asset_id as string) ?? null,
  jobId: (r.job_id as string) ?? null,
  error: (r.error as string) ?? null,
  createdAt: r.created_at as string,
});

const toStyleVersion = (r: Row): StyleProfileVersionRow => ({
  id: r.id as string,
  profileId: r.profile_id as string,
  userId: r.user_id as string,
  version: r.version as number,
  parentVersionId: (r.parent_version_id as string) ?? null,
  // Stored settings may be sparse or from an older schema: defaults fill the gaps.
  settings: StyleSettings.parse(r.settings ?? {}),
  learnedRules: (r.learned_rules as LearnedRule[]) ?? [],
  provenance: (r.provenance as Record<string, Provenance>) ?? {},
  changeSummary: (r.change_summary as string) ?? "",
  createdBy: r.created_by as StyleProfileVersionRow["createdBy"],
  createdAt: r.created_at as string,
});

// ------------------------------------------------------------------ projects

export const projects = {
  async create(db: Db, p: { userId: string; name: string; mode?: Project["mode"]; settings?: ProjectSettings; styleProfileId?: string | null }) {
    const r = await db
      .from("projects")
      .insert({ user_id: p.userId, name: p.name, mode: p.mode ?? "clips", settings: p.settings ?? {}, style_profile_id: p.styleProfileId ?? null })
      .select()
      .single();
    return toProject(must(r, "create project"));
  },
  async get(db: Db, id: string) {
    return toProject(must(await db.from("projects").select().eq("id", id).single(), `project ${id}`));
  },
  async list(db: Db, userId: string) {
    const r = await db.from("projects").select().eq("user_id", userId).order("created_at", { ascending: false });
    return must(r, "list projects").map(toProject);
  },
  async update(db: Db, id: string, patch: Partial<{ name: string; status: Project["status"]; settings: ProjectSettings; styleProfileId: string | null }>) {
    const row: Row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.settings !== undefined) row.settings = patch.settings;
    if (patch.styleProfileId !== undefined) row.style_profile_id = patch.styleProfileId;
    return toProject(must(await db.from("projects").update(row).eq("id", id).select().single(), `update project ${id}`));
  },
};

// ------------------------------------------------------------------ assets

export const assets = {
  async create(
    db: Db,
    a: {
      id?: string;
      userId: string;
      projectId: string;
      kind: AssetKind;
      bucket: string;
      path: string;
      parentAssetId?: string | null;
      status?: MediaAsset["status"];
      originalFilename?: string | null;
      mimeType?: string | null;
      bytes?: number | null;
    },
  ) {
    const r = await db
      .from("media_assets")
      .insert({
        ...(a.id ? { id: a.id } : {}),
        user_id: a.userId,
        project_id: a.projectId,
        kind: a.kind,
        storage_bucket: a.bucket,
        storage_path: a.path,
        parent_asset_id: a.parentAssetId ?? null,
        status: a.status ?? "pending",
        original_filename: a.originalFilename ?? null,
        mime_type: a.mimeType ?? null,
        bytes: a.bytes ?? null,
      })
      .select()
      .single();
    return toAsset(must(r, "create asset"));
  },
  /** Insert-or-update keyed by storage path (idempotent for job retries). */
  async upsertDerived(
    db: Db,
    a: { userId: string; projectId: string; kind: AssetKind; bucket: string; path: string; parentAssetId: string; bytes?: number; meta?: Partial<Pick<MediaAsset, "durationMs" | "width" | "height" | "hasAudio">>; mimeType?: string },
  ) {
    const r = await db
      .from("media_assets")
      .upsert(
        {
          user_id: a.userId,
          project_id: a.projectId,
          kind: a.kind,
          storage_bucket: a.bucket,
          storage_path: a.path,
          parent_asset_id: a.parentAssetId,
          status: "ready",
          bytes: a.bytes ?? null,
          mime_type: a.mimeType ?? null,
          duration_ms: a.meta?.durationMs ?? null,
          width: a.meta?.width ?? null,
          height: a.meta?.height ?? null,
          has_audio: a.meta?.hasAudio ?? null,
        },
        { onConflict: "storage_bucket,storage_path" },
      )
      .select()
      .single();
    return toAsset(must(r, "upsert asset"));
  },
  async get(db: Db, id: string) {
    return toAsset(must(await db.from("media_assets").select().eq("id", id).single(), `asset ${id}`));
  },
  async listForProject(db: Db, projectId: string) {
    return must(await db.from("media_assets").select().eq("project_id", projectId).order("created_at"), "list assets").map(toAsset);
  },
  async derived(db: Db, sourceAssetId: string, kind: AssetKind): Promise<MediaAsset | null> {
    const r = await db.from("media_assets").select().eq("parent_asset_id", sourceAssetId).eq("kind", kind).maybeSingle();
    if (r.error) throw new DbError(r.error.message, r.error.code);
    return r.data ? toAsset(r.data) : null;
  },
  async update(
    db: Db,
    id: string,
    patch: Partial<{ status: MediaAsset["status"]; bytes: number; durationMs: number; width: number; height: number; fps: { num: number; den: number }; hasAudio: boolean; probe: unknown; sha256: string }>,
  ) {
    const row: Row = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.bytes !== undefined) row.bytes = patch.bytes;
    if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;
    if (patch.width !== undefined) row.width = patch.width;
    if (patch.height !== undefined) row.height = patch.height;
    if (patch.fps !== undefined) {
      row.fps_num = patch.fps.num;
      row.fps_den = patch.fps.den;
    }
    if (patch.hasAudio !== undefined) row.has_audio = patch.hasAudio;
    if (patch.probe !== undefined) row.probe = patch.probe;
    if (patch.sha256 !== undefined) row.sha256 = patch.sha256;
    return toAsset(must(await db.from("media_assets").update(row).eq("id", id).select().single(), `update asset ${id}`));
  },
};

// ------------------------------------------------------------------ transcripts

export const transcripts = {
  async upsert(db: Db, t: { userId: string; assetId: string; transcript: Transcript }) {
    const r = await db
      .from("transcripts")
      .upsert(
        {
          user_id: t.userId,
          asset_id: t.assetId,
          provider: t.transcript.provider,
          provider_version: t.transcript.providerVersion,
          language: t.transcript.language,
          data: t.transcript,
          word_count: t.transcript.words.length,
        },
        { onConflict: "asset_id,provider" },
      )
      .select("id")
      .single();
    must(r, "upsert transcript");
  },
  /** Latest transcript of an asset (any provider). */
  async forAsset(db: Db, assetId: string): Promise<Transcript | null> {
    const r = await db.from("transcripts").select("data").eq("asset_id", assetId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (r.error) throw new DbError(r.error.message, r.error.code);
    return r.data ? Transcript.parse(r.data.data) : null;
  },
};

// ------------------------------------------------------------------ clips & timelines

export const clips = {
  async create(
    db: Db,
    c: {
      userId: string;
      projectId: string;
      sourceAssetId: string;
      sourceStartMs: number;
      sourceEndMs: number;
      title?: string;
      justification?: string | null;
      scores?: Record<string, number> | null;
      rank?: number | null;
      createdBy?: Clip["createdBy"];
      status?: Clip["status"];
    },
  ) {
    const r = await db
      .from("clips")
      .insert({
        user_id: c.userId,
        project_id: c.projectId,
        source_asset_id: c.sourceAssetId,
        source_start_ms: c.sourceStartMs,
        source_end_ms: c.sourceEndMs,
        title: c.title ?? "",
        justification: c.justification ?? null,
        scores: c.scores ?? null,
        rank: c.rank ?? null,
        created_by: c.createdBy ?? "user",
        status: c.status ?? "proposed",
      })
      .select()
      .single();
    return toClip(must(r, "create clip"));
  },
  async get(db: Db, id: string) {
    return toClip(must(await db.from("clips").select().eq("id", id).single(), `clip ${id}`));
  },
  async list(db: Db, projectId: string) {
    const r = await db.from("clips").select().eq("project_id", projectId).order("rank", { ascending: true, nullsFirst: false }).order("created_at");
    return must(r, "list clips").map(toClip);
  },
  async update(db: Db, id: string, patch: Partial<{ status: Clip["status"]; title: string; rank: number }>) {
    return toClip(must(await db.from("clips").update(patch).eq("id", id).select().single(), `update clip ${id}`));
  },
};

export const timelines = {
  async insertInitial(db: Db, t: { userId: string; clipId: string; timeline: Timeline }) {
    const r = await db
      .from("timeline_versions")
      .upsert(
        { user_id: t.userId, clip_id: t.clipId, version: 0, timeline: { ...t.timeline, version: 0 }, author: "system" },
        { onConflict: "clip_id,version", ignoreDuplicates: true },
      )
      .select();
    must(r, "insert timeline v0");
  },
  async get(db: Db, clipId: string, version?: number): Promise<TimelineVersionRow> {
    let v = version;
    if (v === undefined) v = (await clips.get(db, clipId)).currentVersion;
    const r = await db.from("timeline_versions").select().eq("clip_id", clipId).eq("version", v).single();
    return toTimelineVersion(must(r, `timeline ${clipId}@${v}`));
  },
  async history(db: Db, clipId: string) {
    const r = await db.from("timeline_versions").select("version, author, ops, created_at").eq("clip_id", clipId).order("version", { ascending: false });
    return must(r, "timeline history") as { version: number; author: string; ops: EditOp[]; created_at: string }[];
  },
  /** Appends a version; throws DbError(isConflict) if someone committed since `expectedVersion`. */
  async commit(
    db: Db,
    c: { clipId: string; expectedVersion: number; timeline: Timeline; ops: EditOp[]; jsonPatch: JsonPatchOp[]; author: "user" | "agent" | "system"; messageId?: string | null },
  ): Promise<number> {
    const r = await db.rpc("commit_timeline_version", {
      p_clip_id: c.clipId,
      p_expected_version: c.expectedVersion,
      p_timeline: c.timeline,
      p_ops: c.ops,
      p_json_patch: c.jsonPatch,
      p_author: c.author,
      p_message_id: c.messageId ?? null,
    });
    return must(r, "commit timeline") as number;
  },
};

// ------------------------------------------------------------------ renders

export const renders = {
  async findByHash(db: Db, clipId: string, planHash: string): Promise<RenderRow | null> {
    const r = await db.from("renders").select().eq("clip_id", clipId).eq("plan_hash", planHash).maybeSingle();
    if (r.error) throw new DbError(r.error.message, r.error.code);
    return r.data ? toRender(r.data) : null;
  },
  async upsert(db: Db, x: { userId: string; clipId: string; timelineVersion: number; quality: RenderRow["quality"]; planHash: string; jobId: string | null }) {
    const r = await db
      .from("renders")
      .upsert(
        { user_id: x.userId, clip_id: x.clipId, timeline_version: x.timelineVersion, quality: x.quality, plan_hash: x.planHash, job_id: x.jobId, status: "queued", error: null },
        { onConflict: "clip_id,plan_hash" },
      )
      .select()
      .single();
    return toRender(must(r, "upsert render"));
  },
  async update(db: Db, id: string, patch: Partial<{ status: RenderRow["status"]; assetId: string; error: string | null }>) {
    const row: Row = {};
    if (patch.status) row.status = patch.status;
    if (patch.assetId) row.asset_id = patch.assetId;
    if (patch.error !== undefined) row.error = patch.error;
    return toRender(must(await db.from("renders").update(row).eq("id", id).select().single(), `update render ${id}`));
  },
  async latest(db: Db, clipId: string, quality?: RenderRow["quality"]): Promise<RenderRow | null> {
    let q = db.from("renders").select().eq("clip_id", clipId).order("created_at", { ascending: false }).limit(1);
    if (quality) q = q.eq("quality", quality);
    const r = await q.maybeSingle();
    if (r.error) throw new DbError(r.error.message, r.error.code);
    return r.data ? toRender(r.data) : null;
  },
  async list(db: Db, clipId: string) {
    return must(await db.from("renders").select().eq("clip_id", clipId).order("created_at", { ascending: false }), "list renders").map(toRender);
  },
};

// ------------------------------------------------------------------ style profiles

export const styleProfiles = {
  /** The user's default profile with its active version; created with defaults on first use. */
  async getOrCreateDefault(db: Db, userId: string): Promise<{ profileId: string; version: StyleProfileVersionRow }> {
    const existing = await db.from("style_profiles").select().eq("user_id", userId).order("created_at").limit(1).maybeSingle();
    if (existing.error) throw new DbError(existing.error.message, existing.error.code);
    if (existing.data?.active_version_id) {
      return { profileId: existing.data.id, version: await styleProfiles.getVersion(db, existing.data.active_version_id) };
    }
    const profileId =
      existing.data?.id ?? (must(await db.from("style_profiles").insert({ user_id: userId }).select().single(), "create style profile") as Row).id as string;
    const version = await styleProfiles.createVersion(db, {
      profileId,
      userId,
      parentVersionId: null,
      settings: StyleSettings.parse({}),
      learnedRules: [],
      provenance: {},
      changeSummary: "Perfil inicial",
      createdBy: "system",
    });
    return { profileId, version };
  },
  async getVersion(db: Db, id: string) {
    return toStyleVersion(must(await db.from("style_profile_versions").select().eq("id", id).single(), `style version ${id}`));
  },
  async active(db: Db, profileId: string) {
    const p = must(await db.from("style_profiles").select().eq("id", profileId).single(), `style profile ${profileId}`) as Row;
    return styleProfiles.getVersion(db, p.active_version_id as string);
  },
  async history(db: Db, profileId: string) {
    const r = await db.from("style_profile_versions").select().eq("profile_id", profileId).order("version", { ascending: false });
    return must(r, "style history").map(toStyleVersion);
  },
  /** Creates version N+1 and makes it active. */
  async createVersion(
    db: Db,
    v: {
      profileId: string;
      userId: string;
      parentVersionId: string | null;
      settings: StyleSettingsInput;
      learnedRules: LearnedRule[];
      provenance: Record<string, Provenance>;
      changeSummary: string;
      createdBy: "user" | "agent" | "system";
    },
  ) {
    const last = await db.from("style_profile_versions").select("version").eq("profile_id", v.profileId).order("version", { ascending: false }).limit(1).maybeSingle();
    const next = ((last.data?.version as number | undefined) ?? 0) + 1;
    const row = must(
      await db
        .from("style_profile_versions")
        .insert({
          profile_id: v.profileId,
          user_id: v.userId,
          version: next,
          parent_version_id: v.parentVersionId,
          settings: StyleSettings.parse(v.settings),
          learned_rules: v.learnedRules,
          provenance: v.provenance,
          change_summary: v.changeSummary,
          created_by: v.createdBy,
        })
        .select()
        .single(),
      "create style version",
    ) as Row;
    must(await db.from("style_profiles").update({ active_version_id: row.id }).eq("id", v.profileId).select().single(), "activate style version");
    return toStyleVersion(row);
  },
  async activate(db: Db, profileId: string, versionId: string) {
    must(await db.from("style_profiles").update({ active_version_id: versionId }).eq("id", profileId).select().single(), "activate style version");
  },
};

// ------------------------------------------------------------------ feedback

export interface FeedbackInsert {
  userId: string;
  projectId: string;
  clipId: string | null;
  threadId?: string | null;
  messageId?: string | null;
  kind: "approve" | "reject" | "correction" | "instruction";
  area: string;
  userText: string | null;
  scope: "this_clip" | "project" | "always";
  timelineVersionBefore?: number | null;
  timelineVersionAfter?: number | null;
  ops?: EditOp[];
  jsonPatch?: JsonPatchOp[];
  profileVersionBefore?: string | null;
  profileVersionAfter?: string | null;
  context: { summary: string; transcriptExcerpt?: string; clipFeatures?: Record<string, number | string | boolean> };
  embedding?: number[] | null;
  embeddingModel?: string | null;
}

export interface FeedbackRow extends FeedbackInsert {
  id: string;
  createdAt: string;
}

export const feedback = {
  async insert(db: Db, f: FeedbackInsert): Promise<string> {
    const r = await db
      .from("edit_feedback")
      .insert({
        user_id: f.userId,
        project_id: f.projectId,
        clip_id: f.clipId,
        thread_id: f.threadId ?? null,
        message_id: f.messageId ?? null,
        kind: f.kind,
        area: f.area,
        user_text: f.userText,
        scope: f.scope,
        timeline_version_before: f.timelineVersionBefore ?? null,
        timeline_version_after: f.timelineVersionAfter ?? null,
        ops: f.ops ?? [],
        json_patch: f.jsonPatch ?? [],
        profile_version_before: f.profileVersionBefore ?? null,
        profile_version_after: f.profileVersionAfter ?? null,
        context: f.context,
        // pgvector parses the '[x,y,…]' text form
        embedding: f.embedding ? JSON.stringify(f.embedding) : null,
        embedding_model: f.embeddingModel ?? null,
      })
      .select("id")
      .single();
    return (must(r, "insert feedback") as { id: string }).id;
  },
  async recent(db: Db, userId: string, limit = 30): Promise<FeedbackRow[]> {
    const r = await db.from("edit_feedback").select().eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
    return (must(r, "recent feedback") as Row[]).map((x) => ({
      id: x.id as string,
      userId: x.user_id as string,
      projectId: x.project_id as string,
      clipId: (x.clip_id as string) ?? null,
      kind: x.kind as FeedbackRow["kind"],
      area: x.area as string,
      userText: (x.user_text as string) ?? null,
      scope: x.scope as FeedbackRow["scope"],
      ops: (x.ops as EditOp[]) ?? [],
      profileVersionAfter: (x.profile_version_after as string) ?? null,
      context: x.context as FeedbackRow["context"],
      createdAt: x.created_at as string,
    }));
  },
  async setProfileVersionAfter(db: Db, ids: string[], versionId: string) {
    if (ids.length) await db.from("edit_feedback").update({ profile_version_after: versionId }).in("id", ids);
  },
};

// ------------------------------------------------------------------ detections

export const detections = {
  async insertMany(db: Db, userId: string, jobId: string | null, tracks: import("@editor/schemas").DetectionTrack[]) {
    if (!tracks.length) return [] as string[];
    const r = await db
      .from("detection_tracks")
      .insert(
        tracks.map((t) => ({
          user_id: userId,
          asset_id: t.assetId,
          job_id: jobId,
          query: t.query,
          kind: t.kind,
          model: t.model,
          start_ms: t.startMs,
          end_ms: t.endMs,
          score: t.score,
          keyframes: t.keyframes,
        })),
      )
      .select("id");
    return (must(r, "insert detections") as { id: string }[]).map((x) => x.id);
  },
  async forJob(db: Db, jobId: string): Promise<import("@editor/schemas").DetectionTrack[]> {
    const r = await db.from("detection_tracks").select().eq("job_id", jobId).order("score", { ascending: false });
    return (must(r, "detections") as Row[]).map((x) => ({
      id: x.id as string,
      assetId: x.asset_id as string,
      query: x.query as string,
      kind: x.kind as import("@editor/schemas").DetectionTrack["kind"],
      model: x.model as string,
      startMs: x.start_ms as number,
      endMs: x.end_ms as number,
      score: Number(x.score),
      keyframes: x.keyframes as import("@editor/schemas").DetectionTrack["keyframes"],
    }));
  },
};

export async function getDetection(db: Db, id: string): Promise<import("@editor/schemas").DetectionTrack & { userId: string }> {
  const x = must(await db.from("detection_tracks").select().eq("id", id).single(), `detection ${id}`) as Row;
  return {
    id: x.id as string,
    userId: x.user_id as string,
    assetId: x.asset_id as string,
    query: x.query as string,
    kind: x.kind as import("@editor/schemas").DetectionTrack["kind"],
    model: x.model as string,
    startMs: x.start_ms as number,
    endMs: x.end_ms as number,
    score: Number(x.score),
    keyframes: x.keyframes as import("@editor/schemas").DetectionTrack["keyframes"],
  };
}

// ------------------------------------------------------------------ chat

export interface ChatMessageRow {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls: unknown;
  timelineVersion: number | null;
  createdAt: string;
}

export const chat = {
  async thread(db: Db, t: { userId: string; projectId: string; clipId: string }): Promise<string> {
    const r = await db.from("chat_threads").select("id").eq("clip_id", t.clipId).order("created_at").limit(1).maybeSingle();
    if (r.data?.id) return r.data.id as string;
    const c = await db.from("chat_threads").insert({ user_id: t.userId, project_id: t.projectId, clip_id: t.clipId }).select("id").single();
    return (must(c, "create thread") as { id: string }).id;
  },
  async add(db: Db, m: { userId: string; threadId: string; role: ChatMessageRow["role"]; content: string; toolCalls?: unknown; timelineVersion?: number | null }): Promise<string> {
    const r = await db
      .from("chat_messages")
      .insert({ user_id: m.userId, thread_id: m.threadId, role: m.role, content: m.content, tool_calls: m.toolCalls ?? null, timeline_version: m.timelineVersion ?? null })
      .select("id")
      .single();
    return (must(r, "add chat message") as { id: string }).id;
  },
  async history(db: Db, threadId: string, limit = 40): Promise<ChatMessageRow[]> {
    const r = await db.from("chat_messages").select().eq("thread_id", threadId).order("created_at", { ascending: false }).limit(limit);
    return (must(r, "chat history") as Row[])
      .map((x) => ({
        id: x.id as string,
        threadId: x.thread_id as string,
        role: x.role as ChatMessageRow["role"],
        content: x.content as string,
        toolCalls: x.tool_calls,
        timelineVersion: (x.timeline_version as number) ?? null,
        createdAt: x.created_at as string,
      }))
      .reverse();
  },
};

export async function unappliedFeedbackCount(db: Db, userId: string): Promise<number> {
  const r = await db.from("edit_feedback").select("id", { count: "exact", head: true }).eq("user_id", userId).is("profile_version_after", null);
  return r.count ?? 0;
}

export async function unappliedFeedback(db: Db, userId: string, limit = 40) {
  const r = await db.from("edit_feedback").select().eq("user_id", userId).is("profile_version_after", null).order("created_at", { ascending: false }).limit(limit);
  return (must(r, "unapplied feedback") as Row[]).map((x) => ({
    id: x.id as string,
    clipId: (x.clip_id as string) ?? null,
    kind: x.kind as string,
    area: x.area as string,
    scope: x.scope as string,
    userText: (x.user_text as string) ?? null,
    summary: ((x.context as { summary?: string }) ?? {}).summary ?? "",
    ops: (x.ops as unknown[]) ?? [],
    clipFeatures: ((x.context as { clipFeatures?: Record<string, unknown> }) ?? {}).clipFeatures ?? {},
  }));
}
