-- EF-LEARN-DAILY-1.0 / EF-SERVICE-0.1.0 / EF-TWO-DB-1.0
-- Daily lesson release, a narrow Learn authoring role, and the first course.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ef_learn_admin') then
    create role ef_learn_admin nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

grant ef_learn_admin to postgres;
grant usage on schema learn to ef_learn_admin;

alter table learn.lessons
  add column if not exists publish_at timestamptz;

-- Archived lessons retain their progress history while an active lesson can reuse
-- the same display position in a later course revision.
alter table learn.lessons
  drop constraint if exists learn_lessons_course_id_position_key;

create unique index if not exists learn_lessons_active_course_position
  on learn.lessons(course_id, position)
  where status <> 'archived';

update learn.lessons
set publish_at = coalesce(publish_at, updated_at, created_at)
where status = 'published' and publish_at is null;

create index if not exists learn_lessons_release_schedule
  on learn.lessons(course_id, publish_at, position)
  where status = 'published';

grant select, insert, update, delete
  on learn.courses, learn.lessons, learn.lesson_blocks, learn.idempotency_keys
  to ef_learn_admin;

drop policy if exists learn_admin_courses on learn.courses;
create policy learn_admin_courses on learn.courses for all to ef_learn_admin
using (true) with check (true);

drop policy if exists learn_admin_lessons on learn.lessons;
create policy learn_admin_lessons on learn.lessons for all to ef_learn_admin
using (true) with check (true);

drop policy if exists learn_admin_blocks on learn.lesson_blocks;
create policy learn_admin_blocks on learn.lesson_blocks for all to ef_learn_admin
using (true) with check (true);

drop policy if exists learn_admin_idempotency on learn.idempotency_keys;
create policy learn_admin_idempotency on learn.idempotency_keys for all to ef_learn_admin
using (true) with check (true);

grant create on schema public to ef_learn_api;
set role ef_learn_api;

create or replace function public.service_v1_learn_catalog(
  p_common_user_id uuid,
  p_scope_id uuid,
  p_after_slug text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'LIMIT_INVALID' using errcode = '22023'; end if;
  perform set_config('request.ef.common_user_id', p_common_user_id::text, true);
  perform set_config('request.ef.scope_id', p_scope_id::text, true);
  with candidates as (
    select c.id, c.slug, c.title, c.summary, c.level, c.version, c.published_at,
           count(l.id) filter (
             where l.status = 'published' and coalesce(l.publish_at, l.created_at) <= clock_timestamp()
           )::integer as lesson_count,
           min(l.publish_at) filter (
             where l.status = 'published' and l.publish_at > clock_timestamp()
           ) as next_lesson_at
    from learn.courses c
    left join learn.lessons l on l.course_id = c.id
    where (p_after_slug is null or c.slug > p_after_slug)
    group by c.id
    order by c.slug
    limit p_limit + 1
  ), page_rows as (
    select * from candidates order by slug limit p_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'slug', p.slug,
          'title', p.title,
          'summary', p.summary,
          'level', p.level,
          'version', p.version,
          'publishedAt', p.published_at,
          'lessonCount', p.lesson_count,
          'nextLessonAt', p.next_lesson_at
        ) order by p.slug
      ) from page_rows p
    ), '[]'::jsonb),
    'nextAfter', case when (select count(*) from candidates) > p_limit
      then (select slug from page_rows order by slug desc limit 1) else null end
  ) into v_result;
  return v_result;
end
$$;

create or replace function public.service_v1_learn_course(
  p_common_user_id uuid,
  p_scope_id uuid,
  p_slug text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform set_config('request.ef.common_user_id', p_common_user_id::text, true);
  perform set_config('request.ef.scope_id', p_scope_id::text, true);
  select jsonb_build_object(
    'id', c.id,
    'slug', c.slug,
    'title', c.title,
    'summary', c.summary,
    'level', c.level,
    'version', c.version,
    'publishedAt', c.published_at,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'slug', l.slug,
        'position', l.position,
        'title', l.title,
        'summary', l.summary,
        'estimatedMinutes', l.estimated_minutes,
        'version', l.version,
        'publishAt', l.publish_at,
        'blocks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', b.id,
            'position', b.position,
            'type', b.block_type,
            'body', b.body
          ) order by b.position)
          from learn.lesson_blocks b where b.lesson_id = l.id
        ), '[]'::jsonb)
      ) order by l.position)
      from learn.lessons l
      where l.course_id = c.id
        and l.status = 'published'
        and coalesce(l.publish_at, l.created_at) <= clock_timestamp()
    ), '[]'::jsonb),
    'nextLessonAt', (
      select min(l.publish_at)
      from learn.lessons l
      where l.course_id = c.id
        and l.status = 'published'
        and l.publish_at > clock_timestamp()
    )
  ) into v_result
  from learn.courses c
  where c.slug = p_slug;
  return v_result;
