import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const DEFAULT_MAX_PARTICIPANTS = 4;
const DEFAULT_MAX_WORKERS = 5;
const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const PARTY_MODES = new Set(["discuss", "plan", "execute"]);

const ROLE_CATALOG = [
  {
    id: "product",
    name: "Product Strategist",
    keywords: ["product", "saas", "market", "positioning", "pricing", "customer", "roadmap", "landing"],
    description: "Clarifies audience, value proposition, scope, positioning, and success criteria.",
  },
  {
    id: "design",
    name: "UX/UI Designer",
    keywords: ["design", "ui", "ux", "landing", "page", "brand", "visual", "conversion", "copy"],
    description: "Focuses on user experience, page structure, visual hierarchy, and conversion flow.",
  },
  {
    id: "frontend",
    name: "Frontend Engineer",
    keywords: ["build", "frontend", "react", "next", "css", "component", "page", "landing", "website"],
    description: "Plans implementation details, component boundaries, performance, and integration risk.",
  },
  {
    id: "marketing",
    name: "Growth Marketer",
    keywords: ["launch", "marketing", "seo", "campaign", "copy", "ads", "analytics", "conversion"],
    description: "Covers acquisition channels, launch messaging, SEO, analytics, and conversion measurement.",
  },
  {
    id: "qa",
    name: "QA/Risk Reviewer",
    keywords: ["test", "qa", "risk", "security", "quality", "bug", "accessibility", "performance"],
    description: "Looks for quality gates, regressions, accessibility, security, and launch blockers.",
  },
  {
    id: "compliance",
    name: "Compliance Reviewer",
    keywords: ["kyc", "aml", "compliance", "policy", "regulation", "financial", "audit", "review"],
    description: "Reviews regulatory, KYC, AML, policy, audit, and control requirements.",
  },
  {
    id: "data",
    name: "Data/AI Engineer",
    keywords: ["ai", "copilot", "rag", "data", "retrieval", "document", "classification", "extraction"],
    description: "Designs AI/data workflows, retrieval, document processing, and evaluation loops.",
  },
  {
    id: "support",
    name: "Support/Operations Lead",
    keywords: ["support", "ops", "runbook", "incident", "docs", "handoff", "customer"],
    description: "Plans operational readiness, support workflows, documentation, and escalation paths.",
  },
];

export default definePluginEntry({
  id: "party-orchestrator",
  name: "Party Orchestrator",
  description: "Runs a task-aware multi-agent roundtable over configured agents and skills.",
  register(api) {
    api.registerCommand({
      name: "party",
      description: "Run a task-aware multi-agent roundtable over configured agents and skills.",
      acceptsArgs: true,
      requireAuth: false,
      agentPromptGuidance: [
        "Use /party <task> to invoke the Party Orchestrator plugin command. Do not simulate /party as a tool call.",
      ],
      async handler(ctx) {
        const parsed = parsePartyCommand(ctx.args || ctx.commandBody.replace(/^\/?party\b/i, ""));

        if (!parsed.task) {
          return {
            text: "What should the party work on? Try `/party discuss Build a SaaS landing page`, `/party plan Build a KYC copilot`, or `/party execute Build a policy reviewer chatbot`.",
          };
        }

        return {
          text: await runPartyOrchestration({
            api,
            mode: parsed.mode,
            task: parsed.task,
            cfg: ctx.config || api.runtime.config.current(),
            sessionKey: ctx.sessionKey,
          }),
        };
      },
    });
  },
});

function parsePartyCommand(rawArgs) {
  const input = normalizeWhitespace(rawArgs);
  if (!input) return { mode: "discuss", task: "" };

  const [firstToken, ...rest] = input.split(" ");
  const normalizedMode = firstToken.toLowerCase();

  if (PARTY_MODES.has(normalizedMode)) {
    return {
      mode: normalizedMode,
      task: normalizeWhitespace(rest.join(" ")),
    };
  }

  return {
    mode: "discuss",
    task: input,
  };
}

