import { runQuery } from "./agent/client.js";
import { loadEnv } from "./utils/env.js";

function readPrompt(): string {
  const index = process.argv.indexOf("--prompt");
  if (index === -1) {
    return "用一句话总结：什么是 run-once worker？";
  }

  return process.argv[index + 1] ?? "你好";
}

async function main() {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing `ANTHROPIC_API_KEY` environment variable");
  }

  const prompt = readPrompt();
  const result = await runQuery(prompt, {
    model: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5",
    allowedTools: []
  });

  if (result.sessionId) {
    console.log(`session_id: ${result.sessionId}`);
  }
  console.log(result.text.trim());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
