/**
 * Script to add emitMutationEvent calls to all .mutation() handlers
 * that don't already have them.
 * 
 * Strategy: For each mutation handler, insert a fire-and-forget
 * emitMutationEvent call before the final return statement.
 */
import { readFileSync, writeFileSync } from "fs";
import { readdirSync } from "fs";
import { join, basename } from "path";

const routerDir = join(process.cwd(), "server/routers");
const files = readdirSync(routerDir).filter(f => f.endsWith(".ts"));

// Map router file names to event prefixes
const eventPrefixMap = {
  "accreditation": "ACCREDITATION",
  "banking": "BANKING", 
  "billing": "BILLING",
  "dpco": "DPCO",
  "dpcoAi": "AI",
  "enhancements": "COMPLIANCE",
  "newFeatures": "COMPLIANCE",
  "phase5Features": "COMPLIANCE",
  "phase6Features": "COMPLIANCE",
  "phase7Features": "COMPLIANCE",
  "phase8Features": "COMPLIANCE",
  "phase11Features": "COMPLIANCE",
  "phase12Features": "DATA_PIPELINE",
  "phase13Features": "REGULATORY",
  "production9Features": "SECURITY",
  "productionFeatures": "COMPLIANCE",
  "push": "COMPLIANCE",
  "sectors": "SECTOR",
  "telecom": "TELECOM",
  "workflows": "WORKFLOW",
  "aimlRouter": "AI",
};

let totalAdded = 0;

for (const file of files) {
  const filepath = join(routerDir, file);
  const baseName = basename(file, ".ts");
  let content = readFileSync(filepath, "utf8");
  
  // Skip if file doesn't have the middleware import
  if (!content.includes("emitMutationEvent")) {
    console.log(`SKIP: ${file} (no emitMutationEvent import)`);
    continue;
  }
  
  // Count existing emitMutationEvent calls
  const existingCalls = (content.match(/emitMutationEvent\(/g) || []).length;
  const mutations = (content.match(/\.mutation\(/g) || []).length;
  
  if (existingCalls >= mutations) {
    console.log(`OK: ${file} (${existingCalls} emit calls for ${mutations} mutations)`);
    continue;
  }
  
  const prefix = eventPrefixMap[baseName] || "COMPLIANCE";
  
  // Find all mutation handlers and add emit calls
  // Strategy: find 'return {' or 'return result' after '.mutation(' and add emit before it
  const lines = content.split("\n");
  let inMutation = false;
  let braceDepth = 0;
  let mutationStart = -1;
  let added = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.includes(".mutation(")) {
      inMutation = true;
      braceDepth = 0;
      mutationStart = i;
    }
    
    if (inMutation) {
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;
      
      // Check if this line has return and no emit before it
      if (line.trim().startsWith("return ") && !lines[i-1]?.includes("emitMutationEvent")) {
        // Don't add if it's a simple return with no value
        if (line.trim() === "return;") continue;
        
        const indent = line.match(/^\s*/)[0];
        const emitLine = `${indent}emitMutationEvent("ndsep.${prefix.toLowerCase()}.mutation", { action: "${baseName}", ts: new Date().toISOString() }).catch(() => {});`;
        lines.splice(i, 0, emitLine);
        added++;
        i++; // skip the inserted line
      }
      
      if (braceDepth <= 0 && i > mutationStart + 2) {
        inMutation = false;
      }
    }
  }
  
  if (added > 0) {
    writeFileSync(filepath, lines.join("\n"));
    console.log(`UPDATED: ${file} (added ${added} emit calls, had ${existingCalls}/${mutations})`);
    totalAdded += added;
  } else {
    console.log(`UNCHANGED: ${file}`);
  }
}

console.log(`\nTotal emit calls added: ${totalAdded}`);
