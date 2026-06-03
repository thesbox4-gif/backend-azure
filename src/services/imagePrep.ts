import sharp from 'sharp'

const DEFAULT_MAX_EDGE = 1024

/** Shrinks source photos before Gemini — smaller payload, faster API round-trip. */
export async function optimizeSourceImage(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  const maxEdge = parseInt(process.env.AI_SOURCE_MAX_EDGE ?? String(DEFAULT_MAX_EDGE), 10) || DEFAULT_MAX_EDGE

  const out = await sharp(buffer)
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()

  return { buffer: out, mimeType: 'image/jpeg' }
}