end
$$;

create or replace function public.service_v1_learn_progress_apply(
  p_common_user_id uuid,
  p_scope_id uuid,
  p_lesson_id uuid,
  p_state text,
  p_percent integer,
  p_last_position jsonb,
  p_base_version bigint,
  p_idempotency_key text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current learn.progress%rowtype;
  v_saved learn.idempotency_keys%rowtype;
  v_response jsonb;
begin
  if p_base_version is null or p_base_version < 0 then raise exception 'VERSION_INVALID' using errcode = '22023'; end if;
  if p_state not in ('not_started', 'in_progress', 'completed') then raise exception 'STATE_INVALID' using errcode = '22023'; end if;
  if p_percent < 0 or p_percent > 100 or (p_state = 'completed' and p_percent <> 100) then raise exception 'PERCENT_INVALID' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_last_position, '{}'::jsonb)) <> 'object' then raise exception 'POSITION_INVALID' using errcode = '22023'; end if;
  if length(p_idempotency_key) not between 8 and 128 or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'IDEMPOTENCY_INVALID' using errcode = '22023'; end if;

  perform set_config('request.ef.common_user_id', p_common_user_id::text, true);
  perform set_config('request.ef.scope_id', p_scope_id::text, true);
  perform pg_advisory_xact_lock(hashtextextended(p_common_user_id::text || ':' || p_scope_id::text || ':learn:' || p_idempotency_key, 0));

  select * into v_saved from learn.idempotency_keys
  where common_user_id = p_common_user_id and scope_id = p_scope_id
    and operation = 'learn.progress.apply' and idempotency_key = p_idempotency_key;
  if found then
    if v_saved.request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_REUSED' using errcode = '23514'; end if;
    return v_saved.response;
  end if;

  if not exists (
    select 1 from learn.lessons
    where id = p_lesson_id
      and status = 'published'
      and coalesce(publish_at, created_at) <= clock_timestamp()
  ) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into learn.progress(common_user_id, scope_id, lesson_id)
  values (p_common_user_id, p_scope_id, p_lesson_id)
  on conflict do nothing;
  select * into v_current from learn.progress
  where common_user_id = p_common_user_id and scope_id = p_scope_id and lesson_id = p_lesson_id
  for update;

  if v_current.version <> p_base_version then
    v_response := jsonb_build_object(
      'accepted', false,
      'version', v_current.version,
      'current', jsonb_build_object(
        'state', v_current.state,
        'percent', v_current.percent,
        'lastPosition', v_current.last_position,
        'deletedAt', v_current.deleted_at
      )
    );
  else
    update learn.progress
    set state = p_state,
        percent = p_percent,
        last_position = coalesce(p_last_position, '{}'::jsonb),
        version = version + 1,
        updated_at = clock_timestamp(),
        deleted_at = null
    where common_user_id = p_common_user_id and scope_id = p_scope_id and lesson_id = p_lesson_id
    returning * into v_current;
    v_response := jsonb_build_object('accepted', true, 'version', v_current.version);
  end if;

  insert into learn.idempotency_keys(common_user_id, scope_id, operation, idempotency_key, request_hash, response)
  values (p_common_user_id, p_scope_id, 'learn.progress.apply', p_idempotency_key, p_request_hash, v_response);
  return v_response;
end
$$;

reset role;
revoke create on schema public from ef_learn_api;

