---
name: party_prompt
description: Prompt-only sequential multi-agent roundtable meeting. Use with /skill party_prompt when you want a simulated meeting transcript rather than the real Party Orchestrator plugin.
version: 0.1.0
metadata: { "openclaw": { "skillKey": "party_prompt", "homepage": "https://github.com/mixmash11/openclaw_agent_party" } }
---

# Party Mode Meeting

Party Mode assembles a small discussion group and facilitates a sequential roundtable.

Important: there is no `party` tool. Do not call a tool named `party`, do not emit a tool call, and do not return JSON tool input. Do not run shell commands such as `openclaw agents list`. Produce the meeting transcript directly in the assistant response.

This skill does not execute tools, write files, call external providers, manage memory, or run autonomous workflows.

## Command

When the user invokes this skill with:

```text
/skill party_prompt <topic>
```

start a Party Mode meeting for the topic. If no topic is provided, ask for the meeting topic before assembling agents.

Treat the skill invocation as an instruction to write the meeting transcript, not as a request to call a tool.

## Meeting Flow

1. Read the meeting topic from the skill invocation.
2. Select a focused group of 3-4 discussion participants from the topic and any agents explicitly named by the user.
3. If no agents are explicitly named, use role-based participants such as Facilitator, Product, Engineering, and Risk.
4. List the selected agents before the meeting starts.
5. Invite agents one at a time in a deliberate order.
6. Preserve a short discussion context after every turn.
7. Allow each agent to respond, react, or pass.
8. Present the full meeting transcript to the user.
9. End with a brief convergence, divergence, and open-questions summary.

## Group Assembly

Choose participants based on the topic:

- Use agents explicitly named by the user when provided.
- Do not inspect OpenClaw configuration, sessions, files, or shell output to discover agents.
- If no agents are named, create role-based participants that make the meeting useful.
- Lead with the agent whose expertise best anchors the topic.
- Add participants with different perspectives when useful.
- Prefer variety over duplication.
- If the user names a specific agent, include that agent.
- If more than four participants are relevant, choose the strongest four and mention that the group was kept small for coherence.

Before the first turn, announce:

```text
I've brought together [agent list] to discuss: [topic].
```

## Agent Turn Prompt

For each agent, use this structure:

```text
You are {name} ({title}), participating in a roundtable meeting.

Meeting topic:
{topic}

Discussion so far:
{short summary under 300 words, omitted for the first agent}

Guidelines:
- You may respond or pass.
- Start with: {name}:
- Do not repeat prior points unless you are adding a new angle.
- Build on, challenge, or clarify what came before.
- If the topic is outside your expertise, pass briefly.
- Do not use tools.
```

After each turn, update the discussion-so-far summary in plain language. Keep it under 300 words and include only the points needed by the next agent.

## Reactions

After each substantial response, ask the remaining agents whether they want to react. A reaction should be short and should either build on the point, challenge it, or pass.

Do not force a reaction from every agent. If an agent has nothing new to add, record that they passed and continue.

## Final Output

Return the meeting in this shape:

```text
## Meeting: [topic]

Participants:
- [agent]
- [agent]
- [agent]

[Agent A response]

[Agent B response or pass]

[Optional short reactions]

[Agent C response or pass]

## Wrap-Up
[2-3 sentence summary of convergence, divergence, and open questions]
```
