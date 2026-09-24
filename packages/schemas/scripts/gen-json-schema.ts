/**
 * Emits JSON Schema for every shared type into packages/schemas/json.
 * Python models are generated from these files (see workers/media/scripts/gen_models.sh).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as S from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "json");
mkdirSync(out, { recursive: true });

const targets: Record<string, z.ZodType> = {
  Transcript: S.Transcript,
  StyleSettings: S.StyleSettings,
  StyleProfileVersion: S.StyleProfileVersion,
  Timeline: S.TimelineShape,
  EditOp: S.EditOp,
  EditFeedback: S.EditFeedback,
  DetectionTrack: S.DetectionTrack,
  FaceAnalysis: S.FaceAnalysis,
  RenderPlan: S.RenderPlan,
  Job: S.Job,
  FetchUrlRequest: S.FetchUrlRequest,
  FetchUrlResult: S.FetchUrlResult,
  IngestRequest: S.IngestRequest,
  IngestResult: S.IngestResult,
  TranscribeRequest: S.TranscribeRequest,
  TranscribeResult: S.TranscribeResult,
  AnalyzeFacesRequest: S.AnalyzeFacesRequest,
  DetectRequest: S.DetectRequest,
  RenderRequest: S.RenderRequest,
  RenderResult: S.RenderResult,
};

for (const [name, schema] of Object.entries(targets)) {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input", unrepresentable: "any" });
  writeFileSync(join(out, `${name}.schema.json`), JSON.stringify({ ...json, $id: `https://editor.local/schemas/${name}.schema.json` }, null, 2) + "\n");
  console.log(`wrote ${name}.schema.json`);
}
