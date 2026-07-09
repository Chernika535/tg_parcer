-- Пометка «18+» для лент и дата рождения пользователя. Ленты 18+ показываются
-- только после подтверждения возраста (баннер) или если у пользователя в профиле
-- указана дата рождения и ему есть 18 лет.
alter table public.feeds add column if not exists adult boolean not null default false;
alter table public.profiles add column if not exists birth_date date;
