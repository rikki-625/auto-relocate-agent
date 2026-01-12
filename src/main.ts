import { loadConfig } from "./config.js";
import { runOnce } from "./run_once.js";
import { loadEnv } from "./utils/env.js";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

async function main() {
  loadEnv({ override: true });
  const configPath = readArg("--config") ?? process.env.APP_CONFIG ?? "config.yaml";
  const config = loadConfig(configPath);

  await runOnce(config);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
