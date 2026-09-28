begin;

do $$
declare
  v_user uuid := '11111111-1111-4111-8111-111111111111';
  v_scope uuid := '22222222-2222-4222-8222-222222222222';
  v_result jsonb;
  v_course jsonb;
  v_admin jsonb;
  v_lesson_id uuid;
  v_future_id uuid;
  v_future_blocked boolean := false;
  v_payload jsonb := jsonb_build_object(
    'title', 'Contract test course',
    'summary', 'This transaction is rolled back.',
    'level', 'beginner',
    'status', 'published',
    'lessons', jsonb_build_array(
      jsonb_build_object(
        'slug', 'released-lesson', 'title', 'Released lesson', 'summary', '',
        'estimatedMinutes', 5, 'status', 'published', 'publishAt', clock_timestamp(),
        'blocks', jsonb_build_array(jsonb_build_object(
          'type', 'key_point', 'body', jsonb_build_object('title', 'Released', 'text', 'Test')
        ))
      ),
      jsonb_build_object(
        'slug', 'scheduled-lesson', 'title', 'Scheduled lesson', 'summary', '',
        'estimatedMinutes', 5, 'status', 'published', 'publishAt', clock_timestamp() + interval '1 day',
        'blocks', jsonb_build_array(jsonb_build_object(
          'type', 'key_point', 'body', jsonb_build_object('title', 'Scheduled', 'text', 'Test')
        ))
      )
    )
  );
begin
  if has_function_privilege('anon', 'public.service_v1_learn_admin_catalog(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_v1_learn_admin_catalog(uuid,uuid)', 'EXECUTE') then
    raise exception 'Admin RPC is exposed to a client role';
  end if;

  v_result := public.service_v1_learn_admin_save_course(
    v_user, v_scope, 'contract-test-course', v_payload, 0,
    'contract-test-create', repeat('a', 64)
  );
  if v_result ->> 'accepted' <> 'true' then raise exception 'Create failed: %', v_result; end if;

  if public.service_v1_learn_admin_save_course(
    v_user, v_scope, 'contract-test-course', v_payload, 0,
    'contract-test-create', repeat('a', 64)
  ) <> v_result then raise exception 'Idempotent replay mismatch'; end if;

  v_result := public.service_v1_learn_admin_save_course(
    v_user, v_scope, 'contract-test-course', v_payload, 0,
    'contract-test-conflict', repeat('b', 64)
  );
  if v_result ->> 'accepted' <> 'false' then raise exception 'Version conflict missing'; end if;

  v_course := public.service_v1_learn_course(v_user, v_scope, 'contract-test-course');
  if jsonb_array_length(v_course -> 'lessons') <> 1 then raise exception 'Scheduled lesson leaked'; end if;

  v_admin := public.service_v1_learn_admin_course(v_user, v_scope, 'contract-test-course');
  if jsonb_array_length(v_admin -> 'lessons') <> 2 then raise exception 'Admin schedule incomplete'; end if;

  select id into v_lesson_id from learn.lessons
  where course_id = (select id from learn.courses where slug = 'contract-test-course') and slug = 'released-lesson';
  v_result := public.service_v1_learn_progress_apply(
    v_user, v_scope, v_lesson_id, 'completed', 100, '{}'::jsonb, 0,
    'contract-progress-ok', repeat('c', 64)
  );
  if v_result ->> 'accepted' <> 'true' then raise exception 'Released progress failed'; end if;

  select id into v_future_id from learn.lessons
  where course_id = (select id from learn.courses where slug = 'contract-test-course') and slug = 'scheduled-lesson';
  begin
    perform public.service_v1_learn_progress_apply(
      v_user, v_scope, v_future_id, 'in_progress', 10, '{}'::jsonb, 0,
      'contract-progress-no', repeat('d', 64)
    );
  exception when no_data_found then
    v_future_blocked := true;
  end;
  if not v_future_blocked then raise exception 'Future lesson progress was accepted'; end if;
end
$$;

rollback;
