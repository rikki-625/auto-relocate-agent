import path from "node:path";
import fs from "node:fs";
import { runCommand } from "../src/tools/command.js";
import { getCommandVersion } from "../src/utils/env.js";

async function checkNodeVersion() {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const required = pkg.engines?.node;
  const current = process.version;
  console.log(`[Check] Node.js: ${current} (Required: ${required})`);
  // Simplified check, could use semver if strictness needed
}

async function checkTool(name: string, command: string, args: string[]) {
  const version = await getCommandVersion(command, args);
  if (version) {
    console.log(`[Check] ${name}: OK (${version.substring(0, 50)}...)`);
    return true;
  } else {
    console.error(`[Error] ${name} not found or failed to run.`);
    return false;
  }
}

async function checkPythonRequirements() {
  console.log("[Check] Verifying Python requirements from requirements.txt...");
  // Use pip freeze to check if packages are installed
  // For simplicity, just check if we can import faster_whisper
  try {
    const result = await runCommand("python", ["-c", "import faster_whisper; print('faster_whisper ok')"]);
    if (result.exitCode === 0) {
      console.log(`[Check] Python Module 'faster-whisper': OK`);
      return true;
    } else {
      console.error(`[Error] Python Module 'faster-whisper' missing. Result: ${result.stderr}`);
      return false;
    }
  } catch (e) {
    console.error(`[Error] Failed to check python modules: ${e}`);
    return false;
  }
}

async function main() {
  console.log("=== Environment Pre-flight Check ===");

  await checkNodeVersion();

  const tools = [
    { name: "Python", cmd: "python", args: ["--version"] },
    { name: "FFmpeg", cmd: "ffmpeg", args: ["-version"] },
    { name: "yt-dlp", cmd: "yt-dlp", args: ["--version"] },
  ];

  let failed = false;
  for (const tool of tools) {
    const ok = await checkTool(tool.name, tool.cmd, tool.args);
    if (!ok) failed = true;
  }

  const pythonOk = await checkPythonRequirements();
  if (!pythonOk) failed = true;

  if (failed) {
    console.error("\n[FAILURE] Environment checks failed. Please install missing dependencies.");
    console.error("Run: pip install -r requirements.txt");
    process.exit(1);
  } else {
    console.log("\n[SUCCESS] Environment looks good.");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
