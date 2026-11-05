# Hybrid Authentication Deployment Checklist

## 📋 Pre-Deployment Checklist

### 1. Backup Database
```bash
# Create a complete backup before migration
supabase db dump -f backup_$(date +%Y%m%d_%H%M%S).sql

# Or via dashboard: Settings > Database > Backups
```

### 2. Review Current Data
```sql
-- Count existing users by source
SELECT 
  'releases' as source,
  count(DISTINCT COALESCE(telegram_id::bigint, user_id::bigint)) as unique_users
FROM public.releases
WHERE COALESCE(telegram_id, user_id) IS NOT NULL

UNION ALL

SELECT 
  'transactions' as source,
  count(DISTINCT user_id) as unique_users
FROM public.transactions;

-- Expected result: Know how many users will be migrated
```

---

## 🚀 Deployment Steps

### Step 1: Apply SQL Migrations (in order)

```bash
cd /Users/andrejkisser/Dev/tg-mini-app

# Run migrations via Supabase CLI
supabase db push

# Or manually via Supabase Dashboard > SQL Editor:
# Copy and execute each migration file in order:
# 1. supabase/migrations/20260417140000_hybrid_auth_users_table.sql
# 2. supabase/migrations/20260417140001_migrate_existing_tables_to_uuid.sql
# 3. supabase/migrations/20260417140002_seed_telegram_users_and_migrate.sql
# 4. supabase/migrations/20260417140003_update_rls_policies_hybrid_auth.sql
```

### Step 2: Verify Migration Success

```sql
-- Check 1: Verify public.users table created
SELECT count(*) as total_users, 
       count(telegram_id) as telegram_users,
       count(email) as email_users
FROM public.users;

-- Check 2: Verify migration status
SELECT * FROM public.migration_status;
-- ALL tables should show 100% migrated

-- Check 3: Verify RLS policies updated
SELECT tablename, policyname 
FROM pg_policies 
WHERE tablename IN ('releases', 'tracks', 'transactions', 'users')
ORDER BY tablename, policyname;

-- Check 4: Test helper function
SELECT public.current_user_uuid();
-- Should return NULL (no active session) or a UUID
```

### Step 3: Deploy Application Code

```bash
# All new files are in place:
# ✅ lib/auth/hybrid-auth.ts
# ✅ app/api/auth/link-telegram/route.ts
# ✅ app/api/auth/link-email/route.ts
# ✅ app/api/auth/profile/route.ts
# ✅ app/api/auth/check-link-status/route.ts

# Run tests
npm run typecheck
npm run lint
npm run test

# Build
npm run build

# Deploy to Vercel/your platform
git add .
git commit -m "feat: implement hybrid authentication (Telegram + Web)"
git push origin main
```

---

## ✅ Post-Deployment Verification

### Test 1: Existing Telegram User Can Still Access

```bash
# Use existing Telegram user credentials
curl -X GET https://your-domain.com/api/auth/profile \
  -H "X-Telegram-Init-Data: query_id=...&user=%7B%22id%22%3A123456789...&hash=..."

# Expected response:
{
  "ok": true,
  "user": {
    "id": "uuid-here",
    "telegram_id": 123456789,
    "email": "telegram_123456789@temp.local",
    ...
  },
  "auth_method": "telegram"
}
```

### Test 2: New Web User Can Sign Up

```bash
# Sign up via Supabase Auth
curl -X POST https://your-domain.com/auth/v1/signup \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_SUPABASE_ANON_KEY" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePassword123!"
  }'

# Verify profile created
curl -X GET https://your-domain.com/api/auth/profile \
  -H "Authorization: Bearer <access_token_from_signup>"

# Expected: User profile with UUID, email, NO telegram_id
```

### Test 3: Account Linking Works

```bash
# Scenario: Web user wants to link Telegram

# Step 1: Web user logs in, gets session token
SESSION_TOKEN="<from_login>"

# Step 2: Web user opens Telegram Mini App
# Step 3: Link accounts
curl -X POST https://your-domain.com/api/auth/link-telegram \
  -H "Authorization: Bearer $SESSION_TOKEN" \
  -H "X-Telegram-Init-Data: <valid_telegram_initData>"

# Expected response:
{
  "ok": true,
  "message": "Telegram account successfully linked",
  "user_id": "uuid"
}
```

### Test 4: Data Access Works After Migration

```bash
# Get releases for Telegram user
curl -X GET https://your-domain.com/api/releases \
  -H "X-Telegram-Init-Data: <valid_initData>"

# Should return user's releases (same as before migration)
```

---

## 🔍 Monitoring & Debugging

### Check Migration Logs

```sql
-- See what the migration created
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('user_uuid', 'telegram_id', 'email')
ORDER BY table_name, column_name;
```

### Check User Data Integrity

```sql
-- Verify no data loss
SELECT 
  r.id as release_id,
  r.user_id as old_user_id,
  r.telegram_id as old_telegram_id,
  r.user_uuid as new_user_uuid,
  u.telegram_id as users_telegram_id
FROM public.releases r
LEFT JOIN public.users u ON r.user_uuid = u.id
WHERE r.user_uuid IS NULL
  AND r.user_id IS NOT NULL;

-- Should return 0 rows (all migrated)
```

