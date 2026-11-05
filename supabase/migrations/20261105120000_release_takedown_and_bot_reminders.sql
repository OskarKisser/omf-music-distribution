-- Удаление релиза с площадок по просьбе артиста + авто-сообщения бота (черновик, день релиза).

-- Новый статус: релиз снят с площадок. Остаётся в истории артиста и админки.
ALTER TYPE public.release_status ADD VALUE IF NOT EXISTS 'removed';

ALTER TABLE public.releases
  -- Артист попросил снять релиз; модератор подтверждает переводом в status = 'removed'.
  ADD COLUMN IF NOT EXISTS takedown_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS takedown_reason text,
  -- Бот один раз напомнил дописать черновик (ежедневный cron).
  ADD COLUMN IF NOT EXISTS draft_reminded_at timestamptz,
  -- Бот поздравил с выходом в день релиза (ежедневный cron).
  ADD COLUMN IF NOT EXISTS release_day_notified_at timestamptz,
  -- Форма релиза ушла в рабочий чат коллег.
  ADD COLUMN IF NOT EXISTS colleagues_sent_at timestamptz;
