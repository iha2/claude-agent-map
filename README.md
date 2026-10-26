# superlite-agents

A read-only **agent map** pane for [superlite](https://github.com/iha2/superlite) runs in Claude Desktop. It sits beside the transcript and shows the main session and every subagent as a tree, each under the agent that spawned it.

Each node shows:

- its **tier** (haiku, sonnet or opus), **time** and **tokens**
- the superlite **tasks** it worked on (✓ once checkpointed)
- a status colour: **green** while it runs, **red** if it was aborted or blocked, **grey** when done

Click a row for its details and its ledger lines. The pane only reads; it never changes a run.

## Install

```
/plugin marketplace add iha2/superlite
/plugin install superlite-agents@superlite-dev
```

Installing `superlite` from the same marketplace pulls this plugin in automatically, because superlite lists it as a dependency.

## Use

```
/superlite-agents [project dir]
```

Opens the pane. Give it a project folder (or its `.superlite` folder) to point the map at that project; leave it out to use the working directory. The folder is remembered for next time.

Claude can also open the pane itself: the plugin registers a tool for it, so asking "show me the agent map" while a superlite run is going works too.

superlite offers the map when you approve a plan (reply `approve map`) and through `/superlite:agents`.

## Where the data comes from

The pane reads the run's `.superlite` folder (`metrics.jsonl` and `progress.md`) and the session transcripts. Token counts follow superlite's own `metrics.py`: usage per assistant message, deduplicated by message id.

## Without Claude Desktop

This is a Claude Desktop mod. In a terminal session or another harness, use `/superlite:tail` from superlite instead. It prints the same run as a live feed.

## Development

```
hooks/        pane and command registration (register.tsx), parsing and merging (model.ts, graph.ts)
tests/        model.test.ts, pane.test.tsx
types/        type declarations for the mod API
```

This repo was split out of `mods/agent-map` in [iha2/superlite](https://github.com/iha2/superlite), with its history kept.

## License

MIT
