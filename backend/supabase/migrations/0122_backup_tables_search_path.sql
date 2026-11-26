-- 0122: pin search_path on backup_tables() (Supabase advisor: function_search_path_mutable)
alter function public.backup_tables() set search_path = public;
