# OpenClaw Agent Party

An OpenClaw Party Mode skill plus a native Party Orchestrator plugin for task-aware planning, discussion, and delegated execution.

## Scope

This repo focuses on Party Mode orchestration behavior:

- discover configured OpenClaw agents and workspace skills,
- assemble a small group of relevant contributors,
- plan workstreams,
- discuss task strategy,
- invoke selected workers sequentially through OpenClaw subagent sessions,
- preserve discussion context,
- allow workers to claim, pass, request more information, or return results,
- return a final transcript or execution report.

The `skills/party` prompt remains publishable as a ClawHub skill. The `party-orchestrator` plugin is the runnable local orchestration layer.

## Project Layout

```text
plugins/party-orchestrator/openclaw.plugin.json  Plugin manifest
plugins/party-orchestrator/src/index.js          Plugin package entry
src/index.js              Native OpenClaw orchestrator implementation
skills/party/SKILL.md    OpenClaw-loadable Party Mode skill
skills/party/README.md   ClawHub skill description
scripts/run-party.mjs    Small CLI wrapper around `openclaw agent --message`
scripts/setup-openclaw-profile.mjs  Local profile setup for skill + plugin
openclaw.json.example    Example OpenClaw config pointing at this workspace
CLAWHUB.md               ClawHub test and publish workflow
SKILL.md                 Legacy standalone copy; use skills/party for OpenClaw and ClawHub
```

## Commands

```text
/party <task>
/party discuss <task>
/party plan <task>
/party execute <task>
/skill party_prompt <topic>
```

Use `/party <task>` or `/party discuss <task>` for the discussion roundtable.

Use `/party plan <task>` to decompose work into recommended workstreams and workers without executing.

Use `/party execute <task>` to delegate workstreams to selected worker sessions. Workers respond with the protocol below.

Use `/skill party_prompt <topic>` for the prompt-only ClawHub skill.

## Worker Protocol

Execution workers must begin with one of:

```text
CLAIM
PASS
NEED_INFO
RESULT
```

- `CLAIM`: the worker accepts the workstream and states its approach.
- `PASS`: the workstream is not relevant to that worker.
- `NEED_INFO`: the worker needs missing user or project information.
- `RESULT`: the worker can return useful output now.

The orchestrator parses these statuses and includes them in the execution report.

## Example

```text
/party plan build a financial copilot for KYC and policy reviewer chatbot
/party execute build a financial copilot for KYC and policy reviewer chatbot
```

The included sample worker pack defines:

- `kyc-research-agent`
- `policy-review-agent`
- `security-risk-agent`
- `frontend-builder-agent`
- `qa-agent`

Each worker is configured with matching workspace skills such as `kyc_research`, `policy_review`, `security_risk`, `frontend_builder`, and `qa_review`.

## Setup

Install dependencies:

```bash
npm install
```

To make OpenClaw load this workspace skill, merge the relevant values from `openclaw.json.example` into your `~/.openclaw/openclaw.json`.

The important setting is:

```json
{
  "agents": {
    "defaults": {
      "workspace": "C:/Users/Admin/Documents/partymode/openclaw_agent_party"
    }
  }
}
```

The included profile helper also enables local plugin loading from this repo:

```bash
npm run openclaw:profile:setup
```

Then restart the gateway or start a fresh local dashboard session.

For local testing without touching your main OpenClaw profile, use the included `party` profile helper:

```bash
npm run openclaw:profile:setup
npm run openclaw:profile:skills
npm run plugin:inspect
npm run party:profile -- "Discuss the launch plan"
```

To call the real orchestrator from chat, open the OpenClaw dashboard on the same `party` profile and send:

```text
/party Build a SaaS landing page
```

## ClawHub Format

For ClawHub, the publishable skill folder is:

```text
skills/party/
```

Run a local scan without publishing:

```bash
npm run clawhub:login
npm run clawhub:sync:dry-run
```

Publish after logging in:

```bash
npm run clawhub:login
npm run clawhub:publish
```

See `CLAWHUB.md` for the full test flow.

## Run

Run through npm:

```bash
npm run party -- "How should we design the launch plan?"
```

Or call OpenClaw directly:

```bash
openclaw agent --message "/skill party_prompt How should we design the launch plan?"
```

## Implementation Strategy

`src/index.js` registers `/party` as a native plugin command, so the dashboard command bypasses LLM tool-call confusion. It reads `agents.list` and workspace `skills/*/SKILL.md`, selects contributors by task keywords, then invokes OpenClaw child sessions through `api.runtime.subagent`.

`discuss` mode uses a meeting prompt and keeps workers from calling tools. `execute` mode uses a worker protocol prompt and allows each selected agent to use its own configured skills, tools, and plugins according to OpenClaw policy.

The actual installable plugin package lives in `plugins/party-orchestrator`. Keeping it separate avoids OpenClaw treating repo helper scripts as plugin runtime code during safety scans.

`skills/party/SKILL.md` is still the loadable workspace skill. It is invoked through `/skill party_prompt ...` so `/party` stays reserved for the real orchestrator plugin.
