insert into public.admin_allowlist (email)
values (lower(trim('keerthi@sowibo.com')))
on conflict (email) do nothing;
