/**
 * Create a super admin account (CLI only — never expose in any UI).
 *
 * Usage:
 *   SUPERADMIN_EMAIL=sbox-platform-admin@yourdomain.com \
 *   SUPERADMIN_PASSWORD='your-strong-password-min-16-chars' \
 *   node scripts/create-superadmin.js
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env (or backend/.env).
 */
require('dotenv/config');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SUPERADMIN_EMAIL;
const password = process.env.SUPERADMIN_PASSWORD;
const name = process.env.SUPERADMIN_NAME || 'S-Box Platform Admin';

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
}
if (!email) {
  fail('Set SUPERADMIN_EMAIL (e.g. sbox-platform-admin@yourdomain.com).');
}
if (!password) {
  fail('Set SUPERADMIN_PASSWORD (min 16 characters).');
}
if (password.length < 16) {
  fail('SUPERADMIN_PASSWORD must be at least 16 characters.');
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('SUPERADMIN_EMAIL must be a valid email address.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createSuperAdmin() {
  console.log(`Creating super admin: ${email}`);

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'superadmin' },
  });

  if (error) {
    if (
      error.message.includes('already registered') ||
      error.message.includes('already been registered')
    ) {
      console.log('User already exists — ensuring superadmin role...');
      const { data: users } = await supabase.auth.admin.listUsers();
      const existing = users?.users?.find((u) => u.email === email);
      if (!existing) throw error;

      await supabase.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: { ...existing.user_metadata, name, role: 'superadmin' },
      });

      const { error: profileErr } = await supabase.from('profiles').upsert(
        {
          id: existing.id,
          name,
          role: 'superadmin',
          employee_status: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (profileErr) {
        console.error('Profile update failed:', profileErr.message);
        console.error(
          'Run backend/supabase_migrations/superadmin_ai_quota.sql in Supabase SQL Editor first (adds superadmin to user_role enum).'
        );
        process.exit(1);
      }

      console.log('✓ Super admin role updated for existing user.');
      return;
    }
    throw error;
  }

  const { error: profileErr } = await supabase.from('profiles').upsert(
    {
      id: data.user.id,
      name,
      role: 'superadmin',
      employee_status: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (profileErr) {
    console.error('Profile update failed:', profileErr.message);
    console.error(
      'Run backend/supabase_migrations/superadmin_ai_quota.sql in Supabase SQL Editor first (adds superadmin to user_role enum).'
    );
    process.exit(1);
  }

  console.log('✓ Super admin created:', data.user.id);
  console.log('\nSign in at the superadmin app (port 3002) with the credentials from your env.');
  console.log('Do not commit SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD to git.\n');
}

createSuperAdmin().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
