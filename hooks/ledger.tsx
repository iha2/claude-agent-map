// The progress ledger in its own scrollable box. Pure window maths plus a JSX box;
// the caller passes the elements (`$.ui.resolve(e)`), so this never imports the engine.
export const LEDGER_ROWS = 10

const rowsOf = (rows: number): number => (Number.isFinite(rows) && rows >= 1 ? Math.floor(rows) : 1)

/** The lines to show: `offset` is the first line, null pins the window to the end. */
export function ledgerWindow(
  lines: string[],
  offset: number | null,
  rows: number = LEDGER_ROWS,
): { shown: string[]; start: number; older: number; newer: number } {
  const n = rowsOf(rows)
  const max = Math.max(0, lines.length - n)
  const start = offset === null || !Number.isFinite(offset) ? max : Math.min(max, Math.max(0, Math.floor(offset)))
  const shown = lines.slice(start, start + n)
  return { shown, start, older: start, newer: lines.length - start - shown.length }
}

/** The offset after scrolling `by` lines (negative = older); the end pins again as null. */
export function ledgerMove(lines: number, offset: number | null, by: number, rows: number = LEDGER_ROWS): number | null {
  const max = Math.max(0, lines - rowsOf(rows))
  const from = offset === null ? max : Math.min(max, Math.max(0, offset))
  const next = Math.min(max, Math.max(0, from + by))
  return next >= max ? null : next
}

export function LedgerBox(p: {
  el: { Box: any; Text: any; Button: any }
  id: string
  title: string
  lines: string[]
  offset: number | null
  onMove: (offset: number | null) => unknown
}) {
  if (p.lines.length === 0) return null
  const { Box, Text, Button } = p.el
  const w = ledgerWindow(p.lines, p.offset)
  const total = p.lines.length
  return (
    <Box flexDirection="column">
      <Text bold>{p.title}</Text>
      {w.older > 0 ? (
        <Button key={`ledger-older-${p.id}`} plain onPress={() => p.onMove(ledgerMove(total, p.offset, -LEDGER_ROWS))}>
          <Text dimColor>{`▲ older (${w.older})`}</Text>
        </Button>
      ) : null}
      <Box key={`ledger-${p.id}`} borderStyle="round" overflow="hidden" flexDirection="column">
        {w.shown.map((line, i) => (
          <Text key={`${w.start + i}`} wrap="truncate">
            {line}
          </Text>
        ))}
      </Box>
      {w.newer > 0 ? (
        <Box>
          <Button key={`ledger-newer-${p.id}`} plain onPress={() => p.onMove(ledgerMove(total, p.offset, LEDGER_ROWS))}>
            <Text dimColor>{`▼ newer (${w.newer})`}</Text>
          </Button>
          <Text> </Text>
          <Button key={`ledger-end-${p.id}`} plain onPress={() => p.onMove(null)}>
            <Text dimColor>End</Text>
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}
