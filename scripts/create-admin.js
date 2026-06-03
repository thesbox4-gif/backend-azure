const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dliimcjkujyxtiipwqrw.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsaWltY2prdWp5eHRpaXB3cXJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTE3ODkxNywiZXhwIjoyMDk0NzU0OTE3fQ.4hwFfwn7GzEY_LMDJLpC1D2sbIDKvjH8K_MUd6Wicak';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function createAdmin() {
  const email = 'admin@yuvaranisilks.com';
  const password = 'admin123';
  const name = 'Admin';

  console.log(`Creating admin user: ${email}`);

  // Create user via Supabase Admin API (triggers handle_new_user → sets profile)
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'admin' },
  });

  if (error) {
    if (error.message.includes('already registered') || error.message.includes('already been registered')) {
      console.log('User already exists — updating role to admin...');
      // Find existing user
      const { data: users } = await supabase.auth.admin.listUsers();
      const existing = users?.users?.find((u) => u.email === email);
      if (existing) {
        const { error: updateErr } = await supabase
          .from('profiles')
          .update({ role: 'admin' })
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
        console.log('✓ Role updated to admin for existing user.');
      }
    } else {
      throw error;
    }
  } else {
    // Ensure profile role = admin (trigger runs but let's be safe)
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ role: 'admin', name })
      .eq('id', data.user.id);
    if (profileErr) {
      console.warn('Profile update warning:', profileErr.message);
    }
    console.log('✓ Admin user created:', data.user.id);
  }

  console.log('\n─────────────────────────────');
  console.log('Admin credentials:');
  console.log(`  Email   : ${email}`);
  console.log(`  Password: ${password}`);
  console.log('─────────────────────────────\n');
}

createAdmin().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
