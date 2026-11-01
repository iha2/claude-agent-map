# Agent map: no blink, one superlite session per map, opens on run start

**Orchestrator:** human (this plan waits for your approval before anything more is built).

## Goal

For the person watching a superlite run in the agent map pane (Claude Desktop):

1. **No blink.** The graph keeps each running agent's time, but only that part changes; the image is not replaced every second.
2. **One superlite session per map.** The map shows the superlite session it is open in (named, with its own colour), not every agent ever started in the project; switching superlite session (`session use`) switches the map.
3. **Opens by itself.** When a run starts (a superlite run, or, since the plugin is general, any burst of subagents), the agent map pane opens without a command, once per run. An option picks which.
4. **A scrollable ledger.** The pane's ledger (`progress.md` lines) shows every line, not only the last few, and scrolls inside its own box.
5. **Task names on the map.** Each task id shows its name from the plan (`T3 · session scope`), and a superlite agent's box is titled by the task it is on now, not its first launch description.
6. **Hide finished agents.** A toggle in the pane hides agents that are no longer running; on by default.

## What changes

### Part 1: the blink

- **Desktop graph:** each running agent's time ticks by itself inside the drawing (an animated clock in its box). The image is rebuilt only when anything about the session's agents changes (an agent appears or leaves, or its status, tier, tasks, title or parent changes; the superlite session switches), when the pane width or a clock band changes, after a card's details and back, on reopen, and once a minute (resync, below).
- **Graph node meta line:** tier, the live time and tokens. Tokens are not in the graph cache key: the graph shows them as of its last rebuild (the 1-minute resync or any agent change), so they refresh at least every minute with no extra blinks. The list under the graph and the card details keep live tokens.
- **Text list and terminal surface:** unchanged (`tier · elapsed · tokens · tasks`, ticking every second).
- **Done or aborted agents:** a fixed time, as today.
- **Resync, in case the clock drifts:** while any agent runs, the graph cache key also holds a resync epoch, `floor(now / RESYNC_MS)` with `RESYNC_MS` = 1 min (your choice). So the SVG is rebuilt with a fresh `begin` at least that often, on top of the other rebuilds (status or band change, details and back, reopen).
  - *Why drift can happen:* the SVG's own timeline can pause while the pane is hidden, the window is in the background or the machine sleeps, and the mod cannot read the SVG's clock to check it.
  - *Cost:* one image swap (one blink) a minute while agents run; none while nothing runs. Tokens ride along on these rebuilds and never trigger one, since they change every few seconds.

### Part 2: the map follows the superlite session

**What is wrong (diagnosed):** the map builds its cards from two sources and joins them (`mergeCards` in `hooks/model.ts`):

- this Claude session's own agents (live events and `$.agent.list()`), and
- every `launch` and `stop` row in `<dir>/.superlite/metrics.jsonl`.

`metrics.jsonl` is written by superlite's hooks for every Claude session working in that checkout, and its rows carry no session id. The folder is also remembered across sessions (`$.store` `dir`), so a later session can keep showing an old run. Nothing on the map says which superlite session it shows, and switching superlite session (`superlite-cli session use <slug>`) does not visibly change it.

**What identifies a superlite session today (checked in superlite 3.0.0):**

- `<host>/.superlite/sessions.json` (the registry, always in the main checkout): `active` slug, and per session `slug`, `branch`, `worktree`, `status` (`active` | `parallel`), `created_at`.
- The **active** session's run files (`metrics.jsonl`, `pool.json`, `progress.md`, ...) live in `<host>/.superlite/`. `session use <slug>` parks them into `.superlite/session-store/<old slug>/` and restores the new slug's, so the files at the host always belong to the active slug.
- A **parallel** session has its own worktree (`.superlite/worktrees/sessions/<slug>`) and its own `<worktree>/.superlite/` run files; the capture hooks write to the nearest `.superlite` at or above the agent's working directory.

So the map can tell, with no superlite change, which superlite session a folder belongs to and when it switches.

**The change:**

