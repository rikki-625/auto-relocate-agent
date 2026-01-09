type PermissionDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message?: string }
  | { behavior: "ask"; message?: string };

const DANGEROUS_BASH_PATTERNS = [
  "rm -rf",
  "dd if=",
  "mkfs",
  "> /dev/",
  "shutdown",
  "reboot"
];

export async function defaultCanUseTool(
  toolName: string,
  input: { command?: string; file_path?: string }
): Promise<PermissionDecision> {
  if (toolName === "Bash" && input.command) {
    if (DANGEROUS_BASH_PATTERNS.some((pattern) => input.command?.includes(pattern))) {
      return {
        behavior: "deny",
        message: `Blocked dangerous command: ${input.command}`
      };
    }
  }

  return { behavior: "allow" };
}