### Check RLS Policies Working

```sql
-- Test as anon role (should fail without auth)
SET ROLE anon;
SELECT * FROM public.releases LIMIT 1;
-- Should return 0 rows or error

-- Reset
RESET ROLE;
```

---

## 🐛 Common Issues & Solutions

### Issue 1: Some users not migrated (migration_status < 100%)

**Cause:** Orphaned records with invalid telegram_id/user_id

**Solution:**
```sql
-- Find orphaned records
SELECT id, user_id, telegram_id, user_uuid
FROM public.releases
WHERE user_uuid IS NULL
  AND COALESCE(telegram_id, user_id) IS NOT NULL;

-- Manually create users for orphaned records if needed
-- Or delete orphaned records:
DELETE FROM public.releases 
WHERE user_uuid IS NULL 
  AND created_at < now() - interval '90 days';
```

### Issue 2: "Telegram account already linked" error

**Cause:** User trying to link Telegram ID that's already linked elsewhere

**Solution:**
```sql
-- Find which account has the Telegram ID
SELECT id, email, telegram_id, display_name
FROM public.users
WHERE telegram_id = 123456789;

-- Business decision needed:
-- Option 1: Unlink from old account
-- Option 2: Ask user to use existing account
-- Option 3: Implement account merging
```

### Issue 3: Users can't access their releases after migration

**Cause:** RLS policy not recognizing user

**Debug:**
```sql
-- Check if current_user_uuid() works
-- (Run from Supabase SQL Editor logged in as user)
SELECT public.current_user_uuid();

-- Check user's releases
SELECT id, title, user_uuid
FROM public.releases
WHERE user_uuid = public.current_user_uuid();
```

**Solution:**
```sql
-- Re-run migration for specific user
UPDATE public.releases r
SET user_uuid = u.id
FROM public.users u
WHERE r.telegram_id::bigint = u.telegram_id
  AND r.user_uuid IS NULL;
```

### Issue 4: Performance degradation after migration

**Cause:** Missing indexes on user_uuid columns

**Solution:**
```sql
-- Add indexes if not already present
CREATE INDEX CONCURRENTLY IF NOT EXISTS releases_user_uuid_idx 
  ON public.releases(user_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS tracks_user_uuid_idx 
  ON public.tracks(user_uuid);

CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_user_uuid_idx 
  ON public.transactions(user_uuid);

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE tablename IN ('releases', 'tracks', 'transactions')
ORDER BY tablename, indexname;
```

---

## 📊 Monitoring Queries

### Daily Health Check

```sql
-- User growth by auth type
SELECT 
  date_trunc('day', created_at) as day,
  count(*) FILTER (WHERE telegram_id IS NOT NULL AND email LIKE '%@temp.local') as telegram_only,
  count(*) FILTER (WHERE telegram_id IS NULL) as email_only,
  count(*) FILTER (WHERE telegram_id IS NOT NULL AND email NOT LIKE '%@temp.local') as linked_accounts
FROM public.users
WHERE created_at > now() - interval '30 days'
GROUP BY day
ORDER BY day DESC;
```

### Account Linking Rate

```sql
-- Percentage of users with linked accounts
SELECT 
  count(*) as total_users,
  count(*) FILTER (WHERE telegram_id IS NOT NULL AND email NOT LIKE '%@temp.local') as linked,
  round(100.0 * 
    count(*) FILTER (WHERE telegram_id IS NOT NULL AND email NOT LIKE '%@temp.local') / 
    NULLIF(count(*), 0), 
  2) as link_percentage
FROM public.users;
```

---

## 🎯 Success Criteria

✅ **Migration Complete When:**

1. `SELECT * FROM public.migration_status;` shows 100% for all tables
2. All existing Telegram users can still access their data
3. New web users can sign up and access features
4. Account linking works in both directions
5. No duplicate accounts created
6. Performance metrics remain stable
7. All tests pass

---

## 📝 Rollback Instructions

If critical issues arise:

```sql
-- 1. Snapshot current state for investigation
CREATE TABLE migration_investigation_backup AS
SELECT * FROM public.users;

-- 2. Old columns still exist, so switch RLS back to old approach
-- (Restore old policies from git)

-- 3. Application code: Revert to previous commit
git revert HEAD
git push origin main

-- 4. Investigate issues offline

-- 5. Re-deploy when fixed
```

**Important:** Do NOT drop `user_uuid` columns during rollback - they're safe to keep.

---

## 📞 Support

- **Documentation:** `/docs/HYBRID_AUTH_IMPLEMENTATION.md`
- **Migrations:** `/supabase/migrations/20260417140*`
- **Code:** `/lib/auth/hybrid-auth.ts`, `/app/api/auth/`

---

## ✨ Next Steps After Successful Deployment

1. Monitor error logs for 24-48 hours
2. Check user feedback for any access issues
3. Gradually phase out old `user_id`/`telegram_id` columns (after 30 days)
4. Add frontend UI for account linking
5. Implement OAuth providers (Google, Apple)
6. Add account merging for duplicate accounts

---

**Deployment Date:** _________________  
**Deployed By:** _________________  
**Verified By:** _________________  
**Sign-off:** _________________