- **Scope = one superlite session.** On each refresh the map reads the registry (walking up from its folder to the checkout that holds `.superlite/sessions.json`) and picks the session: the row whose `worktree` is the Claude session's working directory; at the host, the `active` slug. It reads that session's run files (`<worktree>/.superlite/`).
- **Switching shows.** The registry is re-read on each refresh, like the other files. When the slug changes, the map drops its cards and starts from the new session's records, so a `session use` switch shows within a refresh.
- **The map looks different per session:** the header names the slug and branch (`agent-map-blink · superlite/sessions/agent-map-blink · 3 agents · 1 active`), the main node is labelled with the slug, and each slug gets its own accent colour (a stable hash of the slug into a small palette) on the main node and header.
- **Outside superlite sessions** (no registry): today's view of the folder's records, header `no superlite session`.
- **Stale rows:** rows older than the session row's `created_at` are dropped (an earlier run's leftovers).
- The remembered folder becomes per Claude session (`$.state`, not `$.store`), so a new Claude session starts on its own working directory.
- **superlite follow-up (other repo, not this change):** `capture-agent-launch` / `capture-agent-stop` add `"slug"` and `"session"` (Claude session id) to each row, so rows stay attributed if run files are moved by hand. The map works without it.

### Part 3: the map opens when a run starts

**What the mod can see as a run start:**

- **In this Claude session:** `agent.spawn` / `classic.SubagentStart` for a superlite agent (`subagentType` starting `superlite:`). Seen at once.
- **From the files** (a run in another process, or one started before the map loaded): on refresh (every 3 s), the superlite session's `.superlite/` gains a run marker: `pool.json`, a `metrics.jsonl` launch row newer than the session's `created_at`, or `feature.json` with `status: "building"`.
- **A superlite-side hook cannot open the pane:** hooks run shell scripts and cannot call the mod's `open_agent_map` tool. A superlite skill could tell the model to call it (`/superlite:agents` already does on request), but that costs a model turn and depends on the model following it. So the mod opens the pane itself, and no superlite change is needed.

**General trigger (no superlite):** any subagent spawn in this Claude session (`agent.spawn` / `classic.SubagentStart`, any type). Its run key is `agents:<t>`, with `<t>` the time of the first spawn after the session had no busy agents (main idle aside). So a burst of agents is one run; the next burst after all of them finished is a new run.

**The option:** a plugin option `autoOpen` in `plugin.json` `userConfig`, one of:

- `agents` (*recommended default*): the general trigger plus both superlite signals. Works without superlite; with superlite, a superlite run opens it too, from the files as well.
- `superlite`: only the superlite signals.
- `off`: never opens by itself.

The mod reads the option at `session.start`; how a mod reads `userConfig` is checked in the build (if it cannot, the fallback is `/claude-agent-map auto agents|superlite|off`, kept in `$.store`).

**Once per run, so a closed pane stays closed:** the mod keeps the key of the last run it opened for (`<slug>:<run start>` for a superlite run, the run start being the first superlite spawn's time or `pool.json`'s mtime; `agents:<t>` for a general run) in `$.state`. It opens the pane only for a key it has not opened for yet. Closing the pane leaves the key in place, so the same run never reopens it; the next run (new key) does. The mod has no pane-closed event to listen to, and needs none. `/claude-agent-map` still opens it any time.

### Part 4: a scrollable ledger in the pane

**What is wrong (checked):** the pane's ledger is cut, not scrolled: the main view draws `f.ledger.slice(-8)` and a card's details `ledgerFor(...).slice(-12)` (`hooks/register.tsx`). Older lines are dropped from the tree, so there is nothing to scroll back to, on either surface.

**What the mod UI offers (2.1.309 types):** no nested scroll box (`Box` has `overflow: 'visible' | 'hidden'` only). A pane's body scrolls as a whole, in an engine-owned window (`scroll.offset`, `scroll.bodyRows` on the render event). The `ui.scroll` event fires before that window moves (wheel, arrows, page keys), with a signed `by`. A hook can take the move for its own rows instead of the pane's, and `$.ui.scroll({ in, to })` brings an element into view.

**The change:**

- **Ledger box:** the ledger becomes its own window of `LEDGER_ROWS` rows (10), in a bordered `Box` with `overflow: 'hidden'`, over all of `progress.md`'s lines. A `ledgerOffset` in `$.state` (per pane view: main, or the card shown) says where it stands; it starts at the end (newest) and stays pinned there while new lines arrive, until the person scrolls up.
- **Scrolling it:**
  - Buttons above and below the box, `▲ older (n)` and `▼ newer (n)` (n lines out of view; `End` jumps back to the newest). They work on terminal and desktop alike, and by keyboard while the pane has focus.
  - The wheel: a `ui.scroll` hook on the pane moves the ledger by `e.by` when the pane body is already at its end (the ledger is the last thing in the pane) and the ledger has lines that way. Otherwise the pane scrolls as today.