revoke all on function public.service_v1_learn_catalog(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.service_v1_learn_course(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.service_v1_learn_progress_apply(uuid, uuid, uuid, text, integer, jsonb, bigint, text, text) from public, anon, authenticated;
grant execute on function public.service_v1_learn_catalog(uuid, uuid, text, integer) to service_role;
grant execute on function public.service_v1_learn_course(uuid, uuid, text) to service_role;
grant execute on function public.service_v1_learn_progress_apply(uuid, uuid, uuid, text, integer, jsonb, bigint, text, text) to service_role;

grant create on schema public to ef_learn_admin;
set role ef_learn_admin;

create or replace function public.service_v1_learn_admin_catalog(
  p_common_user_id uuid,
  p_scope_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'title', c.title,
      'summary', c.summary,
      'level', c.level,
      'status', c.status,
      'version', c.version,
      'publishedAt', c.published_at,
      'lessonCount', (select count(*) from learn.lessons l where l.course_id = c.id and l.status <> 'archived'),
      'nextLessonAt', (select min(l.publish_at) from learn.lessons l where l.course_id = c.id and l.status = 'published' and l.publish_at > clock_timestamp())
    ) order by c.updated_at desc, c.slug)
    from learn.courses c
  ), '[]'::jsonb);
end
$$;

create or replace function public.service_v1_learn_admin_course(
  p_common_user_id uuid,
  p_scope_id uuid,
  p_slug text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'id', c.id,
    'slug', c.slug,
    'title', c.title,
    'summary', c.summary,
    'level', c.level,
    'status', c.status,
    'version', c.version,
    'publishedAt', c.published_at,
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'slug', l.slug,
        'position', l.position,
        'title', l.title,
        'summary', l.summary,
        'estimatedMinutes', l.estimated_minutes,
        'status', l.status,
        'version', l.version,
        'publishAt', l.publish_at,
        'blocks', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', b.id,
            'position', b.position,
            'type', b.block_type,
            'body', b.body
          ) order by b.position)
          from learn.lesson_blocks b where b.lesson_id = l.id
        ), '[]'::jsonb)
      ) order by l.position)
      from learn.lessons l where l.course_id = c.id and l.status <> 'archived'
    ), '[]'::jsonb)
  ) into v_result
  from learn.courses c
  where c.slug = p_slug;
  return v_result;
end
$$;

