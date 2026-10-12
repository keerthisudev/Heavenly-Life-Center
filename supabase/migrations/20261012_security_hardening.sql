alter function public.is_admin() set search_path = '';
alter function public.link_invited_admin() set search_path = '';
alter function public.link_existing_invited_admin() set search_path = '';
alter function public.record_event_notification() set search_path = '';

revoke all on function public.link_invited_admin() from public, anon, authenticated;
revoke all on function public.link_existing_invited_admin() from public, anon, authenticated;
revoke all on function public.record_event_notification() from public, anon, authenticated;
