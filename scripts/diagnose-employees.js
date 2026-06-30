/**
 * Diagnostic: show how many `employee` rows exist by employee_status.
 * Explains why the dashboard "Team" count can differ from the Team screen tabs.
 * Run: node scripts/diagnose-employees.js   (requires AZURE_SQL_* in env / .env)
 */
require('dotenv/config')
const sql = require('mssql')

const config = {
  server: process.env.AZURE_SQL_SERVER,
  database: process.env.AZURE_SQL_DATABASE,
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options: { encrypt: (process.env.AZURE_SQL_ENCRYPT ?? 'true') === 'true', trustServerCertificate: false },
  connectionTimeout: 30000,
}

;(async () => {
  const pool = await sql.connect(config)

  const total = await pool.request().query(
    `SELECT COUNT(*) AS n FROM dbo.profiles WHERE role = 'employee'`
  )
  const breakdown = await pool.request().query(
    `SELECT ISNULL(employee_status, '(null)') AS status, COUNT(*) AS n
       FROM dbo.profiles WHERE role = 'employee'
      GROUP BY employee_status
      ORDER BY n DESC`
  )
  const rows = await pool.request().query(
    `SELECT TOP 50 name, email, ISNULL(employee_status, '(null)') AS status, active, created_at
       FROM dbo.profiles WHERE role = 'employee'
      ORDER BY created_at DESC`
  )

  console.log(`\nTotal role='employee' rows (dashboard "Team" count): ${total.recordset[0].n}\n`)
  console.log('Breakdown by employee_status (Team screen only shows pending + approved):')
  console.table(breakdown.recordset)
  console.log('\nEmployees:')
  console.table(rows.recordset)

  await pool.close()
})().catch((e) => { console.error(e); process.exit(1) })