create or replace function public.service_v1_learn_admin_save_course(
  p_common_user_id uuid,
  p_scope_id uuid,
  p_slug text,
  p_course jsonb,
  p_base_version bigint,
  p_idempotency_key text,
  p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
  v_current_version bigint;
  v_new_version bigint;
  v_saved learn.idempotency_keys%rowtype;
  v_response jsonb;
  v_lesson jsonb;
  v_block jsonb;
  v_lesson_id uuid;
  v_position integer;
  v_block_position integer;
  v_title text;
  v_summary text;
  v_level text;
  v_status text;
  v_published_at timestamptz;
  v_lesson_slug text;
  v_lesson_title text;
  v_lesson_summary text;
  v_lesson_status text;
  v_lesson_publish_at timestamptz;
  v_estimated_minutes integer;
  v_block_type text;
  v_block_body jsonb;
begin
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' then raise exception 'COURSE_SLUG_INVALID' using errcode = '22023'; end if;
  if jsonb_typeof(p_course) <> 'object' then raise exception 'COURSE_INVALID' using errcode = '22023'; end if;
  if p_base_version is null or p_base_version < 0 then raise exception 'VERSION_INVALID' using errcode = '22023'; end if;
  if length(p_idempotency_key) not between 8 and 128 or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'IDEMPOTENCY_INVALID' using errcode = '22023'; end if;
  if jsonb_typeof(p_course -> 'lessons') <> 'array' or jsonb_array_length(p_course -> 'lessons') not between 1 and 90 then
    raise exception 'LESSONS_INVALID' using errcode = '22023';
  end if;

  perform set_config('request.ef.common_user_id', p_common_user_id::text, true);
  perform set_config('request.ef.scope_id', p_scope_id::text, true);
  perform pg_advisory_xact_lock(hashtextextended('learn-admin:' || p_slug, 0));

  select * into v_saved from learn.idempotency_keys
  where common_user_id = p_common_user_id and scope_id = p_scope_id
    and operation = 'learn.admin.course.save:' || p_slug and idempotency_key = p_idempotency_key;
  if found then
    if v_saved.request_hash <> p_request_hash then raise exception 'IDEMPOTENCY_REUSED' using errcode = '23514'; end if;
    return v_saved.response;
  end if;

  select id, version into v_course_id, v_current_version
  from learn.courses where slug = p_slug for update;

  if found and v_current_version <> p_base_version then
    v_response := jsonb_build_object(
      'accepted', false,
      'version', v_current_version,
      'current', jsonb_build_object('slug', p_slug, 'version', v_current_version)
    );
    insert into learn.idempotency_keys(common_user_id, scope_id, operation, idempotency_key, request_hash, response)
    values (p_common_user_id, p_scope_id, 'learn.admin.course.save:' || p_slug, p_idempotency_key, p_request_hash, v_response);
    return v_response;
  elsif not found and p_base_version <> 0 then
    v_response := jsonb_build_object('accepted', false, 'version', 0, 'current', jsonb_build_object('slug', p_slug, 'version', 0));
    insert into learn.idempotency_keys(common_user_id, scope_id, operation, idempotency_key, request_hash, response)
    values (p_common_user_id, p_scope_id, 'learn.admin.course.save:' || p_slug, p_idempotency_key, p_request_hash, v_response);
    return v_response;
  end if;

  v_title := btrim(coalesce(p_course ->> 'title', ''));
  v_summary := btrim(coalesce(p_course ->> 'summary', ''));
  v_level := coalesce(p_course ->> 'level', 'beginner');
  v_status := coalesce(p_course ->> 'status', 'draft');
  if length(v_title) not between 1 and 160 or length(v_summary) > 1000 then raise exception 'COURSE_TEXT_INVALID' using errcode = '22023'; end if;
  if v_level not in ('beginner', 'intermediate', 'advanced') then raise exception 'COURSE_LEVEL_INVALID' using errcode = '22023'; end if;
  if v_status not in ('draft', 'published', 'archived') then raise exception 'COURSE_STATUS_INVALID' using errcode = '22023'; end if;
  begin
    v_published_at := nullif(p_course ->> 'publishedAt', '')::timestamptz;
  exception when others then
    raise exception 'COURSE_PUBLISH_AT_INVALID' using errcode = '22023';
  end;
  if v_status = 'published' then v_published_at := coalesce(v_published_at, clock_timestamp()); end if;

  if v_course_id is null then
    insert into learn.courses(slug, title, summary, level, status, published_at)
    values (p_slug, v_title, v_summary, v_level, v_status, v_published_at)
    returning id, version into v_course_id, v_new_version;
  else
    update learn.courses
    set title = v_title,
        summary = v_summary,
        level = v_level,
        status = v_status,
        published_at = v_published_at,
        version = version + 1,
        updated_at = clock_timestamp()
    where id = v_course_id
    returning version into v_new_version;
  end if;

  update learn.lessons
  set status = 'archived', updated_at = clock_timestamp()
  where course_id = v_course_id and status <> 'archived';
  v_position := 0;
  for v_lesson in select value from jsonb_array_elements(p_course -> 'lessons') loop
    v_position := v_position + 1;
    if jsonb_typeof(v_lesson) <> 'object' then raise exception 'LESSON_INVALID' using errcode = '22023'; end if;
    v_lesson_slug := btrim(coalesce(v_lesson ->> 'slug', ''));
    v_lesson_title := btrim(coalesce(v_lesson ->> 'title', ''));
    v_lesson_summary := btrim(coalesce(v_lesson ->> 'summary', ''));
    v_lesson_status := coalesce(v_lesson ->> 'status', 'draft');
    if v_lesson_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' then raise exception 'LESSON_SLUG_INVALID' using errcode = '22023'; end if;
    if length(v_lesson_title) not between 1 and 160 or length(v_lesson_summary) > 1000 then raise exception 'LESSON_TEXT_INVALID' using errcode = '22023'; end if;
    if v_lesson_status not in ('draft', 'published', 'archived') then raise exception 'LESSON_STATUS_INVALID' using errcode = '22023'; end if;
    begin
      v_estimated_minutes := coalesce((v_lesson ->> 'estimatedMinutes')::integer, 5);
      v_lesson_publish_at := nullif(v_lesson ->> 'publishAt', '')::timestamptz;
    exception when others then
      raise exception 'LESSON_SCHEDULE_INVALID' using errcode = '22023';
    end;
    if v_estimated_minutes not between 1 and 600 then raise exception 'LESSON_DURATION_INVALID' using errcode = '22023'; end if;
    if v_lesson_status = 'published' then v_lesson_publish_at := coalesce(v_lesson_publish_at, clock_timestamp()); end if;
    if jsonb_typeof(v_lesson -> 'blocks') <> 'array' or jsonb_array_length(v_lesson -> 'blocks') not between 1 and 50 then
      raise exception 'LESSON_BLOCKS_INVALID' using errcode = '22023';
    end if;

    insert into learn.lessons(course_id, slug, position, title, summary, estimated_minutes, status, publish_at)
    values (v_course_id, v_lesson_slug, v_position, v_lesson_title, v_lesson_summary, v_estimated_minutes, v_lesson_status, v_lesson_publish_at)
    on conflict (course_id, slug) do update
    set position = excluded.position,
        title = excluded.title,
        summary = excluded.summary,
        estimated_minutes = excluded.estimated_minutes,
        status = excluded.status,
        publish_at = excluded.publish_at,
        version = learn.lessons.version + 1,
        updated_at = clock_timestamp()
    returning id into v_lesson_id;

    delete from learn.lesson_blocks where lesson_id = v_lesson_id;
    v_block_position := 0;
    for v_block in select value from jsonb_array_elements(v_lesson -> 'blocks') loop
      v_block_position := v_block_position + 1;
      v_block_type := coalesce(v_block ->> 'type', '');
      v_block_body := v_block -> 'body';
      if v_block_type not in ('key_point', 'visual', 'explanation', 'interactive', 'quiz', 'callout') then
        raise exception 'BLOCK_TYPE_INVALID' using errcode = '22023';
      end if;
      if jsonb_typeof(v_block_body) <> 'object' then raise exception 'BLOCK_BODY_INVALID' using errcode = '22023'; end if;
      insert into learn.lesson_blocks(lesson_id, position, block_type, body)
      values (v_lesson_id, v_block_position, v_block_type, v_block_body);
    end loop;
  end loop;

  v_response := jsonb_build_object('accepted', true, 'slug', p_slug, 'version', v_new_version);
  insert into learn.idempotency_keys(common_user_id, scope_id, operation, idempotency_key, request_hash, response)
  values (p_common_user_id, p_scope_id, 'learn.admin.course.save:' || p_slug, p_idempotency_key, p_request_hash, v_response);
  return v_response;
end
$$;

reset role;
revoke create on schema public from ef_learn_admin;

revoke all on function public.service_v1_learn_admin_catalog(uuid, uuid) from public, anon, authenticated;
revoke all on function public.service_v1_learn_admin_course(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.service_v1_learn_admin_save_course(uuid, uuid, text, jsonb, bigint, text, text) from public, anon, authenticated;
grant execute on function public.service_v1_learn_admin_catalog(uuid, uuid) to service_role;
grant execute on function public.service_v1_learn_admin_course(uuid, uuid, text) to service_role;
grant execute on function public.service_v1_learn_admin_save_course(uuid, uuid, text, jsonb, bigint, text, text) to service_role;

update service_core.contracts
set metadata = metadata || jsonb_build_object(
  'learnContract', 'EF-LEARN-DAILY-1.0',
  'dailyRelease', true,
  'authoringRole', 'org_admin'
), activated_at = clock_timestamp()
where contract_id = 'service';

do $$
declare
  v_course_id uuid;
  v_lesson_id uuid;
  v_release timestamptz;
  v_titles text[] := array[
    '아이디어를 문제로 바꾸기',
    '가장 작은 검증 설계',
    '고객에게 닿는 한 문장',
    '첫 화면과 첫 행동',
    '자동화는 반복에서 시작',
    '비용과 보안 경계 세우기',
    '다음 30일 실행표 만들기'
  ];
  v_slugs text[] := array[
    'turn-idea-into-problem',
    'design-smallest-test',
    'write-one-clear-message',
    'first-screen-first-action',
    'automate-repetition',
    'set-cost-security-boundaries',
    'build-30-day-plan'
  ];
  v_summaries text[] := array[
    '좋아 보이는 기능보다 누가 어떤 순간에 막히는지 먼저 정리합니다.',
    '개발 전에 가장 싸고 빠르게 가설을 확인하는 방법을 고릅니다.',
    '제품의 대상·문제·결과를 한 문장으로 설명합니다.',
    '사용자가 처음 30초 안에 해야 할 행동 하나를 설계합니다.',
    '반복 업무를 기록하고 안전한 순서로 자동화합니다.',
    '유료 도구, 개인정보, 비밀키의 경계를 미리 정합니다.',
    '매일 실행할 수 있는 30일 계획으로 학습을 마무리합니다.'
  ];
  v_body text[] := array[
    '아이디어는 해결책의 이름이고, 문제는 사용자가 겪는 구체적인 불편입니다. 먼저 대상, 상황, 현재 행동, 손실을 한 줄씩 적어보세요.',
    '좋은 검증은 완성품이 아니라 의사결정에 필요한 증거를 만듭니다. 인터뷰, 수동 대행, 클릭 가능한 화면 중 가장 작은 방법을 선택하세요.',
    '한 문장은 누구를 위한 것인지, 어떤 문제를 줄이는지, 사용 후 무엇이 달라지는지를 포함해야 합니다. 기능 목록은 뒤로 미룹니다.',
    '첫 화면의 목적은 제품 전체를 설명하는 것이 아니라 다음 행동을 분명하게 만드는 것입니다. 선택지를 줄이고 결과를 먼저 보여주세요.',
    '자동화 후보는 자주 반복되고 규칙이 분명하며 실패를 되돌릴 수 있는 일입니다. 먼저 체크리스트로 안정화한 뒤 자동화하세요.',
    '무료처럼 보이는 서비스도 사용량과 데이터 이동 비용이 생깁니다. 공개 키와 비밀키, 로컬 데이터와 서버 데이터를 구분하세요.',
    '30일 계획은 결과 하나, 주간 검증 네 번, 매일 30분 행동으로 구성합니다. 끝나는 날짜와 중단 기준까지 적어야 실행이 선명해집니다.'
  ];
  i integer;
begin
  insert into learn.courses(slug, title, summary, level, status, published_at)
  values (
    'solo-founder-7-day-system',
    '1인 창업을 굴리는 7일 시스템',
    '아이디어를 검증하고, 첫 화면을 만들고, 반복 업무를 안전하게 자동화하는 하루 한 강 과정입니다.',
    'beginner',
    'published',
    clock_timestamp()
  )
  on conflict (slug) do nothing;

  select id into v_course_id from learn.courses where slug = 'solo-founder-7-day-system';
  for i in 1..7 loop
    if i = 1 then
      v_release := clock_timestamp();
    else
      v_release := (((timezone('Asia/Seoul', clock_timestamp()))::date + (i - 1))::timestamp + time '09:00') at time zone 'Asia/Seoul';
    end if;
    insert into learn.lessons(course_id, slug, position, title, summary, estimated_minutes, status, publish_at)
    values (v_course_id, v_slugs[i], i, v_titles[i], v_summaries[i], 8 + i, 'published', v_release)
    on conflict (course_id, slug) do nothing;
    select id into v_lesson_id from learn.lessons where course_id = v_course_id and slug = v_slugs[i];
    if not exists (select 1 from learn.lesson_blocks where lesson_id = v_lesson_id) then
      insert into learn.lesson_blocks(lesson_id, position, block_type, body) values
        (v_lesson_id, 1, 'key_point', jsonb_build_object(
          'eyebrow', '오늘의 핵심',
          'title', v_titles[i],
          'text', v_summaries[i]
        )),
        (v_lesson_id, 2, 'visual', jsonb_build_object(
          'kind', 'steps',
          'title', '생각을 실행으로 잇는 흐름',
          'items', jsonb_build_array('관찰', '선택', '작은 실행', '확인')
        )),
        (v_lesson_id, 3, 'explanation', jsonb_build_object(
          'title', '왜 필요한가요?',
          'text', v_body[i]
        )),
        (v_lesson_id, 4, 'interactive', jsonb_build_object(
          'title', '10분 실행',
          'prompt', '지금 프로젝트에 적용할 한 가지 행동을 적고 오늘 안에 완료하세요.',
          'placeholder', '예: 기존 사용자 한 명에게 현재 불편을 물어본다.'
        )),
        (v_lesson_id, 5, 'callout', jsonb_build_object(
          'tone', 'info',
          'title', '완벽보다 확인',
          'text', '오늘의 목표는 정답을 만드는 것이 아니라 다음 판단에 필요한 증거를 남기는 것입니다.'
        ));
    end if;
  end loop;
end
$$;
