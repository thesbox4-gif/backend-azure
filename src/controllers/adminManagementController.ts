import { Response } from 'express'
import { supabase } from '../supabase'
import { AuthRequest } from '../middleware/auth'

const isBanned = (u?: { banned_until?: string | null } | null) =>
  !!u?.banned_until && new Date(u.banned_until).getTime() > Date.now()

function enrichAdmin(
  profile: Record<string, unknown>,
  authUser?: { email?: string; banned_until?: string | null }
) {
  return {
    ...profile,
    email: authUser?.email ?? null,
    active: !isBanned(authUser),
  }
}

export async function listAdmins(_req: AuthRequest, res: Response) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, name, phone, role, created_at, updated_at')
    .eq('role', 'admin')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })

  const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const authMap = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  const data = (profiles ?? []).map((p) => enrichAdmin(p, authMap.get(p.id)))
  res.json({ data })
}

export async function getAdmin(req: AuthRequest, res: Response) {
  const { id } = req.params

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, name, phone, role, created_at, updated_at')
    .eq('id', id)
    .eq('role', 'admin')
    .single()

  if (error || !profile) return res.status(404).json({ error: 'Admin not found' })

  const { data: authUser } = await supabase.auth.admin.getUserById(id)
  res.json(enrichAdmin(profile, authUser?.user ?? undefined))
}

export async function createAdmin(req: AuthRequest, res: Response) {
  const { name, email, password, phone } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' })
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone: phone ?? null, role: 'admin' },
  })

  if (error) return res.status(400).json({ error: error.message })

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .upsert({
      id: data.user.id,
      name,
      phone: phone ?? null,
      role: 'admin',
      employee_status: null,
    })
    .select('id, name, phone, role, created_at, updated_at')
    .single()

  if (profileErr) return res.status(400).json({ error: profileErr.message })

  res.status(201).json({
    admin: enrichAdmin(profile, data.user ?? undefined),
    credentials: { email, password },
    message: 'Admin created. Share these credentials securely with the store admin.',
  })
}

export async function updateAdmin(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { name, phone, email } = req.body

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', id)
    .eq('role', 'admin')
    .single()

  if (!existing) return res.status(404).json({ error: 'Admin not found' })

  if (email) {
    const { error: emailErr } = await supabase.auth.admin.updateUserById(id, { email })
    if (emailErr) return res.status(400).json({ error: emailErr.message })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) updates.name = name
  if (phone !== undefined) updates.phone = phone

  if (name !== undefined || phone !== undefined) {
    const { data: profile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select('id, name, phone, role, created_at, updated_at')
      .single()

    if (error) return res.status(400).json({ error: error.message })

    const { data: authUser } = await supabase.auth.admin.getUserById(id)
    return res.json(enrichAdmin(profile, authUser?.user ?? undefined))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, phone, role, created_at, updated_at')
    .eq('id', id)
    .single()

  const { data: authUser } = await supabase.auth.admin.getUserById(id)
  res.json(enrichAdmin(profile!, authUser?.user ?? undefined))
}

export async function resetAdminPassword(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { password } = req.body

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', id)
    .eq('role', 'admin')
    .single()

  if (!profile) return res.status(404).json({ error: 'Admin not found' })
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' })
  }

  const { error } = await supabase.auth.admin.updateUserById(id, { password })
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true, message: 'Admin password updated' })
}

export async function setAdminActive(req: AuthRequest, res: Response) {
  const { id } = req.params
  const { active } = req.body

  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' })
  }
  if (id === req.user!.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', id)
    .eq('role', 'admin')
    .single()

  if (!profile) return res.status(404).json({ error: 'Admin not found' })

  const { error } = await supabase.auth.admin.updateUserById(id, {
    ban_duration: active ? 'none' : '876000h',
  })
  if (error) return res.status(400).json({ error: error.message })
  res.json({ success: true, active })
}

export async function deleteAdmin(req: AuthRequest, res: Response) {
  const { id } = req.params

  if (id === req.user!.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', id)
    .eq('role', 'admin')
    .single()

  if (!profile) return res.status(404).json({ error: 'Admin not found' })

  const { error } = await supabase.auth.admin.deleteUser(id)
  if (error) {
    return res.status(400).json({
      error: /foreign key|violates/i.test(error.message)
        ? 'This admin has linked records and cannot be deleted.'
        : error.message,
    })
  }
  res.json({ success: true })
}
