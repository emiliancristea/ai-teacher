import { strict as assert } from "node:assert";
import { evaluateCommandPolicy, isContextOnlyCommand } from "../src/services/commandPolicy";
import type { CommandApprovalLevel } from "../src/types";

interface PolicyTestCase {
  name: string;
  command: string;
  args: string[];
  expectedLevel: CommandApprovalLevel;
}

const cases: PolicyTestCase[] = [
  {
    name: "docker ps is auto-approved",
    command: "docker",
    args: ["ps"],
    expectedLevel: "auto",
  },
  {
    name: "docker ps -a is auto-approved",
    command: "docker",
    args: ["ps", "-a"],
    expectedLevel: "auto",
  },
  {
    name: "docker logs is auto-approved",
    command: "docker",
    args: ["logs", "infra"],
    expectedLevel: "auto",
  },
  {
    name: "docker stats is auto-approved",
    command: "docker",
    args: ["stats"],
    expectedLevel: "auto",
  },
  {
    name: "docker start requires approval",
    command: "docker",
    args: ["start", "infra"],
    expectedLevel: "approval_required",
  },
  {
    name: "docker stop requires approval",
    command: "docker",
    args: ["stop", "infra"],
    expectedLevel: "approval_required",
  },
  {
    name: "docker rm is blocked",
    command: "docker",
    args: ["rm", "infra"],
    expectedLevel: "blocked",
  },
  {
    name: "git status is auto-approved",
    command: "git",
    args: ["status"],
    expectedLevel: "auto",
  },
  {
    name: "git reset requires approval",
    command: "git",
    args: ["reset", "--hard"],
    expectedLevel: "approval_required",
  },
  {
    name: "npm install requires approval",
    command: "npm",
    args: ["install"],
    expectedLevel: "approval_required",
  },
  {
    name: "npm ls is auto-approved",
    command: "npm",
    args: ["ls"],
    expectedLevel: "auto",
  },
  {
    name: "git clean is approval required",
    command: "git",
    args: ["clean", "-fd"],
    expectedLevel: "approval_required",
  },
  {
    name: "docker compose down is blocked",
    command: "docker",
    args: ["compose", "down"],
    expectedLevel: "blocked",
  },
];

let failures = 0;

for (const test of cases) {
  const decision = evaluateCommandPolicy(test.command, test.args);
  if (decision.level !== test.expectedLevel) {
    failures += 1;
    console.error(
      `❌ ${test.name}: expected ${test.expectedLevel}, got ${decision.level} (${decision.reason})`
    );
  } else {
    console.log(`✅ ${test.name} (${decision.level})`);
  }

  const isAuto = isContextOnlyCommand(test.command, test.args);
  if (test.expectedLevel === "auto") {
    assert.ok(isAuto, `${test.name} should be treated as context-only`);
  } else {
    assert.ok(!isAuto, `${test.name} should not be treated as context-only`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} policy test(s) failed.`);
  process.exit(1);
}

console.log("\nAll command policy tests passed.");

