-- Safe rollback for EF-LEARN-DAILY-1.0. Seeded content is preserved.
revoke execute on function public.service_v1_learn_admin_catalog(uuid, uuid) from service_role;
revoke execute on function public.service_v1_learn_admin_course(uuid, uuid, text) from service_role;
revoke execute on function public.service_v1_learn_admin_save_course(uuid, uuid, text, jsonb, bigint, text, text) from service_role;

drop function if exists public.service_v1_learn_admin_catalog(uuid, uuid);
drop function if exists public.service_v1_learn_admin_course(uuid, uuid, text);
drop function if exists public.service_v1_learn_admin_save_course(uuid, uuid, text, jsonb, bigint, text, text);

drop policy if exists learn_admin_courses on learn.courses;
drop policy if exists learn_admin_lessons on learn.lessons;
drop policy if exists learn_admin_blocks on learn.lesson_blocks;
drop policy if exists learn_admin_idempotency on learn.idempotency_keys;

revoke all on learn.courses, learn.lessons, learn.lesson_blocks, learn.idempotency_keys from ef_learn_admin;
revoke usage on schema learn from ef_learn_admin;

-- Keep publish_at and the active-position index during rollback so scheduled
-- content and progress-bearing archived lessons are not lost.
update service_core.contracts
set metadata = metadata - 'learnContract' - 'dailyRelease' - 'authoringRole',
    activated_at = clock_timestamp()
where contract_id = 'service';
