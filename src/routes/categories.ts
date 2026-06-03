import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import { supabase } from '../supabase'
import { authenticate, requireApprovedEmployee } from '../middleware/auth'
import { uploadImage } from '../services/storageService'
import multer from 'multer'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// List categories. ?topLevel=true returns only roots; ?parentId=<id> returns one parent's children.
router.get('/', async (req: Request, res: Response) => {
  let query = supabase.from('categories').select('*').order('name')

  if (req.query.parentId) {
    query = query.eq('parent_id', req.query.parentId as string)
  } else if (req.query.topLevel === 'true') {
    query = query.is('parent_id', null)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.get('/:slug', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('slug', req.params.slug)
    .single()

  if (error) return res.status(404).json({ error: 'Category not found' })
  res.json(data)
})

router.post(
  '/',
  authenticate,
  requireApprovedEmployee,
  upload.single('image'),
  [body('name').trim().notEmpty()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { name, description, parent_id } = req.body
    const slug = req.body.slug?.trim() || slugify(name)

    let image_url: string | undefined = req.body.image_url || undefined
    try {
      if (req.file) {
        image_url = await uploadImage(req.file.buffer, req.file.originalname, 'category-images')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed'
      return res.status(500).json({ error: message })
    }

    const { data, error } = await supabase
      .from('categories')
      .insert({ name, slug, description, image_url, parent_id: parent_id || null })
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.status(201).json(data)
  }
)

router.patch(
  '/:id',
  authenticate,
  requireApprovedEmployee,
  upload.single('image'),
  async (req: Request, res: Response) => {
    const { name, slug, description, parent_id } = req.body
    const updates: Record<string, unknown> = {}
    if (name) updates.name = name
    if (slug) updates.slug = slug
    if (description !== undefined) updates.description = description

    if (parent_id !== undefined) {
      if (parent_id === req.params.id) {
        return res.status(400).json({ error: 'A category cannot be its own parent' })
      }
      updates.parent_id = parent_id || null
    }

    try {
      if (req.file) {
        updates.image_url = await uploadImage(req.file.buffer, req.file.originalname, 'category-images')
      } else if (req.body.image_url !== undefined) {
        updates.image_url = req.body.image_url || null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image upload failed'
      return res.status(500).json({ error: message })
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(400).json({ error: error.message })
    res.json(data)
  }
)

router.delete('/:id', authenticate, requireApprovedEmployee, async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', req.params.id)

  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true })
})

export default router
