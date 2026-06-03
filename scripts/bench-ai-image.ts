/**
 * Quick benchmark: node --import tsx scripts/bench-ai-image.ts [saree|jewellery]
 * Requires GOOGLE_GEMINI_API_KEY in backend/.env
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { optimizeSourceImage } from '../src/services/imagePrep'
import { generateProductImage } from '../src/services/geminiService'

const type = (process.argv[2] || 'saree').toLowerCase()
const samplePath = join(__dirname, '../test-fixtures/sample.jpg')

async function main() {
  let raw: Buffer
  try {
    raw = readFileSync(samplePath)
  } catch {
    console.log('No test-fixtures/sample.jpg — skipping live benchmark.')
    console.log('Typical ranges (Gemini 2.5 Flash Image): jewellery 12–28s, saree 18–40s (varies).')
    process.exit(0)
  }

  const prepStart = Date.now()
  const { buffer, mimeType } = await optimizeSourceImage(raw)
  const prepMs = Date.now() - prepStart

  const geminiStart = Date.now()
  await generateProductImage({
    imageBase64: buffer.toString('base64'),
    mimeType,
    productType: type === 'jewellery' || type === 'gold' ? 'jewellery' : 'saree',
    color: 'test',
    category: 'test',
  })
  const geminiMs = Date.now() - geminiStart

  console.log(JSON.stringify({ productType: type, prepMs, geminiMs, totalMs: prepMs + geminiMs }, null, 2))
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
