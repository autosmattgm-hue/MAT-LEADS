import { execFileSync } from "node:child_process";
import fs from "node:fs";

const lines = [];
try {
  execFileSync(process.execPath, ["--check", "api/index.js"], { stdio: ["ignore", "ignore", "pipe"] });
  lines.push("single check OK");
} catch (error) {
  lines.push("single check ERR " + error.message);
}

try {
  const out = execFileSync(process.execPath, ["utils/syntax-check.js"], { stdio: ["ignore", "pipe", "pipe"] });
  lines.push("syntax-check stdout: " + out.toString().trim());
} catch (error) {
  lines.push("syntax-check ERR " + error.message);
  lines.push("stderr: " + (error.stderr ? error.stderr.toString().trim() : "none"));
}

fs.writeFileSync("probe_result.txt", lines.join("\n"));
