#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

const profileArgIndex = process.argv.indexOf("--profile");
const profile =
  profileArgIndex >= 0 && process.argv[profileArgIndex + 1]
    ? process.argv[profileArgIndex + 1]
    : "party";

const command = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
const workspace = cwd().replaceAll("\\", "/");
const pluginPath = join(cwd(), "plugins", "party-orchestrator").replaceAll("\\", "/");

const sampleAgents = [
  {
    id: "main",
    name: "Main Orchestrator Agent",
    default: true,
    skills: ["party_prompt", "kyc_research", "policy_review", "security_risk", "frontend_builder", "qa_review"],
    systemPromptOverride:
      "You are the main OpenClaw orchestration agent. Route party tasks through the Party Orchestrator and keep broad visibility across planning, execution, and review skills.",
  },
  {
    id: "kyc-research-agent",
    name: "KYC Research Agent",
    skills: ["kyc_research"],
    systemPromptOverride:
      "You specialize in KYC, AML, onboarding, identity verification, sanctions screening, beneficial ownership, and financial crime workflow research. Prefer concrete requirements, assumptions, and jurisdiction-sensitive caveats.",
  },
  {
    id: "policy-review-agent",
    name: "Policy Review Agent",
    skills: ["policy_review"],
    systemPromptOverride:
      "You specialize in reviewing policy, compliance procedures, control language, auditability, and reviewer workflows. Prefer structured checklists, gaps, and decision records.",
  },
  {
    id: "security-risk-agent",
    name: "Security Risk Agent",
    skills: ["security_risk"],
    systemPromptOverride:
      "You specialize in security, privacy, data handling, threat modeling, access control, audit logs, and operational risk for regulated products.",
  },
  {
    id: "frontend-builder-agent",
    name: "Frontend Builder Agent",
    skills: ["frontend_builder"],
    systemPromptOverride:
      "You specialize in product UI, frontend architecture, component breakdowns, implementation plans, accessibility, and user workflows.",
  },
  {
    id: "qa-agent",
    name: "QA Agent",
    skills: ["qa_review"],
    systemPromptOverride:
      "You specialize in test strategy, acceptance criteria, regression risk, edge cases, and release readiness.",
  },
];
const defaultSkills = ["party_prompt", "kyc_research", "policy_review", "security_risk", "frontend_builder", "qa_review"];

const currentAgents = readCurrentAgents();
const mergedAgents = mergeAgents(currentAgents, sampleAgents);

const batchFile = join(cwd(), ".openclaw-profile-setup.batch.json");
const settings = [
  { path: "agents.defaults.workspace", value: workspace },
  { path: "agents.defaults.skills", value: defaultSkills },
  { path: "agents.list", value: mergedAgents },
  { path: "gateway.mode", value: "local" },
  { path: "plugins.enabled", value: true },
  { path: "plugins.load.paths", value: [pluginPath] },
  { path: "plugins.entries.party-orchestrator.enabled", value: true },
  { path: "plugins.entries.party-orchestrator.config.maxParticipants", value: 4 },
  { path: "plugins.entries.party-orchestrator.config.maxWorkers", value: 5 },
  { path: "plugins.entries.party-orchestrator.config.turnTimeoutMs", value: 180000 },
  { path: "skills.entries.party_prompt.enabled", value: true },
  { path: "skills.entries.kyc_research.enabled", value: true },
  { path: "skills.entries.policy_review.enabled", value: true },
  { path: "skills.entries.security_risk.enabled", value: true },
  { path: "skills.entries.frontend_builder.enabled", value: true },
  { path: "skills.entries.qa_review.enabled", value: true },
];

writeFileSync(batchFile, JSON.stringify(settings, null, 2));

const result = spawnSync(
  command,
  ["--profile", profile, "config", "set", "--batch-file", batchFile],
  { shell: process.platform === "win32", stdio: "inherit" },
);

if (result.error) {
  console.error(`Failed to start OpenClaw CLI: ${result.error.message}`);
  process.exit(1);
}

if ((result.status ?? 0) !== 0) {
  process.exit(result.status ?? 1);
}

for (const stalePath of ["tools.allow", "tools.profile", "skills.entries.party"]) {
  const cleanup = spawnSync(
    command,
    ["--profile", profile, "config", "unset", stalePath],
    { shell: process.platform === "win32", stdio: "inherit" },
  );

  if (cleanup.error) {
    console.error(`Failed to start OpenClaw CLI: ${cleanup.error.message}`);
    process.exit(1);
  }
}

console.log(`Configured OpenClaw profile "${profile}" for workspace and Party Orchestrator plugin.`);

function readCurrentAgents() {
  const result = spawnSync(
    command,
    ["--profile", profile, "config", "get", "agents.list", "--json"],
    { shell: process.platform === "win32", encoding: "utf8" },
  );

  if (result.error || (result.status ?? 0) !== 0) return [];

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeAgents(existing, additions) {
  const byId = new Map();

  for (const agent of existing) {
    if (agent && typeof agent.id === "string" && agent.id.trim()) {
      byId.set(agent.id.trim(), agent);
    }
  }

  for (const agent of additions) {
    if (!byId.has(agent.id)) {
      byId.set(agent.id, agent);
    }
  }

  return [...byId.values()];
}
