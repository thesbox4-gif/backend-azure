import { GoogleGenAI } from '@google/genai'
import { jewelleryPrompt, sareePrompt } from './prompts'

// "Nano banana" = Gemini 2.5 Flash Image. Override via env if the model id changes.
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
// Vision+text model used to write product copy from a product photo.
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'

let client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY
    if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY is not configured')
    client = new GoogleGenAI({ apiKey })
  }
  return client
}

interface GenerateImageInput {
  imageBase64: string
  mimeType: string
  productType?: string
  color?: string
  category?: string
}

function promptForType(productType?: string): string {
  const t = (productType || '').toLowerCase()
  if (t === 'jewellery' || t === 'jewelry' || t === 'gold') return jewelleryPrompt()
  return sareePrompt()
}

// Seller colour/category labels apply only when they match the photo. The upload
// is always ground truth (e.g. "Green" variant slot but a yellow saree in frame).
function buildVariantHint(color?: string, category?: string): string {
  const parts: string[] = []
  if (color?.trim()) {
    parts.push(
      `seller colour variant label: "${color.trim()}" — use only if it matches the dominant colour in the photo; otherwise follow the photo`
    )
  }
  if (category?.trim()) parts.push(`category: "${category.trim()}"`)
  if (parts.length === 0) return ''
  return `\n\n## SELLER METADATA (secondary to the uploaded photo)\n${parts.join('\n')}\n`
}

// Turns a raw product photo into a clean studio-style e-commerce image.
// Returns the generated image as a Buffer (PNG).
export async function generateProductImage(input: GenerateImageInput): Promise<Buffer> {
  const { imageBase64, mimeType, productType, color, category } = input
  const prompt = promptForType(productType) + buildVariantHint(color, category)

  const response = await getClient().models.generateContent({
    model: IMAGE_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
    ],
    config: {
      imageConfig: {
        aspectRatio: '3:4',
      },
    },
  })

  const parts = response.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const data = part.inlineData?.data
    if (data) return Buffer.from(data, 'base64')
  }
  throw new Error('Gemini did not return an image — try a clearer source photo')
}

interface GenerateContentInput {
  imageBase64: string
  mimeType: string
  productType?: string
  color?: string
  category?: string
}

// Writes an SEO product title + description by looking at the product photo.
// Uses Gemini (vision+text) — no Anthropic key needed.
export async function generateProductContent(
  input: GenerateContentInput
): Promise<{ title: string; description: string }> {
  const { imageBase64, mimeType, productType, color, category } = input
  const typeLabel = (productType || 'ethnic-wear').trim()
  const categoryLine = category?.trim()
    ? `\nCategory context (for occasion/style tone only): ${category.trim()}.`
    : ''

  const prompt = `You are a product copywriter for an Indian ethnic-wear e-commerce store.
Look closely at the uploaded product photo. Product type: ${typeLabel}.${categoryLine}
${buildVariantHint(color, category)}
Write an appealing product listing from what you ACTUALLY SEE in the image — dominant colour, fabric, weave, motifs, border, embellishments.
Rules:
- The photo is the only source of truth for colour and visual details.
- Never describe a colour that is not clearly visible in the photo.
- If a seller colour variant label conflicts with the photo, ignore the label and describe the photo.

Respond with ONLY valid JSON — no markdown, no code fences, no preamble:
{"title": "SEO-friendly title, max 80 characters", "description": "2-3 sentences covering fabric, occasion and colour appeal"}`

  const response = await getClient().models.generateContent({
    model: TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
    ],
  })

  const parts = response.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p.text || '').join('').trim()
  // Gemini sometimes wraps JSON in ```json fences — strip them before parsing.
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  let parsed: { title?: unknown; description?: unknown }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('AI returned invalid content — please try again')
  }
  return {
    title: String(parsed.title ?? '').slice(0, 80),
    description: String(parsed.description ?? ''),
  }
}
