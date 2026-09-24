// Copies the caption fonts into public/ so the browser (JASSUB) uses the exact files ffmpeg uses.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "..", "public", "fonts");
mkdirSync(dest, { recursive: true });
cpSync(join(here, "..", "..", "..", "assets", "fonts"), dest, { recursive: true });
console.log("fonts copied to public/fonts");