- **The same in a card's details:** the card's ledger lines use the same box.
- **Pulled out of `register.tsx`:** `hooks/ledger.tsx` holds `ledgerWindow(lines, offset, rows)` (pure, tested in `tests/model.test.ts`) and the `LedgerBox` drawing, so the task owning it does not touch the graph or session work.
- **No blink:** the ledger is outside the SVG, so scrolling it never rebuilds the graph.

### Part 5: task names on the map

**What is wrong:** the map shows bare task ids (`T3 T4`), and each superlite agent's box is titled by its launch description. superlite reuses an agent for later tasks (the pool), so that description goes stale: an agent launched for T3 still says "T3 ..." while it builds T7.

**Where the names come from (checked):** the run's machine plan, whose path superlite records in the run's `.superlite/`. The mod reads, first found wins, paths relative to the folder holding that `.superlite/`:

1. `checkpoints.json` `plan` (the plan being built: the proto plan in a prototype, the integration plan later),
2. `feature.json` `plan`,
3. `orchestrator.json` `review_path`.

It parses the task headings, `### T<n> <name> · ...` (the name runs up to the first ` · `). A plan with no task headings (the feature plan) or no plan at all: ids show alone, as today. The plan is read on refresh, only when its mtime moved.

**The change:**

- **Task chips:** each id shows `T3 · session scope` in the card list and the card details (full name). On the graph the tasks line is clipped as today (the name shortened first, the ids kept), and the node's `<title>` tooltip holds the full names.
- **Box title for superlite agents:** the task in flight from `pool.json` `current` (a batch `T3,T5` -> the first, then `+1`), e.g. `T3 · session scope`. When the agent is idle (no `current`), its last task with a ✓. Non-superlite agents keep their description.
- **No new blinks:** names and titles change only when a task changes, which is an agent change, so they ride the existing rebuild.

### Part 6: hide finished agents

- **Toggle:** a button in the header, `Hide finished` on by default. While on, done and aborted agents leave the graph and the list, and the button reads `Show finished (n)`, n the hidden count; pressing it shows them again and it reads `Hide finished`. Works on terminal and desktop.
- **Kept for structure:** a finished agent with a running descendant stays (greyed), so a running child never loses its parent in the tree.
- **Nothing running:** the map shows the main session and `No running agents · Show finished (n)`.
- **Remembered:** the choice is kept across sessions (`$.store`), since it is a preference; default on.
- **Header counts** stay the full ones (`9 agents · 1 active`), so hiding never hides that agents ran.
- **No new blinks:** a toggle press or an agent finishing changes the node set, which is already an agent change; the toggle state joins the graph cache key.



