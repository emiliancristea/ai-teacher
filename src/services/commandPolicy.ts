import type { CommandPolicyDecision, CommandApprovalLevel } from "../types";

type CommandCategory = CommandPolicyDecision["category"];

interface CommandRule {
  command: string;
  argsPrefix?: string[];
  level: CommandApprovalLevel;
  category: CommandCategory;
  reason: string;
  notes?: string;
}

const contextOnlyRules: CommandRule[] = [
  {
    command: "docker",
    argsPrefix: ["ps"],
    level: "auto",
    category: "context",
    reason: "Lists container status without changing state.",
  },
  {
    command: "docker",
    argsPrefix: ["ps", "-a"],
    level: "auto",
    category: "context",
    reason: "Displays all containers without modifying anything.",
  },
  {
    command: "docker",
    argsPrefix: ["logs"],
    level: "auto",
    category: "context",
    reason: "Returns container logs for debugging purposes only.",
  },
  {
    command: "docker",
    argsPrefix: ["stats"],
    level: "auto",
    category: "context",
    reason: "Shows resource usage without mutating containers.",
  },
  {
    command: "docker",
    argsPrefix: ["inspect"],
    level: "auto",
    category: "context",
    reason: "Reads container or image metadata without any side effects.",
  },
  {
    command: "git",
    argsPrefix: ["status"],
    level: "auto",
    category: "context",
    reason: "Shows repository state without modifying files.",
  },
  {
    command: "git",
    argsPrefix: ["branch"],
    level: "auto",
    category: "context",
    reason: "Lists branches without switching or editing.",
  },
  {
    command: "git",
    argsPrefix: ["log"],
    level: "auto",
    category: "context",
    reason: "Reads commit history only.",
  },
  {
    command: "git",
    argsPrefix: ["show"],
    level: "auto",
    category: "context",
    reason: "Displays commit details without altering the repo.",
  },
  {
    command: "git",
    argsPrefix: ["config", "--list"],
    level: "auto",
    category: "context",
    reason: "Displays configuration without making changes.",
  },
  {
    command: "kubectl",
    argsPrefix: ["get"],
    level: "auto",
    category: "context",
    reason: "Fetches cluster resource information.",
  },
  {
    command: "kubectl",
    argsPrefix: ["describe"],
    level: "auto",
    category: "context",
    reason: "Reads detailed resource information only.",
  },
  {
    command: "npm",
    argsPrefix: ["ls"],
    level: "auto",
    category: "context",
    reason: "Shows dependency tree without installation.",
  },
  {
    command: "npm",
    argsPrefix: ["run", "lint"],
    level: "approval_required",
    category: "critical",
    reason: "Runs project scripts that may be long running or mutate cache.",
  },
  {
    command: "node",
    argsPrefix: ["--version"],
    level: "auto",
    category: "context",
    reason: "Reports installed Node.js version.",
  },
  {
    command: "python",
    argsPrefix: ["--version"],
    level: "auto",
    category: "context",
    reason: "Reports installed Python version.",
  },
  {
    command: "pwsh",
    argsPrefix: ["-Command", "Get-Process"],
    level: "auto",
    category: "context",
    reason: "Lists running processes only.",
  },
  {
    command: "powershell",
    argsPrefix: ["-Command", "Get-Process"],
    level: "auto",
    category: "context",
    reason: "Lists running processes only.",
  },
  {
    command: "cmd",
    argsPrefix: ["/c", "tasklist"],
    level: "auto",
    category: "context",
    reason: "Shows task list without side effects.",
  },
  {
    command: "wmic",
    argsPrefix: ["process", "list", "brief"],
    level: "auto",
    category: "context",
    reason: "Displays process data for diagnostics.",
  },
  {
    command: "systeminfo",
    level: "auto",
    category: "context",
    reason: "Displays system configuration information.",
  },
  {
    command: "whoami",
    level: "auto",
    category: "context",
    reason: "Shows current user identity only.",
  },
  {
    command: "hostname",
    level: "auto",
    category: "context",
    reason: "Displays machine hostname only.",
  },
  {
    command: "ls",
    level: "auto",
    category: "context",
    reason: "Lists directory contents.",
  },
  {
    command: "dir",
    level: "auto",
    category: "context",
    reason: "Lists directory contents.",
  },
];

