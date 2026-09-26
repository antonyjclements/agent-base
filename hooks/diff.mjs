/**
 * A small unified diff, so the installer can show exactly what it is about to write without
 * depending on `diff` or `git` being on the machine. Line-based, with three lines of context.
 */
const lines = (s) => {
  const parts = s.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

export function unifiedDiff(before, after, file, { context = 3, isNew = false } = {}) {
  if (before === after) return ''
  const a = lines(before)
  const b = lines(after)
  const n = a.length
  const m = b.length
  // Longest common subsequence, filled from the end so the walk below reads front to back.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push([' ', a[i++], j++ && 0])
    else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) ops.push(['+', b[j++]])
    else ops.push(['-', a[i++]])
  }

  // Group the changes into hunks with their context.
  const changed = ops.map(([t], k) => (t === ' ' ? -1 : k)).filter((k) => k >= 0)
  const hunks = []
  for (const k of changed) {
    const last = hunks[hunks.length - 1]
    if (last && k - last.end <= context * 2 + 1) last.end = k
    else hunks.push({ start: k, end: k })
  }
  const out = [`--- ${isNew ? '/dev/null' : file}`, `+++ ${file}`]
  for (const { start, end } of hunks) {
    const from = Math.max(0, start - context)
    const to = Math.min(ops.length - 1, end + context)
    let aStart = 1
    let bStart = 1
    for (let k = 0; k < from; k++) {
      if (ops[k][0] !== '+') aStart++
      if (ops[k][0] !== '-') bStart++
    }
    const slice = ops.slice(from, to + 1)
    const aLen = slice.filter(([t]) => t !== '+').length
    const bLen = slice.filter(([t]) => t !== '-').length
    out.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`)
    for (const [t, text] of slice) out.push(t + text)
  }
  return out.join('\n')
}
