import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { supabase } from '../supabase'

export async function uploadImage(
  buffer: Buffer,
  originalName: string,
  bucket: 'product-images' | 'category-images'
): Promise<string> {
  const stem = originalName.replace(/\s+/g, '-').replace(/\.[^.]+$/, '') || 'image'
  const filename = `${Date.now()}-${stem}-${randomUUID()}.webp`

  const pipeline = sharp(buffer)

  // Product catalog: center-crop to 3:4 portrait (Myntra-style consistency)
  const optimized =
    bucket === 'product-images'
      ? await pipeline
          .resize(1200, 1600, { fit: 'cover', position: 'centre' })
          .webp({ quality: 85 })
          .toBuffer()
      : await pipeline
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer()

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, optimized, { contentType: 'image/webp', upsert: false })

  if (error) throw new Error(error.message)

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(filename)

  return publicUrl
}

export async function deleteImage(bucket: string, filename: string): Promise<void> {
  await supabase.storage.from(bucket).remove([filename])
}
