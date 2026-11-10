// `tauri icon` also emits mobile and Windows Store assets. Lintel ships
// desktop installers only, so remove them to keep the repository small.
import { rmSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons");
for (const name of ["android", "ios"]) rmSync(resolve(dir, name), { recursive: true, force: true });
for (const f of readdirSync(dir)) {
  if (f.startsWith("Square") || f === "StoreLogo.png") rmSync(resolve(dir, f));
}
