import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StorageRef } from "@editor/schemas";
import type { Db } from "./client";

export async function signedUrl(db: Db, ref: StorageRef, expiresIn = 3600): Promise<string> {
  const { data, error } = await db.storage.from(ref.bucket).createSignedUrl(ref.path, expiresIn);
  if (error || !data) throw new Error(`signed url for ${ref.bucket}/${ref.path}: ${error?.message ?? "no data"}`);
  return data.signedUrl;
}

/** Streams an object to disk (no buffering of multi-GB files). */
export async function downloadTo(db: Db, ref: StorageRef, dest: string): Promise<void> {
  const url = await signedUrl(db, ref, 600);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${ref.path}: HTTP ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

/** Streams a local file to storage (upsert). */
export async function uploadFrom(db: Db, src: string, ref: StorageRef, contentType: string): Promise<number> {
  const { size } = await stat(src);
  const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${base}/storage/v1/object/${ref.bucket}/${ref.path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-upsert": "true",
    },
    body: Readable.toWeb(createReadStream(src)) as never,
    duplex: "half",
  } as RequestInit);
  if (!res.ok) throw new Error(`upload ${ref.path}: HTTP ${res.status} ${await res.text()}`);
  return size;
}

export async function downloadJson<T>(db: Db, ref: StorageRef): Promise<T> {
  const { data, error } = await db.storage.from(ref.bucket).download(ref.path);
  if (error || !data) throw new Error(`download ${ref.path}: ${error?.message ?? "no data"}`);
  return JSON.parse(await data.text()) as T;
}

export async function uploadText(db: Db, ref: StorageRef, text: string, contentType: string): Promise<void> {
  const { error } = await db.storage.from(ref.bucket).upload(ref.path, new Blob([text], { type: contentType }), { upsert: true, contentType });
  if (error) throw new Error(`upload ${ref.path}: ${error.message}`);
}
