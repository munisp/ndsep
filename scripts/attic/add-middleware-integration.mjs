/**
 * Script to add middleware integration imports to all router files
 * that don't already have the middlewareIntegration import.
 */
import { readFileSync, writeFileSync } from "fs";
import { readdirSync } from "fs";
import { join } from "path";

const routerDir = join(process.cwd(), "server/routers");
const files = readdirSync(routerDir).filter(f => f.endsWith(".ts"));

let updated = 0;

for (const file of files) {
  const filepath = join(routerDir, file);
  let content = readFileSync(filepath, "utf8");
  
  // Skip if already has the import
  if (content.includes("middlewareIntegration")) {
    console.log(`SKIP: ${file} (already has import)`);
    continue;
  }
  
  // Find the last import line that has middlewareExtensions or middlewareHelpers
  const lines = content.split("\n");
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("middlewareExtensions") || lines[i].includes("middlewareHelpers")) {
      insertIdx = i;
    }
  }
  
  if (insertIdx === -1) {
    // No middleware import found, add after last import
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("import ")) insertIdx = i;
    }
  }
  
  if (insertIdx >= 0) {
    lines.splice(insertIdx + 1, 0, 
      `import { emitMutationEvent, EVENTS } from "../middlewareIntegration";`
    );
    writeFileSync(filepath, lines.join("\n"));
    console.log(`UPDATED: ${file} (added import at line ${insertIdx + 2})`);
    updated++;
  } else {
    console.log(`WARN: ${file} (no import location found)`);
  }
}

console.log(`\nDone: ${updated} files updated`);
