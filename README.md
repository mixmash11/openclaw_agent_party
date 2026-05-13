# openclaw_agent_party

An OpenClaw skill for running a sequential multi-agent roundtable meeting.

## Scope

This repo focuses only on the `/party` meeting behavior:

- assemble a small group of relevant agents,
- list who is in the meeting,
- invite agents sequentially,
- preserve discussion context,
- allow agents to respond, react, or pass,
- return the final meeting transcript.

It intentionally does not include memory, tool execution, provider adapters, UI, or full autonomous orchestration.

## Command

```text
/party <topic>
```

When invoked, Party Mode chooses 3-4 relevant available agents, announces the participants, runs the meeting one agent at a time, allows short reactions, and ends with a concise wrap-up.

## Implementation Strategy

The skill is implemented primarily through `SKILL.md`. The skill instructions define how `/party` assembles the meeting, how each agent is prompted, how pass/react behavior works, and how the final transcript is formatted.
