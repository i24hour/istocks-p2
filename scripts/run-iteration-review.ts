import 'dotenv/config'

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  evaluateReplay,
  loadIterationCases,
  replayIterationCase,
  summarizeReplayResults,
  type IterationReplayResult,
} from '@/lib/iteration-review'

const batchSizeArg = Number(process.argv[2] || '25')
const batchSize = Number.isFinite(batchSizeArg) ? Math.max(1, Math.min(100, batchSizeArg)) : 25

async function main() {
  const startedAt = new Date()
  const results: IterationReplayResult[] = []
  let offset = 0

  console.log(`[iteration] Starting full replay sweep with batch size ${batchSize}`)

  while (true) {
    const cases = await loadIterationCases(batchSize, offset)
    if (cases.length === 0) {
      break
    }

    console.log(`[iteration] Loaded batch offset=${offset} count=${cases.length}`)

    for (const [index, caseItem] of cases.entries()) {
      const label = `${offset + index + 1}`.padStart(4, '0')
      try {
        const { reply } = await replayIterationCase(caseItem)
        const evaluated = evaluateReplay(caseItem, reply)
        results.push(evaluated)
        console.log(`[iteration] ${label} ${evaluated.status.toUpperCase()} score=${evaluated.score} source=${caseItem.source} mode=${caseItem.mode}`)
      } catch (error: any) {
        const evaluated = evaluateReplay(caseItem, `Replay failed: ${error?.message || 'Unknown error'}`)
        results.push(evaluated)
        console.log(`[iteration] ${label} FAIL replay-error=${error?.message || 'Unknown error'}`)
      }
    }

    offset += cases.length
  }

  const summary = summarizeReplayResults(results)
  const finishedAt = new Date()
  const durationMs = finishedAt.getTime() - startedAt.getTime()

  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    batchSize,
    summary,
    results,
  }

  const logsDir = path.join(process.cwd(), 'logs', 'iteration')
  await mkdir(logsDir, { recursive: true })

  const fileName = `iteration-review-${finishedAt.toISOString().replace(/[:.]/g, '-')}.json`
  const filePath = path.join(logsDir, fileName)
  await writeFile(filePath, JSON.stringify(report, null, 2), 'utf8')

  console.log(`[iteration] Completed. Total=${summary.total} Pass=${summary.pass} Warning=${summary.warning} Fail=${summary.fail}`)
  console.log(`[iteration] Improved=${summary.improved} DissatisfiedCases=${summary.dissatisfiedCases}`)
  console.log(`[iteration] Report saved to ${filePath}`)
}

main().catch((error) => {
  console.error('[iteration] Fatal error:', error)
  process.exitCode = 1
})