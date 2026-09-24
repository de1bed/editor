#!/usr/bin/env bash
# Regenerates the test fixtures (deterministic). Requires ffmpeg.
#   fixtures/video/sample_10s.mp4   640x360 30fps, 10 s, test pattern with a 16px grid (sharp edges for blur tests) + 440 Hz tone
#   fixtures/transcripts/sample_10s.json  synthetic word-level transcript aligned to it
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=30:duration=10" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=10" \
  -filter_complex "[0:v]drawgrid=w=16:h=16:t=2:c=white@0.7[v];[1:a]volume=-12dB,aformat=channel_layouts=stereo[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset veryslow -crf 32 -pix_fmt yuv420p -g 30 \
  -c:a aac -b:a 64k -movflags +faststart -fflags +bitexact -map_metadata -1 \
  fixtures/video/sample_10s.mp4
node scripts/gen-fixture-transcript.mjs > fixtures/transcripts/sample_10s.json
ls -la fixtures/video fixtures/transcripts
