import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// Load `.env` before reading `process.env`. With `tsx`, `import 'dotenv/config'` in
// `index.ts` can run *after* route modules are evaluated, so route imports may load
// this file first — load env here so variables are always available.
const envPaths = [join(process.cwd(), '.env'), join(__dirname, '..', '.env')]
for (const envPath of envPaths) {
  if (!existsSync(envPath)) continue
  if (statSync(envPath).size === 0) {
    throw new Error(
      `backend env file is empty: ${envPath}\nSave your variables to this file (or copy from .env.example), then restart.`
    )
  }
  config({ path: envPath })
  break
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n' +
      `Checked: ${envPaths.join(' and ')} — ensure one exists, is saved, and contains those keys.`
  )
}

// Service role client — full DB access, server-side only, NEVER exposed to any client.
// IMPORTANT: never call auth.signInWithPassword / signUp on this client. Doing so
// replaces its service-role credentials with a user session, which then makes every
// subsequent .from() query run as that user and fail RLS-protected reads.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'public' },
    global: {
      headers: { 'x-application-name': 'yuvarani-backend' },
    },
  }
)

// Dedicated client for user sign-in / sign-up only. Kept separate so user sessions
// never poison the service-role client above.
export const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
)
