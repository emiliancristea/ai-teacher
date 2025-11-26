# Command Execution Policy

The helper agent now evaluates every terminal command request against a policy
layer so it can assist safely without disrupting the user's environment.

## Categories

- **Context** – read‑only diagnostics that never mutate state.  
  Examples: `docker ps`, `docker logs`, `git status`, `kubectl get`, `ls`,
  `systeminfo`. These commands run automatically when needed so the agent can
  gather context.

- **Critical** – commands that may change files, system state, or long‑running
  services.  
  Examples: `docker start`, `docker stop`, `docker compose up`, `npm install`,
  `git checkout`, `taskkill`. The agent must explain why the command is needed
  and wait for explicit user approval before execution.

- **Forbidden** – destructive operations that are never executed by the agent.
  Examples: `rm`, `del`, `format`, `shutdown`, `reboot`, `diskpart`.

## Default Behaviour

- If a command is not explicitly listed it defaults to **Critical** status, so
  the agent asks the user before running it.
- Each policy rule includes a rationale that can be surfaced in the UI so the
  user understands why approval is (or is not) required.
- The policy is enforced via `src/services/commandPolicy.ts`, which returns a
  `CommandPolicyDecision` describing the required approval level.

## Extending the Policy

- Add new rules in `commandPolicy.ts` for additional tools or workflows.
- Keep context commands strictly read‑only and fast to execute.
- Promote anything with side effects (install, start, stop, delete, reset, etc.)
  to **Critical** or **Forbidden** as appropriate.

