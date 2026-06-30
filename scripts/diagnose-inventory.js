/**
 * Diagnostic: reconcile the dashboard "Out of Stock" / "Low Stock" counts with
 * the variants the inventory list would actually show.
 * Run: node scripts/diagnose-inventory.js   (requires AZURE_SQL_* in env / .env)
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

  const summary = await pool.request().query(`
    SELECT
      COUNT(*) AS totalVariants,
      SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) AS qtyZero,
      SUM(CASE WHEN quantity IS NULL THEN 1 ELSE 0 END) AS qtyNull,
      SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END) AS qtyNegative,
      SUM(CASE WHEN quantity > 0 AND quantity < 5 THEN 1 ELSE 0 END) AS lowStock
    FROM dbo.variants`)

  // The exact rows the dashboard's "Out of Stock" count includes:
  const outRows = await pool.request().query(`
    SELECT v.id, v.color, v.size, v.quantity, v.product_id,
           p.title, p.published,
           CASE WHEN p.id IS NULL THEN 'ORPHAN (product missing)' ELSE 'ok' END AS productState
    FROM dbo.variants v
    LEFT JOIN dbo.products p ON p.id = v.product_id
    WHERE v.quantity = 0
    ORDER BY p.title`)

  console.log('\nDashboard counts come from:  quantity = 0  (out of stock),  0 < quantity < 5  (low stock)')
  console.table(summary.recordset)
  console.log(`\nThe ${outRows.recordset.length} variant(s) the "Out of Stock" tile counts:`)
  console.table(outRows.recordset)
  console.log('\nInterpretation:')
  console.log(' - If this list is NON-EMPTY: those variants exist and getInventory returns them, so')
  console.log('   an empty "Out of Stock" screen means the app showed a stale dashboard cache or old')
  console.log('   build — pull-to-refresh the dashboard / rebuild the app and retest.')
  console.log(' - If this list is EMPTY (0 rows): no variant is actually out of stock now, so the')
  console.log('   dashboard "2" was a stale cached count — it should self-correct on next refresh.')

  await pool.close()
})().catch((e) => { console.error(e); process.exit(1) })
