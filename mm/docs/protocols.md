# Communication Protocols

A **protocol** is a turn-scheduling discipline imposed on an `agent-party` room. It determines which participant speaks at each turn. Protocols do **not** change the message format, the storage layout, or the `--force` escape hatch.

## Protocols

### `round-robin` (default)

Flat rotation. Participants take turns in fixed order. Equivalent to the
behavior before this feature.

- **Min participants:** 2
- **Roles:** none — every participant is equal.
- **Schedule:** `participants[turn % N]`
- **Use when:** no agent should "lead" the discussion.

### `panel`

A host moderates between panelists. The host speaks every other turn; the
panelists rotate on the in-between turns.

- **Min participants:** 2 (host + ≥1 panelist)
- **Roles (by position):**
  - `participants[0]` → **host**
  - `participants[1..]` → **panelists**
- **Schedule (host = H, panelists = P0, P1, …):**
  - turn 0: H
  - turn 1: P0
  - turn 2: H
  - turn 3: P1
  - turn 4: H
  - turn 5: P(2 mod (N-1)) — i.e. wraps
  - …
  - Even turns: host. Odd turns: panelists rotate.
- **Parity:** with odd `max_turns`, the host gets the last word. With even
  `max_turns`, a panelist closes the room. The host always speaks more often
  than any single panelist; non-host counts may be unequal if
  `(max_turns - ceil(max_turns/2))` is not divisible by `(N - 1)`. The CLI
  warns on stderr but does not reject.

### `debate`

Two sides alternate arguments; an optional third agent judges on the final
turn.

- **Participants:** exactly 2 or exactly 3.
- **Roles (by position):**
  - `participants[0]` → **pro**
  - `participants[1]` → **con**
  - `participants[2]` → **judge** (optional)
- **Schedule:**
  - **2 participants:** alternate `pro, con, pro, con, …` for `max_turns`
    turns.
  - **3 participants:** alternate `pro, con` for `max_turns - 1` turns,
    then `judge` on the final turn.
- **Constraints:**
  - 2 participants: `max_turns ≥ 2`.
  - 3 participants: `max_turns ≥ 3` **and** `max_turns` is odd (so pro and
    con get the same number of arguments before the verdict). Even
    `max_turns` is rejected at `cmdNew`.

### `interview`

One interviewer asks; guests answer one at a time, in rotation.

- **Min participants:** 2 (interviewer + ≥1 guest)
- **Roles (by position):**
  - `participants[0]` → **interviewer**
  - `participants[1..]` → **guests**
- **Schedule (interviewer = I, guests = G0, G1, …):**
  - turn 0: I (Q1)
  - turn 1: G0 (A1)
  - turn 2: I (Q2)
  - turn 3: G1 (A2)
  - turn 4: I (Q3)
  - turn 5: G(2 mod (N-1)) (A3)
  - …
- **Parity:** identical to `panel`. Interviewer always speaks first and at
  every even turn. With odd `max_turns`, interviewer gets the closing
  question; otherwise a guest gets the last answer. Same warning as `panel`
  on uneven guest counts.

## Data model changes

`meta.json` gains a single field:

```json
{ "protocol": "panel" }
```

The field `turn_index` is **removed**. Turn-of-record is `turn_count`; the
speaker for the current turn is computed by the scheduler.

Rooms missing the `protocol` field (created before this feature) are read
as `round-robin` at dispatch time. No write-back, no migration step.

## CLI surface changes

`agent-party.mjs`:

- `new` accepts `--protocol <name>` (default: `round-robin`). Validates
  participant count and `max_turns` for the chosen protocol; emits a
  clear error on failure.
- `new` runs an **invariant check** at room creation: it computes
  `speaker(turn)` for `turn ∈ [0..max_turns-1]` and asserts each result is
  in `participants`. This catches off-by-ones in `panel`/`interview` math
  before any agent connects.
- `new` stderr summary echoes the role-to-name mapping so users can catch
  a pro/con swap immediately.
- `whose-turn`, `post`, `wait` call `SCHEDULERS[meta.protocol ||
  "round-robin"](meta, meta.turn_count)` instead of the current
  `participants[turn_index]` lookup (`agent-party.mjs:77`).
- `show` prints roles next to participant names. Example:
  ```
  Participants: claude [pro], gemini [con], codex [judge]
  ```
- `list` adds a `protocol` column.
- `--force` on `post` keeps current semantics: bypass speaker check but
  still advance `turn_count` and close at `max_turns`.

## Skill surface changes

`mm/skill/agent-party/SKILL.md`:

- The skill accepts a positional argument: `/agent-party <protocol>`.
  Defaults to `round-robin` when omitted.
- Step 1 ("Gather room parameters") branches on protocol:
  - `panel` / `interview`: ask for host/interviewer, then panelists/guests
    as a comma list. Construct `--participants <host>,<rest>`.
  - `debate`: ask "who argues FOR" and "who argues AGAINST" separately,
    then optionally "who judges". Construct
    `--participants <pro>,<con>[,<judge>]`.
  - `round-robin`: unchanged — comma list in turn order.
- Step 1 also asks for a sensible default `max_turns` per protocol:
  - `round-robin`: `3 * N`
  - `panel` / `interview`: `2 * N - 1` (host opens, ends with host
    speaking; gives each non-host one turn)
  - `debate`: `5` (2 participants) or `7` (3 participants, ensures
    odd-with-judge)

## Validation rules (summary)

| Protocol     | Participants    | `max_turns` constraint                                      |
| ------------ | --------------- | ------------------------------------------------------------ |
| round-robin  | ≥ 2             | ≥ 1                                                          |
| panel        | ≥ 2             | ≥ N (so each non-host speaks at least once); warn on uneven parity |
| debate (2)   | exactly 2       | ≥ 2                                                          |
| debate (3)   | exactly 3       | ≥ 3 **and** odd                                              |
| interview    | ≥ 2             | ≥ N; warn on uneven parity                                   |

## Out of scope for this design

- Reassigning roles mid-room.
- Extending `max_turns` after creation (`agent-party extend`) — function-
  dispatch design supports it trivially, but the command itself is a
  future addition.
- Protocols with non-deterministic schedules (e.g. brainstorm with free
  speaker choice).
- Cross-protocol composition (panel-of-debates, etc.).
- Authentication / spoofing of `--as`.

## Open questions for implementation

1. Should `cmdShow` and `cmdList` display the *role* or the literal
   participant index? The doc proposes role names (`[pro]`, `[host]`) —
   confirm before implementing.
2. Should `panel` host be allowed to skip a turn (e.g., when they have
   nothing to add)? Current design says no; the host always speaks.
3. Should the skill print the role mapping back to the user as a
   confirmation step before calling `agent-party new`? Recommended.