```mermaid
flowchart LR
  subgraph superlite["superlite (other repo, unchanged)"]
    hooks_sl["capture-agent-launch / capture-agent-stop hooks"]
    cli["superlite-cli session use / ensure"]
  end

  subgraph records["Records on disk"]
    registry[".superlite/sessions.json<br/>active slug, worktrees, created_at"]
    runfiles["&lt;worktree&gt;/.superlite/<br/>metrics.jsonl, pool.json,<br/>progress.md, feature.json"]
    parked[".superlite/session-store/&lt;slug&gt;/<br/>parked run files"]
    transcripts["~/.claude/projects/.../&lt;session-id&gt;/<br/>subagents/agent-&lt;id&gt;.jsonl"]
  end

  subgraph host["Claude Code (this session)"]
    events["agent.spawn / SubagentStart / SubagentStop"]
    clock["$.clock.every 1 s"]
    cfg["plugin.json userConfig<br/>autoOpen: agents | superlite | off"]
  end

  subgraph mod["claude-agent-map mod"]
    hooksjson["hooks/hooks.json"]
    register["hooks/register.tsx<br/>register(): refresh, pane, command, tool"]
    model["hooks/model.ts<br/>parseMetrics, mergeCards,<br/>pickSession, slugColour, runKey"]
    graph["hooks/graph.ts<br/>graphSvg, box, liveClock (SMIL)"]
    ledger["hooks/ledger.tsx<br/>ledgerWindow, LedgerBox"]
    state["$.state<br/>dir, opened run key, graph cache"]
  end

  subgraph pane["Agent map pane"]
    header["Header: slug · branch · N agents"]
    svg["Desktop graph (Svg)<br/>tier · ticking clock · tokens"]
    list["List: tier · elapsed · tokens · tasks<br/>(redrawn every second)"]
    ledgerbox["Ledger box: 10 rows<br/>▲ older / ▼ newer, wheel at end"]
  end

  hooks_sl -->|append rows| runfiles
  cli -->|write active slug| registry
  cli -->|park / restore| parked
  parked <--> runfiles

  hooksjson --> register
  events -->|live agents| register
  cfg -->|autoOpen mode| register
  clock -->|tick: now| register
  register -->|every 3 s: read| registry
  register -->|every 3 s: read| runfiles
  register -->|tokens| transcripts
  register <--> state

  register -->|registry, rows, live agents| model
  model -->|cards for one superlite session<br/>+ run key| register
  register -->|"new run key and mode allows: $.ui.open"| pane

  register -->|"cache key changed?<br/>(agent change, slug switch, width,<br/>clock band, 1-min epoch)"| graph
  graph -->|"SVG with begin = elapsed<br/>(tokens as of rebuild)"| svg
  register --> header
  register --> list
  register -->|"progress.md lines + ledgerOffset"| ledger
  ledger --> ledgerbox
  ledgerbox -->|"button press / ui.scroll by"| register
```

**Reading it:**

- **One superlite session:** `register.tsx` reads `sessions.json` and that session's run files every 3 s. `model.ts` picks the session (this worktree, or the active slug at the host), drops rows older than its `created_at`, and merges them with the live agents. A `session use` switch changes the registry and the run files, so the next refresh shows the other session with its own header and colour.
- **No blink:** the 1 s tick redraws only the list. The SVG is rebuilt only when the graph cache key changes: any agent change, a slug switch, the pane width, a clock band, or the 1-minute resync epoch. In between, the SMIL clock inside the SVG ticks on its own. Tokens are drawn as of the last rebuild.
- **Auto-open:** a spawn (or new run files) gives `model.ts` `runKey`. If `autoOpen` allows it and the key differs from the one kept in `$.state`, the pane opens and the key is stored, so a pane you close stays closed for that run.

## Open choices (your call; my recommendation first)

1. **Resync period:** decided (your answer): 1 min, plus a rebuild on any change to the session's agents.
2. **Which superlite session the map shows.**
   - *Recommended:* the one this Claude session works in (its worktree; the active slug at the host). Switching with `session use` switches the map.
   - Alternative: a pick list in the pane of every slug in the registry, defaulting to the above.
3. **Several Claude sessions inside one superlite session** (for example side sessions working in the same checkout).
   - *Recommended:* show every agent of the superlite session, whichever Claude session started it.
   - Alternative: also narrow to this Claude session's agents (stop rows whose transcript lies under `<session-id>/subagents/`, plus live agents).
4. **`/claude-agent-map <dir>`:** *Recommended:* show the superlite session that folder belongs to, named in the header (as today otherwise).
5. **Auto-open trigger:** decided (your answer): both superlite signals, once per run key, plus a general trigger for any subagents.
6. **Ledger scrolling.**
   - *Recommended:* its own 10-row box with older/newer buttons, plus the wheel once the pane is at its end.
   - Alternative: draw the whole ledger in the pane and let the pane's own scroll reach it (simpler, but a long ledger pushes the agent list out of view).
7. **Box title when a superlite agent is idle.**
   - *Recommended:* its last task with a ✓ (`T3 · session scope ✓`).
   - Alternative: back to its launch description.
8. **`autoOpen` default.**
   - *Recommended:* `agents` (the plugin is general; superlite runs open it too).
   - Alternative: `superlite` (quieter for people who spawn agents often outside superlite).
9. **The superlite side** (slug and session id in metrics rows): *Recommended:* a separate follow-up in the superlite repo.

## Acceptance checks

