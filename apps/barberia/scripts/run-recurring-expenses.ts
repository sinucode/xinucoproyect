// scripts/run-recurring-expenses.ts — ejecuta a mano el registro de gastos fijos + avisos.
//
//   npx tsx scripts/run-recurring-expenses.ts                     → simulación (no escribe ni envía nada)
//   npx tsx scripts/run-recurring-expenses.ts --apply             → registra gastos y envía los avisos
//   npx tsx scripts/run-recurring-expenses.ts --today=2026-10-01  → simula otro día (YYYY-MM-DD)
//
// Usa SUPABASE_SERVICE_ROLE_KEY de .env.local (apunta a la base real: cuidado con --apply).
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { businessTodayISODate } from '../lib/agenda-time'
import { runRecurringExpenses } from '../lib/recurring-expenses'

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

async function main() {
  loadEnvFile(path.resolve(__dirname, '..', '.env.local'))

  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const todayArg = args.find(a => a.startsWith('--today='))?.slice('--today='.length)
  if (todayArg && !/^\d{4}-\d{2}-\d{2}$/.test(todayArg)) {
    throw new Error('--today debe tener el formato YYYY-MM-DD')
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local')

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const todayKey = todayArg ?? businessTodayISODate()

  console.log(`Gastos fijos — hoy=${todayKey} — ${apply ? 'APLICANDO (escribe y envía correos)' : 'simulación (dry-run)'}`)
  const summary = await runRecurringExpenses(supabase, { todayKey, dryRun: !apply })
  console.log(JSON.stringify(summary, null, 2))
  if (!apply) console.log('\nSimulación: no se registró ni se envió nada. Usa --apply para ejecutarlo de verdad.')
  if (summary.errors.length > 0) process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
