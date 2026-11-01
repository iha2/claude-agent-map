# claude-agent-map

A read-only **agent map** pane for Claude Desktop. It sits beside the transcript and shows the main session and every subagent as a tree, each under the agent that spawned it. It was built for [superlite](https://github.com/iha2/superlite) runs, which add task and ledger detail.

Each node shows:

- its **tier** (haiku, sonnet or opus), live **time** and **tokens** in the graph (the clocks run on their own; the graph is redrawn each minute, which refreshes the tokens and re-anchors the clocks)
- the superlite **tasks** it worked on (✓ once checkpointed), named from the run's plan (`T3 · session scope`) when one is found, ids alone otherwise
- a status colour: **green** while it runs, **red** if it was aborted or blocked, **grey** when done

The map shows **one superlite session**: its slug, branch and colour head the pane and the main box, and it follows `session use`. With no session registry it says so and shows whatever the folder holds.

The coordinator's **ledger** scrolls in its own box (10 rows, with older and newer buttons; the wheel moves it once the pane is at its end). Click a row for its details and its ledger lines. The pane only reads; it never changes a run.

The pane **opens by itself once per run** (set `autoOpen`: `agents` for any subagent run, `superlite` for superlite runs only, `off` for never). Close it and it stays closed until the next run.

## Install

```
/plugin marketplace add iha2/superlite
/plugin install claude-agent-map@superlite-dev
```

Installing `superlite` from the same marketplace pulls this plugin in automatically, because superlite lists it as a dependency.

## Use

```
/claude-agent-map [project dir]
```

Opens the pane. Give it a project folder (or its `.superlite` folder) to point the map at that project; leave it out to use the working directory. Each Claude session starts at its own working directory.

Claude can also open the pane itself: the plugin registers a tool for it, so asking "show me the agent map" while a run is going works too.

superlite offers the map when you approve a plan (reply `approve map`) and through `/superlite:agents`.

## Where the data comes from

The pane reads session transcripts and, for superlite runs, the run's `.superlite` folder (`metrics.jsonl` and `progress.md`). Token counts follow superlite's own `metrics.py`: usage per assistant message, deduplicated by message id.

## Without Claude Desktop

This is a Claude Desktop mod. In a terminal session or another harness, use `/superlite:tail` from superlite instead. It prints the same run as a live feed.

## Development

```
hooks/        pane and command registration (register.tsx), parsing and merging (model.ts, graph.ts)
tests/        model.test.ts, pane.test.tsx
types/        type declarations for the mod API
```

The plugin was called `superlite-agents` until it moved to this repo, and the command was `/superlite-agents`.

This repo was split out of `mods/agent-map` in [iha2/superlite](https://github.com/iha2/superlite), with its history kept.

## License

MIT

Finished agents are hidden by default (running ones and their parents stay); the **Show finished (n)** / **Hide finished** button in the header toggles them, and the choice is remembered.