Part 1:
- With one agent running, two renders of the desktop pane one second apart give the identical SVG source; the agent's row in the text list changes (its time ticked).
- A running agent's SVG holds an animated clock (SMIL, `repeatCount="indefinite"`) that starts at its elapsed time when the graph was built.
- A status change (the agent finishes) gives a different SVG, with a fixed time for that agent.
- Tokens growing within 60 s (no other agent change): the SVG stays identical, the list shows the new count (`sonnet · 1m 0s · 1.5k tok · T3 T4`); after 60 s the SVG shows the new count.
- Leaving the graph for a card's details and coming back, or reopening the pane, shows the right time.
- With one agent running, advancing the mock clock past 60 s changes the SVG source, and its `begin` matches the new elapsed time; within 60 s and with no agent change, renders stay identical.
- A change to an agent's title, tier, tasks or parent, or a new agent, changes the SVG source at once.

Part 2:
- With a registry whose active slug is `a` and host run files for `a`, the header names `a` and its branch and the map shows `a`'s agents.
- After the active slug changes to `b` (and the host files are `b`'s), the next refresh shows only `b`'s agents, header `b`, a different accent colour.
- A map whose working directory is a parallel session's worktree shows that slug and that worktree's records.
- Rows older than the session's `created_at` are left out.
- With no registry, the map shows the folder's records and says `no superlite session`.
- A Claude session opened after `/claude-agent-map <other dir>` in an earlier one starts on its own working directory.

Part 3:
- A `superlite:implementer` spawn in a session with the pane closed opens the pane; a second spawn in the same run does not open it again.
- After the pane is closed mid-run, later spawns and refreshes of that run do not reopen it; a new run (new key) does.
- `pool.json` appearing for the session's slug opens the pane on the next refresh.
- General trigger (`autoOpen: agents`, no `.superlite`): an `Explore` spawn opens the pane; more spawns while it is busy do not; after all agents finish, the next spawn opens it again (new run), unless the pane was closed during the same run.
- `autoOpen: superlite`: an `Explore` spawn does not open the pane; a `superlite:implementer` spawn does.
- `autoOpen: off`: no spawn or file opens the pane; `/claude-agent-map` still does.

Part 4:
- With 40 ledger lines, the pane shows a 10-line box ending at the newest line, and `▲ older (30)`; pressing it shows older lines, `▼ newer` brings them back; on terminal and desktop.
- A new ledger line while the box is at the end shows at once; while scrolled up, the box stays where it is and `▼ newer (n)` counts up.
- A `ui.scroll` of `by: -3` with the pane at its end moves the ledger 3 lines; with the pane not at its end it moves the pane, not the ledger.
- A card's details show its ledger lines in the same box; nothing older is dropped.
- Scrolling the ledger leaves the SVG source unchanged.

Part 6:
- With 3 done agents and 1 running, the pane shows only the running one and `Show finished (3)`; pressing it shows all 4 and `Hide finished`; on terminal and desktop.
- A done parent of a running child stays shown while hiding.
- All done: `No running agents · Show finished (n)`.
- The choice survives a new session (`$.store`); a fresh install starts with hiding on.
- Toggling changes the SVG; with no press and no agent change, the SVG stays identical.

Part 5:
- With a proto plan holding `### T3 session scope · Complexity 4` recorded as the run's plan, a card with tasks T3 T4 shows `T3 · session scope`; the details show the full name; the SVG tooltip holds it.
- An agent whose `pool.json` `current` is `T7` is titled `T7 · pane wiring`, whatever its launch description; when `current` moves to another task the title (and the SVG) changes at once.
- An idle superlite agent is titled by its last task with ✓; an `Explore` agent keeps its description.
- No plan found, or a plan without task headings: ids alone, no error.

Both: all existing tests pass on terminal and desktop.

## Code map

- **Entry point:** `hooks/hooks.json` → `hooks/register.tsx` (`register`). Tests: `claude plugin test <repo>` with the desktop app's 2.1.309 build (baseline 24 pass).
- **Tick:** `register.tsx` `session.start` → `$.clock.every(1000, …)` writes the `now` atom while anything is busy; the Pane `ui.render` reads it, so the whole Pane redraws each second (kept for the text list).
- **Graph:** `register.tsx` builds `GraphNode[]` and calls `graphSvg` in `hooks/graph.ts`; `box()` draws each node.
- **Cards:** `hooks/model.ts` `mergeCards(live, files, usage)` joins live agents with `files.launches` / `files.stops` (from `parseMetrics`); `fileActive` marks file-only agents active. `refresh()` in `register.tsx` reads `metrics.jsonl`, `pool.json`, `progress.md` and transcripts from `files.dir`, which `show()` sets and `$.store` remembers.
- **Interfaces that must not change:** pane id and title, command `claude-agent-map [project dir]`, tool `open_agent_map`, `graphSvg(main, nodes, maxWidth) -> { source, width, height }`, `treeOrder`, the `Svg` stays `isInteractive` (SMIL needs it). `mergeCards` gains an optional filter argument; existing calls keep working.
- **Tests:** `tests/pane.test.tsx` (mounts the Pane on terminal and desktop; `mock.clock` gives `advance(ms)`), `tests/model.test.ts` (pure helpers and `graphSvg`).
- **Surface limits:** a `Client` module cannot draw `Svg`, and any change to an `Svg` source replaces the image; so only the SVG animating itself can update part of the graph.

## Where the build stands

The prototype worktree (`.superlite/sandboxes/agent-map-blink-proto`, branch `superlite/agent-map-blink-proto`) has:
- **T1 graph clock:** done and checkpointed, tests pass (`clockBand`, `liveClock`, `GraphNode.clockMs`).
- **T2 pane meta and cache:** stopped partway; to be resumed.
- **T3 superlite session scope:** new, after approval (`model.ts`: registry parse, session pick, slug colour, row time bound + tests; `register.tsx`: registry read on refresh, reset on slug change, header and main node, folder in `$.state`).
- **T5 scrollable ledger:** new, after approval (`hooks/ledger.tsx` new: `ledgerWindow` + `LedgerBox`; `tests/model.test.ts` window cases, `tests/pane.test.tsx` buttons and scroll; the `register.tsx` mount and `ui.scroll` hook go to T2's register edits so Owns stay disjoint).
- **T10 hide finished:** new (`hooks/register.tsx` toggle, filter and tests, after T9; pure `visibleCards` in `hooks/filter.ts` + tests).
- **T8 task names:** new, after approval (`hooks/tasks.ts` new: `planPaths`, `parseTaskNames`, `agentTitle`, `taskLabel` + `tests/tasks.test.ts`; the `register.tsx` reads and drawing go to T7).
- **T4 auto-open:** new, after approval (`model.ts`: `runKey(mode, files, registry, spawn, busy)` + tests; `register.tsx`: read `autoOpen`, open on a new key from spawn and refresh, key in `$.state`; `plugin.json` `userConfig`).

## Prototype scope

L1, nothing to stub (the mod has no backend). Keep `graph.ts`, `model.ts`, `register.tsx` and both test files; the acceptance checks become the tests.

## Integration outline

- Port T1 to `hooks/graph.ts`, T2 to `hooks/register.tsx`, T3 to `hooks/model.ts` + `hooks/register.tsx` (+ main-node accent in `graph.ts`), T4 to `hooks/model.ts` + `hooks/register.tsx`, T5 to `hooks/ledger.tsx` + the `register.tsx` mount, with their tests.
- README: the graph shows tier, live time and tokens (refreshed each minute); the list shows time and tokens; the map shows one superlite session, named in the header, and follows `session use`; it opens by itself once per run; the ledger scrolls in its own box.
- Follow-up in the superlite repo: slug and session id in each metrics row.

Ruling: [scope] tokens stay in the graph but out of its cache key, refreshed by the 1-minute resync and agent changes (user's choice) - keying on them would swap the image every few seconds - cost if wrong: graph tokens up to a minute behind the list.
Ruling: [design] the clock is a SMIL odometer (one clipped digit strip per place, discrete `animateTransform`, negative `begin` = elapsed at build) - the only in-image update the Svg leaf allows - cost if wrong: on a surface that drops SMIL the clock stays at the build time.
Ruling: [design] the graph cache key holds a clock band per running agent (`m:ss` under 10 min, `mm:ss` under 1 h, `h:mm:ss` after), so the graph rebuilds once at 10 min and at 1 h - cost if wrong: two blinks per long-running agent.
Ruling: [design] a resync epoch `floor(now / RESYNC_MS)` in the graph cache key rebuilds a running graph at least every period - the SVG timeline can pause while hidden or asleep and the mod cannot read it - `RESYNC_MS` = 60 s by the user's choice - cost if wrong: one blink a minute.
