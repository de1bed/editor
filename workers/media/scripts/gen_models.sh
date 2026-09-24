#!/usr/bin/env bash
# Generates Pydantic v2 models from the shared JSON Schemas (packages/schemas/json).
# Run after `pnpm gen:schemas`. CI fails if the output drifts from what is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf media/schemas/generated
uv run datamodel-codegen \
  --input ../../packages/schemas/json \
  --input-file-type jsonschema \
  --output media/schemas/generated \
  --output-model-type pydantic_v2.BaseModel \
  --target-python-version 3.11 \
  --use-standard-collections \
  --use-union-operator \
  --field-constraints \
  --use-schema-description \
  --disable-timestamp \
  --formatters ruff-format