async function runPartyOrchestration({ api, mode, task, cfg, sessionKey }) {
  const workspace = resolveWorkspace(api, cfg);
  const agents = listConfiguredAgents(cfg);
  const skills = await listWorkspaceSkills(workspace);
  const options = resolveOptions(api.pluginConfig);

  if (mode === "plan") {
    const workItems = buildExecutionPlan({ task, agents, skills, maxWorkers: options.maxWorkers });
    return formatPlanReport({ task, workItems, skills, agents });
  }

  if (mode === "execute") {
    return runExecutionOrchestration({ api, task, agents, skills, options, sessionKey });
  }

  const roster = selectParticipants({ task, agents, skills, maxParticipants: options.maxParticipants });

  api.logger.info("party orchestrator selected participants", {
    mode,
    task,
    participants: roster.map((participant) => participant.name),
  });

  const turns = [];
  let discussionSoFar = "";

  for (const [index, participant] of roster.entries()) {
    const childSessionKey = buildSessionKey(participant.agentId, participant.id, sessionKey);
    const message = buildParticipantPrompt({
      task,
      participant,
      discussionSoFar,
      isFirstTurn: index === 0,
      skills,
    });

    try {
      const run = await api.runtime.subagent.run({
        sessionKey: childSessionKey,
        message,
        deliver: false,
        lightContext: true,
        lane: "party-orchestrator",
        idempotencyKey: `party-${randomUUID()}`,
      });

      const wait = await api.runtime.subagent.waitForRun({
        runId: run.runId,
        timeoutMs: options.turnTimeoutMs,
      });

      let output = "";
      if (wait.status === "ok") {
        const messages = await api.runtime.subagent.getSessionMessages({ sessionKey: childSessionKey, limit: 12 });
        output = extractLatestAssistantText(messages.messages);
      } else {
        output = `PASS - ${wait.error || `turn ended with status ${wait.status}`}`;
      }

      const normalized = normalizeContribution(output);
      turns.push({ participant, output: normalized });
      discussionSoFar = summarizeDiscussion(turns);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      turns.push({ participant, output: `PASS - ${messageText}` });
      discussionSoFar = summarizeDiscussion(turns);
    }
  }

  return formatTranscript({ task, roster, turns, skills, agents });
}

