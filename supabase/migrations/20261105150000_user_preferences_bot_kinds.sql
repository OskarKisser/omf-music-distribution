-- Раздельные переключатели авто-сообщений бота в профиле.
-- push_notifications остаётся «Решение модератора» (и прочие события по релизу).
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS notify_draft_reminder boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_release_day boolean NOT NULL DEFAULT true;
