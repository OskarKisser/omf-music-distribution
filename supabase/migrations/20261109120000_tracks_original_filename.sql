-- Имя WAV на устройстве клиента: файл в Storage лежит как tracks/<index>.wav.
alter table public.tracks add column if not exists original_filename text;
