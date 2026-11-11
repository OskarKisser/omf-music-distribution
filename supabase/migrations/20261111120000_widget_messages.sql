-- Интерактивные карточки бота (Telegram Bot API 10.4 widgets).
-- widget_messages — последняя карточка каждого вида в чате: её бот обновляет после событий и раз в минуту.
CREATE TABLE IF NOT EXISTS public.widget_messages (
  chat_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('releases', 'today')),
  message_id bigint NOT NULL,
  -- Состояние без времени обновления: правим карточку, только если оно изменилось.
  data_key text NOT NULL DEFAULT '',
  caption text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, kind)
);

-- Только сервер (service role): политик для anon/authenticated нет.
ALTER TABLE public.widget_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.widget_messages FROM anon, authenticated;

-- Минутный цикл: на тарифе Hobby Vercel Cron только раз в день, поэтому дёргаем
-- /api/cron/widgets из pg_cron через pg_net. Адрес и секрет — в private.app_config:
--   POST /rest/v1/rpc/set_app_config {"p_key":"widgets_tick_secret","p_value":"<WIDGETS_TICK_SECRET>"}
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

INSERT INTO private.app_config (key, value)
VALUES ('widgets_tick_url', 'https://tg-mini-app-orcin.vercel.app/api/cron/widgets')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.widgets_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tick_url text;
  tick_secret text;
BEGIN
  SELECT value INTO tick_url FROM private.app_config WHERE key = 'widgets_tick_url';
  SELECT value INTO tick_secret FROM private.app_config WHERE key = 'widgets_tick_secret';
  IF tick_url IS NULL OR tick_secret IS NULL THEN
    RETURN;
  END IF;
  -- Нет карточек — нечего обновлять, не будим функцию на Vercel.
  IF NOT EXISTS (SELECT 1 FROM public.widget_messages) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := tick_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || tick_secret),
    timeout_milliseconds := 55000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[widgets_tick] %', SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.widgets_tick() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'widgets-tick';
SELECT cron.schedule('widgets-tick', '* * * * *', 'SELECT public.widgets_tick()');