async function runExecutionOrchestration({ api, task, agents, skills, options, sessionKey }) {
  const workers = selectWorkers({ task, agents, skills, maxWorkers: options.maxWorkers });
  const workItems = createWorkItems({ task, workers });
  const results = [];

  api.logger.info("party orchestrator selected execution workers", {
    task,
    workers: workers.map((worker) => worker.name),
  });

  for (const [index, worker] of workers.entries()) {
    const workItem = workItems[index] || buildDefaultWorkItem(task, worker);
    const childSessionKey = buildSessionKey(worker.agentId, `execute-${worker.id}`, sessionKey);
    const prompt = buildWorkerPrompt({ task, worker, workItem, skills });

    try {
      const run = await api.runtime.subagent.run({
        sessionKey: childSessionKey,
        message: prompt,
        deliver: false,
        lightContext: false,
        lane: "party-orchestrator-execute",
        idempotencyKey: `party-execute-${randomUUID()}`,
      });

      const wait = await api.runtime.subagent.waitForRun({
        runId: run.runId,
        timeoutMs: options.turnTimeoutMs,
      });

      if (wait.status !== "ok") {
        results.push({
          worker,
          workItem,
          status: "PASS",
          body: wait.error || `worker run ended with status ${wait.status}`,
        });
        continue;
      }

      const messages = await api.runtime.subagent.getSessionMessages({ sessionKey: childSessionKey, limit: 12 });
      const output = extractLatestAssistantText(messages.messages);
      results.push({
        worker,
        workItem,
        ...parseWorkerResponse(output),
      });
    } catch (error) {
      results.push({
        worker,
        workItem,
        status: "PASS",
        body: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return formatExecutionReport({ task, workers, workItems, results, agents, skills });
}

function buildExecutionPlan({ task, agents, skills, maxWorkers }) {
  const workers = selectWorkers({ task, agents, skills, maxWorkers });
  return createWorkItems({ task, workers });
}

function createWorkItems({ task, workers }) {
  return workers.map((worker) => {
    const matchedSkills = worker.relevantSkills.length
      ? worker.relevantSkills.map((skill) => skill.name).join(", ")
      : "general reasoning";

    return {
      worker,
      title: inferWorkTitle(task, worker),
      objective: `Contribute the ${worker.name} perspective for: ${task}`,
      expectedOutput: inferExpectedOutput(worker),
      matchedSkills,
    };
  });
}

function buildDefaultWorkItem(task, worker) {
  return {
    worker,
    title: inferWorkTitle(task, worker),
    objective: `Contribute the ${worker.name} perspective for: ${task}`,
    expectedOutput: inferExpectedOutput(worker),
    matchedSkills: "general reasoning",
  };
}

function inferWorkTitle(task, worker) {
  const workerText = `${worker.name} ${worker.reason} ${worker.relevantSkills?.map((skill) => skill.name).join(" ") || ""}`.toLowerCase();
  const taskText = task.toLowerCase();

  if (workerText.includes("kyc") || workerText.includes("aml")) return "KYC/AML requirements and workflow";
  if (workerText.includes("policy") || workerText.includes("compliance")) return "Policy and compliance review";
  if (workerText.includes("security") || workerText.includes("risk")) return "Security, risk, and control review";
  if (workerText.includes("frontend") || workerText.includes("ui") || workerText.includes("ux")) return "User experience and frontend implementation";
  if (workerText.includes("qa") || workerText.includes("test")) return "Quality gates and test plan";
  if (workerText.includes("data") || workerText.includes("ai") || workerText.includes("copilot")) return "AI/data architecture and evaluation";

  if (taskText.includes("kyc") || taskText.includes("aml")) return "KYC/AML requirements and workflow";
  if (taskText.includes("policy") || taskText.includes("compliance")) return "Policy and compliance review";
  if (taskText.includes("security") || taskText.includes("risk")) return "Security, risk, and control review";
  if (taskText.includes("frontend") || taskText.includes("ui") || taskText.includes("ux")) return "User experience and frontend implementation";
  if (taskText.includes("qa") || taskText.includes("test")) return "Quality gates and test plan";
  if (taskText.includes("data") || taskText.includes("ai") || taskText.includes("copilot")) return "AI/data architecture and evaluation";

  return `${worker.name} workstream`;
}

function inferExpectedOutput(worker) {
  const text = `${worker.name} ${worker.reason}`.toLowerCase();
  if (text.includes("frontend") || text.includes("designer")) return "screen flow, components, implementation notes, and risks";
  if (text.includes("qa") || text.includes("risk")) return "test strategy, risk checklist, and acceptance criteria";
  if (text.includes("compliance") || text.includes("policy") || text.includes("kyc")) return "requirements checklist, policy concerns, and review criteria";
  if (text.includes("data") || text.includes("ai")) return "data flow, model/RAG plan, evaluation criteria, and failure modes";
  return "actionable findings, decisions, and open questions";
}

function resolveOptions(pluginConfig) {
  return {
    maxParticipants: clampNumber(pluginConfig?.maxParticipants, 1, 8, DEFAULT_MAX_PARTICIPANTS),
    maxWorkers: clampNumber(pluginConfig?.maxWorkers, 1, 10, DEFAULT_MAX_WORKERS),
    turnTimeoutMs: clampNumber(pluginConfig?.turnTimeoutMs, 5_000, 600_000, DEFAULT_TURN_TIMEOUT_MS),
  };
}

function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function listConfiguredAgents(cfg) {
  const configured = Array.isArray(cfg?.agents?.list) ? cfg.agents.list : [];
  const agents = configured
    .filter((agent) => agent && typeof agent.id === "string" && agent.id.trim())
    .map((agent) => ({
      id: agent.id.trim(),
      name: typeof agent.name === "string" && agent.name.trim() ? agent.name.trim() : agent.id.trim(),
      skills: Array.isArray(agent.skills) ? agent.skills.filter((skill) => typeof skill === "string") : [],
      description: buildAgentDescription(agent),
    }));

  if (!agents.some((agent) => agent.id === "main")) {
    agents.unshift({
      id: "main",
      name: "main",
      skills: Array.isArray(cfg?.agents?.defaults?.skills) ? cfg.agents.defaults.skills : [],
      description: "Default OpenClaw agent.",
    });
  }

  return agents;
}

function buildAgentDescription(agent) {
  const parts = [];
  if (agent.identity?.name) parts.push(`identity ${agent.identity.name}`);
  if (agent.model) parts.push(`model ${stringifyShort(agent.model)}`);
  if (agent.runtime?.type) parts.push(`runtime ${agent.runtime.type}`);
  if (Array.isArray(agent.skills) && agent.skills.length) parts.push(`skills ${agent.skills.join(", ")}`);
  if (agent.systemPromptOverride) parts.push("custom system prompt");
  return parts.join("; ") || "Configured OpenClaw agent.";
}

function resolveWorkspace(api, cfg) {
  const configured = cfg?.agents?.defaults?.workspace;
  if (typeof configured === "string" && configured.trim()) {
    return expandHome(configured.trim());
  }

  return api.rootDir || process.cwd();
}

function expandHome(value) {
  if (value === "~") return process.env.USERPROFILE || process.env.HOME || value;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(process.env.USERPROFILE || process.env.HOME || "", value.slice(2));
  }
  return value;
}

async function listWorkspaceSkills(workspace) {
  const skillsDir = path.join(workspace, "skills");
  const entries = [];

  try {
    const names = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of names) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md");
      try {
        const text = await readFile(skillPath, "utf8");
        entries.push(parseSkill(entry.name, text, skillPath));
      } catch {
        // Missing or unreadable skill files are ignored.
      }
    }
  } catch {
    // Workspaces without a skills directory are valid.
  }

  return entries;
}

function parseSkill(folderName, text, skillPath) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = frontmatter?.[1] || "";
  const name = matchYamlScalar(block, "name") || folderName;
  const description = matchYamlScalar(block, "description") || "No description.";
  return { name, description, path: skillPath };
}

