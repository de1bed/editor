export const MEDIA_BUCKET = "media";

/** Deterministic object paths: retries overwrite instead of duplicating. First segment = owner (RLS). */
export const paths = {
  source: (userId: string, projectId: string, assetId: string, filename: string) =>
    `${userId}/${projectId}/${assetId}/source${extension(filename)}`,
  proxy: (userId: string, projectId: string, sourceAssetId: string) => `${userId}/${projectId}/${sourceAssetId}/proxy.mp4`,
  audio: (userId: string, projectId: string, sourceAssetId: string) => `${userId}/${projectId}/${sourceAssetId}/audio.wav`,
  thumb: (userId: string, projectId: string, sourceAssetId: string) => `${userId}/${projectId}/${sourceAssetId}/thumb.jpg`,
  transcript: (userId: string, projectId: string, sourceAssetId: string, provider: string) =>
    `${userId}/${projectId}/${sourceAssetId}/transcript.${provider}.json`,
  render: (userId: string, projectId: string, clipId: string, planHash: string) =>
    `${userId}/${projectId}/renders/${clipId}/${planHash.slice(0, 16)}.mp4`,
  masks: (userId: string, projectId: string, assetId: string, jobId: string) => `${userId}/${projectId}/${assetId}/masks/${jobId}.jsonl`,
  export: (userId: string, projectId: string, clipId: string, name: string) => `${userId}/${projectId}/exports/${clipId}/${name}`,
};

function extension(filename: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename);
  return m ? `.${m[1]!.toLowerCase()}` : ".mp4";
}
