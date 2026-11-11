-- Когда в карточке последний раз нажимали — для еженедельной сводки «открывали карточку».
alter table public.widget_messages add column if not exists last_query_at timestamptz;