function matchYamlScalar(block, key) {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function selectParticipants({ task, agents, skills, maxParticipants }) {
  const explicit = agents
    .map((agent) => ({
      id: `agent-${agent.id}`,
      name: agent.name,
      agentId: agent.id,
      kind: "configured-agent",
      reason: `Configured OpenClaw agent${agent.skills.length ? ` with skills: ${agent.skills.join(", ")}` : ""}.`,
      relevantSkills: matchSkillsForText(`${task} ${agent.description}`, skills).slice(0, 3),
      score: scoreText(`${agent.name} ${agent.id} ${agent.description} ${agent.skills.join(" ")}`, task),
    }))
    .filter((agent) => agent.score > 0);

  const roles = ROLE_CATALOG.map((role) => ({
    id: `role-${role.id}`,
    name: role.name,
    agentId: "main",
    kind: "role",
    reason: role.description,
    relevantSkills: matchSkillsForText(`${task} ${role.description} ${role.keywords.join(" ")}`, skills).slice(0, 3),
    score: scoreRole(role, task),
  }));

  const selected = [...explicit, ...roles]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .filter(uniqueByName)
    .slice(0, maxParticipants);

  if (selected.length > 0) return selected;

  return ROLE_CATALOG.slice(0, Math.min(maxParticipants, DEFAULT_MAX_PARTICIPANTS)).map((role) => ({
    id: `role-${role.id}`,
    name: role.name,
    agentId: "main",
    kind: "role",
    reason: role.description,
    relevantSkills: [],
    score: 1,
  }));
}

function selectWorkers({ task, agents, skills, maxWorkers }) {
  const configuredWorkers = agents
    .filter((agent) => agent.id !== "main")
    .map((agent) => ({
      id: `agent-${agent.id}`,
      name: agent.name,
      agentId: agent.id,
      kind: "configured-agent",
      reason: `Configured OpenClaw worker${agent.skills.length ? ` with skills: ${agent.skills.join(", ")}` : ""}.`,
      relevantSkills: matchSkillsForText(`${task} ${agent.name} ${agent.description} ${agent.skills.join(" ")}`, skills).slice(0, 3),
      score: scoreText(`${agent.name} ${agent.id} ${agent.description} ${agent.skills.join(" ")}`, task),
    }))
    .filter((worker) => worker.score > 0 || worker.relevantSkills.length > 0)
    .sort((a, b) => b.score - a.score || b.relevantSkills.length - a.relevantSkills.length || a.name.localeCompare(b.name));

  const selected = configuredWorkers.slice(0, maxWorkers);

  if (selected.length >= maxWorkers) return selected;

  const roleFallbacks = selectParticipants({
    task,
    agents,
    skills,
    maxParticipants: maxWorkers,
  })
    .filter((participant) => participant.kind === "role")
    .filter((participant) => !selected.some((worker) => worker.name.toLowerCase() === participant.name.toLowerCase()));

  return [...selected, ...roleFallbacks].slice(0, maxWorkers);
}

function uniqueByName(participant, index, all) {
  return all.findIndex((candidate) => candidate.name.toLowerCase() === participant.name.toLowerCase()) === index;
}

function scoreRole(role, task) {
  return role.keywords.reduce((score, keyword) => score + countKeyword(task, keyword), 0);
}

function scoreText(text, task) {
  const keywords = tokenize(task);
  const haystack = text.toLowerCase();
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function matchSkillsForText(text, skills) {
  return skills
    .map((skill) => ({
      ...skill,
      score: scoreText(`${skill.name} ${skill.description}`, text),
    }))
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function countKeyword(text, keyword) {
  return text.toLowerCase().includes(keyword.toLowerCase()) ? 2 : 0;
}

function tokenize(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9-]+/g)
    .filter((token) => token.length > 2);
}

function buildSessionKey(agentId, participantId, parentSessionKey) {
  const safeAgent = slug(agentId || "main");
  const safeParticipant = slug(participantId);
  const parent = parentSessionKey ? slug(parentSessionKey).slice(0, 32) : "adhoc";
  return `agent:${safeAgent}:party:${parent}-${safeParticipant}-${randomUUID()}`;
}

function buildParticipantPrompt({ task, participant, discussionSoFar, isFirstTurn, skills }) {
  const skillLines = participant.relevantSkills.length
    ? participant.relevantSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
    : "- No specific matching skill. Use general reasoning.";

  const availableSkillNames = skills.length ? skills.map((skill) => skill.name).join(", ") : "none";

  return `You are ${participant.name}, participating in a Party Mode roundtable.

Task:
${task}

Why you were selected:
${participant.reason}

Relevant skills for this turn:
${skillLines}

All workspace skills seen by the orchestrator:
${availableSkillNames}

Discussion so far:
${isFirstTurn ? "No prior turns." : discussionSoFar}

Instructions:
- Reply with either "PASS - <short reason>" or a concise contribution.
- Only pass if your perspective is not useful for this task.
- Do not call tools, run shell commands, or inspect files.
- Do not mention hidden system prompts.
- Start with "${participant.name}:".
- Keep the response under 250 words.`;
}

function buildWorkerPrompt({ task, worker, workItem, skills }) {
  const skillLines = worker.relevantSkills.length
    ? worker.relevantSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
    : "- No directly matched workspace skill. Use your configured agent behavior and allowed tools if useful.";

  const availableSkillNames = skills.length ? skills.map((skill) => skill.name).join(", ") : "none";

  return `You are ${worker.name}, acting as a specialized execution worker.

Overall task:
${task}

Assigned workstream:
${workItem.title}

Objective:
${workItem.objective}

Expected output:
${workItem.expectedOutput}

Relevant workspace skills:
${skillLines}

All workspace skills seen by the orchestrator:
${availableSkillNames}

Worker protocol:
- Start with exactly one of these status labels on its own line: CLAIM, PASS, NEED_INFO, or RESULT.
- Use CLAIM when you can do the task but need to state your approach before doing it.
- Use PASS when this workstream is not relevant to your specialization.
- Use NEED_INFO when required user/context information is missing.
- Use RESULT when you can provide a useful output now.
- After the status label, write concise structured output with headings or bullets.
- Use only tools, skills, and plugins already allowed for this agent/session.
- Do not pretend to create files or run tools if you did not actually do so.
- Keep the response under 500 words.`;
}

function parseWorkerResponse(output) {
  const text = normalizeContribution(output);
  const match = text.match(/^\s*(CLAIM|PASS|NEED_INFO|RESULT)\b[:\-\s]*/i)
    || text.match(/\b(CLAIM|PASS|NEED_INFO|RESULT)\b[:\-\s]*/i);

  if (!match) {
    return {
      status: "RESULT",
      body: text,
    };
  }

  const status = match[1].toUpperCase();
  const body = normalizeWhitespace(text.slice((match.index || 0) + match[0].length)) || text;

  return { status, body };
}

function normalizeContribution(output) {
  const text = normalizeWhitespace(output);
  if (!text) return "PASS - no response returned.";
  return text;
}

function summarizeDiscussion(turns) {
  return turns
    .map((turn) => `${turn.participant.name}: ${turn.output.slice(0, 500)}`)
    .join("\n\n")
    .slice(0, 2_000);
}

function formatPlanReport({ task, workItems, skills, agents }) {
  const agentSummary = formatAgentSummary(agents);
  const skillSummary = formatSkillSummary(skills);
  const workPlan = workItems.length
    ? workItems.map((item, index) => `### ${index + 1}. ${item.title}
- Worker: ${item.worker.name} (${item.worker.kind}; target agent: ${item.worker.agentId})
- Objective: ${item.objective}
- Expected output: ${item.expectedOutput}
- Matched skills: ${item.matchedSkills}
- Selection reason: ${item.worker.reason}`).join("\n\n")
    : "No suitable workstreams were found.";

  return `## Party Plan: ${task}

### Discovered Agents
${agentSummary}

### Discovered Skills
${skillSummary}

### Workstreams
${workPlan}

### Next Step
Run \`/party execute ${task}\` when you want the orchestrator to delegate these workstreams to worker sessions.`;
}

function formatExecutionReport({ task, workers, workItems, results, agents, skills }) {
  const agentSummary = formatAgentSummary(agents);
  const skillSummary = formatSkillSummary(skills);
  const workerSummary = workers.length
    ? workers.map((worker) => `- ${worker.name} (${worker.kind}; target agent: ${worker.agentId})`).join("\n")
    : "- No workers selected.";

  const resultBody = results.length
    ? results.map((result, index) => {
      const workItem = result.workItem || workItems[index] || buildDefaultWorkItem(task, result.worker);
      return `### ${result.worker.name}: ${result.status}
Workstream: ${workItem.title}

${result.body}`;
    }).join("\n\n")
    : "No worker results were returned.";

  const needInfo = results.filter((result) => result.status === "NEED_INFO");
  const passed = results.filter((result) => result.status === "PASS");
  const completed = results.filter((result) => result.status === "RESULT" || result.status === "CLAIM");

  return `## Party Execute: ${task}

### Discovered Agents
${agentSummary}

### Discovered Skills
${skillSummary}

### Selected Workers
${workerSummary}

${resultBody}

## Execution Summary
- Completed or claimed: ${completed.length}
- Need info: ${needInfo.length}
- Passed: ${passed.length}

${needInfo.length ? `### Information Needed\n${needInfo.map((result) => `- ${result.worker.name}: ${result.body}`).join("\n")}` : "No worker requested more information."}`;
}

function formatAgentSummary(agents) {
  return agents.length
    ? agents.map((agent) => `- ${agent.name} (${agent.id}): ${agent.description}`).join("\n")
    : "- No configured agents found.";
}

function formatSkillSummary(skills) {
  return skills.length
    ? skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
    : "- No workspace skills found.";
}

function formatTranscript({ task, roster, turns, skills, agents }) {
  const participants = roster
    .map((participant) => `- ${participant.name} (${participant.kind}; target agent: ${participant.agentId}; ${participant.reason})`)
    .join("\n");

  const skillSummary = formatSkillSummary(skills);
  const agentSummary = formatAgentSummary(agents);

  const body = turns
    .map((turn) => `### ${turn.participant.name}\n${turn.output}`)
    .join("\n\n");

  const passes = turns.filter((turn) => /^pass\b/i.test(turn.output)).map((turn) => turn.participant.name);

  return `## Party Orchestrator: ${task}

### Discovered Agents
${agentSummary}

### Discovered Skills
${skillSummary}

### Selected Participants
${participants}

${body}

## Wrap-Up
${passes.length ? `Passed: ${passes.join(", ")}.` : "No participant passed."}

The group was selected from configured OpenClaw agents when relevant, with role-based contributors used as fallback coverage for the task type.`;
}

function extractLatestAssistantText(messages) {
  for (const message of [...messages].reverse()) {
    const text = extractText(message);
    const role = String(message?.role || message?.type || "").toLowerCase();
    if (text && (!role || role.includes("assistant") || role.includes("response"))) return text;
  }

  for (const message of [...messages].reverse()) {
    const text = extractText(message);
    if (text) return text;
  }

  return "";
}

function extractText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) {
    return value.content.map(extractText).filter(Boolean).join("\n");
  }
  if (value.message) return extractText(value.message);
  if (value.payload) return extractText(value.payload);
  return "";
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stringifyShort(value) {
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return String(value).slice(0, 120);
  }
}

function slug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}
