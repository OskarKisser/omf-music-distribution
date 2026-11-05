-- Площадка сняла вышедший релиз (например, Apple Music из-за обложки), мы отправили исправление.
-- Пока platform_issue_at не пустой — артист видит «Обновляем на площадках» вместо «Ссылка готова».

ALTER TABLE public.releases
  -- Какие площадки сняли: apple_music, itunes, spotify, yandex, vk, youtube, other.
  ADD COLUMN IF NOT EXISTS platform_issue_platforms text[],
  -- Из-за чего: artwork, title, lyrics, audio, other.
  ADD COLUMN IF NOT EXISTS platform_issue_reasons text[],
  -- Заметка модератора: что сделали (артисту не показываем).
  ADD COLUMN IF NOT EXISTS platform_issue_note text,
  -- Когда отметили. NULL — проблем нет.
  ADD COLUMN IF NOT EXISTS platform_issue_at timestamptz,
  -- Когда релиз вернулся на площадки в последний раз.
  ADD COLUMN IF NOT EXISTS platform_issue_resolved_at timestamptz;

-- Модератор заменил обложку после выпуска (например, по требованию площадки).
ALTER TABLE public.releases
  ADD COLUMN IF NOT EXISTS artwork_replaced_at timestamptz;
