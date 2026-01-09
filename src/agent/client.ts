import { query } from "@anthropic-ai/claude-agent-sdk";
import { defaultCanUseTool } from "./permissions.js";

type QueryResult<T> = {
  sessionId?: string;
  text: string;
  structuredOutput?: T;
};

type QueryOptions = {
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  outputFormat?: unknown;
};

export async function runQuery<T = unknown>(
  prompt: string,
  options: QueryOptions = {}
): Promise<QueryResult<T>> {
  const response = query({
    prompt,
    options: {
      model: options.model ?? "claude-sonnet-4-5",
      workingDirectory: process.cwd(),
      settingSources: [],
      permissionMode: "default",
      canUseTool: defaultCanUseTool,
      allowedTools: options.allowedTools ?? [],
      mcpServers: options.mcpServers,
      systemPrompt: options.systemPrompt,
      outputFormat: options.outputFormat
    }
  });

  let sessionId: string | undefined;
  let text = "";
  let structuredOutput: T | undefined;

  for await (const message of response) {
    if (message.type === "system" && message.subtype === "init") {
      sessionId = message.session_id;
    } else if (message.type === "assistant") {
      if (typeof message.content === "string") {
        text += message.content;
      }
    } else if (message.type === "result") {
      const maybeStructured = (message as { structured_output?: T }).structured_output;
      if (maybeStructured !== undefined) {
        structuredOutput = maybeStructured;
      }
    } else if (message.type === "error") {
      const errorMessage = (message as { error?: { message?: string } }).error?.message;
      throw new Error(errorMessage ?? "Agent error");
    }
  }

  return { sessionId, text, structuredOutput };
}
