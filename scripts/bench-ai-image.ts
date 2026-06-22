/**
 * Quick benchmark: node --import tsx scripts/bench-ai-image.ts [saree|jewellery|mens_kurta|sherwani|bundi|mens_shirt|mens_tshirt|mens_formal|mens_trouser]
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
  const normalized =
    type === 'jewellery' || type === 'gold' ? 'jewellery'
    : type === 'mens_kurta' || type === 'mens-kurta' ? 'mens_kurta'
    : type === 'sherwani' || type === 'bandhgala' ? 'sherwani'
    : type === 'bundi' || type === 'bandi' || type === 'bunnies' ? 'bundi'
    : ['mens_shirt', 'mens-shirt', 'shirt', 'checks', 'check_shirt'].includes(type) ? 'mens_shirt'
    : ['mens_tshirt', 'mens-tshirt', 'tshirt', 't_shirt', 'polo'].includes(type) ? 'mens_tshirt'
    : ['mens_formal', 'mens-formal', 'formal', 'suit', 'shirt_pant', 'blazer'].includes(type) ? 'mens_formal'
    : ['mens_trouser', 'mens-trouser', 'trouser', 'pants', 'chinos'].includes(type) ? 'mens_trouser'
    : 'saree'
  await generateProductImage({
    imageBase64: buffer.toString('base64'),
    mimeType,
    productType: normalized,
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