const criticalRules: CommandRule[] = [
  {
    command: "docker",
    argsPrefix: ["start"],
    level: "approval_required",
    category: "critical",
    reason: "Starts containers and changes runtime state.",
  },
  {
    command: "docker",
    argsPrefix: ["stop"],
    level: "approval_required",
    category: "critical",
    reason: "Stops containers impacting running services.",
  },
  {
    command: "docker",
    argsPrefix: ["restart"],
    level: "approval_required",
    category: "critical",
    reason: "Restarts containers and can interrupt workloads.",
  },
  {
    command: "docker",
    argsPrefix: ["rm"],
    level: "blocked",
    category: "forbidden",
    reason: "Removes containers and risks data loss.",
  },
  {
    command: "docker",
    argsPrefix: ["compose", "down"],
    level: "blocked",
    category: "forbidden",
    reason: "docker compose down removes services and should never run automatically.",
  },
  {
    command: "docker",
    argsPrefix: ["compose", "up"],
    level: "approval_required",
    category: "critical",
    reason: "Creates or modifies containers and volumes.",
  },
  {
    command: "docker",
    argsPrefix: ["compose", "rm"],
    level: "blocked",
    category: "forbidden",
    reason: "Removes services and volumes.",
  },
  {
    command: "git",
    argsPrefix: ["reset"],
    level: "approval_required",
    category: "critical",
    reason: "Potentially discards commits or changes.",
  },
  {
    command: "git",
    argsPrefix: ["clean"],
    level: "approval_required",
    category: "critical",
    reason: "Deletes untracked files from the working tree.",
  },
  {
    command: "git",
    argsPrefix: ["checkout"],
    level: "approval_required",
    category: "critical",
    reason: "Switches branches or overwrites files.",
  },
  {
    command: "git",
    argsPrefix: ["pull"],
    level: "approval_required",
    category: "critical",
    reason: "Mutates local repository state.",
  },
  {
    command: "npm",
    argsPrefix: ["install"],
    level: "approval_required",
    category: "critical",
    reason: "Modifies node_modules and lockfiles.",
  },
  {
    command: "npm",
    argsPrefix: ["update"],
    level: "approval_required",
    category: "critical",
    reason: "Upgrades dependencies and may break builds.",
  },
  {
    command: "npm",
    argsPrefix: ["run"],
    level: "approval_required",
    category: "critical",
    reason: "Runs arbitrary project scripts.",
  },
  {
    command: "pip",
    argsPrefix: ["install"],
    level: "approval_required",
    category: "critical",
    reason: "Installs Python packages and alters environment.",
  },
  {
    command: "apt",
    level: "approval_required",
    category: "critical",
    reason: "Installs or removes system packages.",
  },
  {
    command: "brew",
    level: "approval_required",
    category: "critical",
    reason: "Installs or removes packages on macOS.",
  },
  {
    command: "kubectl",
    level: "approval_required",
    category: "critical",
    reason: "Cluster operations can impact production workloads.",
  },
  {
    command: "taskkill",
    level: "approval_required",
    category: "critical",
    reason: "Terminates running processes.",
  },
];

const forbiddenCommands: CommandRule[] = [
  {
    command: "rm",
    level: "blocked",
    category: "forbidden",
    reason: "Deleting files is never performed automatically.",
  },
  {
    command: "rd",
    level: "blocked",
    category: "forbidden",
    reason: "Removing directories is not permitted.",
  },
  {
    command: "del",
    level: "blocked",
    category: "forbidden",
    reason: "Deleting files is not permitted.",
  },
  {
    command: "erase",
    level: "blocked",
    category: "forbidden",
    reason: "Deleting data is not permitted.",
  },
  {
    command: "format",
    level: "blocked",
    category: "forbidden",
    reason: "Formatting drives is destructive and disallowed.",
  },
  {
    command: "shutdown",
    level: "blocked",
    category: "forbidden",
    reason: "System power operations require manual execution by the user.",
  },
  {
    command: "reboot",
    level: "blocked",
    category: "forbidden",
    reason: "System reboot requires explicit manual action.",
  },
  {
    command: "poweroff",
    level: "blocked",
    category: "forbidden",
    reason: "Powering off the machine is never automated.",
  },
  {
    command: "mkfs",
    level: "blocked",
    category: "forbidden",
    reason: "Creating filesystems is destructive.",
  },
  {
    command: "diskpart",
    level: "blocked",
    category: "forbidden",
    reason: "Disk partition changes are disallowed.",
  },
];

const allRules: CommandRule[] = [
  ...forbiddenCommands,
  ...criticalRules,
  ...contextOnlyRules,
];

function matchesRule(rule: CommandRule, command: string, args: string[]): boolean {
  if (rule.command !== command) {
    return false;
  }

  if (!rule.argsPrefix || rule.argsPrefix.length === 0) {
    return true;
  }

  if (rule.argsPrefix.length > args.length) {
    return false;
  }

  for (let i = 0; i < rule.argsPrefix.length; i += 1) {
    if (rule.argsPrefix[i] !== args[i]) {
      return false;
    }
  }

  return true;
}

function buildDecision(rule: CommandRule): CommandPolicyDecision {
  return {
    level: rule.level,
    reason: rule.reason,
    category: rule.category,
    notes: rule.notes,
    suggestedConfirmation:
      rule.level === "approval_required"
        ? "Explain why this command is needed and wait for the user to approve before running it."
        : undefined,
  };
}

function defaultDecision(command: string): CommandPolicyDecision {
  return {
    level: "approval_required",
    category: "critical",
    reason: `No explicit policy found for '${command}'. Defaulting to user approval.`,
    suggestedConfirmation:
      "Describe what this command will do and ask the user to approve it before execution.",
  };
}

/**
 * Determine how the agent should handle a command request. Returns the approval
 * level along with the reason so the UI can render clear guidance.
 */
export function evaluateCommandPolicy(command: string, args: string[]): CommandPolicyDecision {
  const normalizedCommand = command.toLowerCase();
  const normalizedArgs = args.map((arg) => arg.toLowerCase());

  const matchedRule = allRules.find((rule) =>
    matchesRule(rule, normalizedCommand, normalizedArgs)
  );

  if (matchedRule) {
    return buildDecision(matchedRule);
  }

  return defaultDecision(normalizedCommand);
}

/**
 * Returns true when a command may be executed automatically without seeking confirmation.
 */
export function isContextOnlyCommand(command: string, args: string[]): boolean {
  return evaluateCommandPolicy(command, args).level === "auto";
}

