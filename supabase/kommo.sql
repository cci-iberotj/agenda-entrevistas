-- ═══════════════════════════════════════════════════════════
-- Agenda de entrevistas → Kommo (CRM de Sergio, mdigitales.kommo.com)
-- 5-nov-2026
--
-- Cada vez que una cita se agenda, cambia, cancela o se marca su
-- resultado, un disparador la deja en la cola admisiones.kommo_cola.
-- Cada minuto, pg_cron corre admisiones.kommo_procesar(), que la manda
-- a Kommo por su API:
--   · busca al prospecto por correo y luego por celular;
--   · usa su lead del embudo elegido (o crea uno) y lo pasa a la etapa
--     elegida al agendar o cambiar;
--   · llena Matrícula y los campos «Entrevista: …», y deja una nota.
-- El embudo y la etapa NO van en el código: se eligen en el Admin
-- (config.meta->'kommo'), porque Sergio puede reorganizar el CRM.
-- Si Kommo falla, la cita no se traba: se reintenta hasta 5 veces y el
-- error queda a la vista del Admin. El token vive en vault (kommo_token).
-- ═══════════════════════════════════════════════════════════

create extension if not exists http with schema extensions;

create table if not exists admisiones.kommo_cola (
  id bigserial primary key,
  cita text not null,
  evento text not null,            -- agendada | cambiada | cancelada | resultado
  creado timestamptz not null default now(),
  intentos int not null default 0,
  hecho timestamptz,
  error text
);
alter table admisiones.kommo_cola enable row level security;
revoke all on admisiones.kommo_cola from public, anon, authenticated;

-- ── Una llamada a la API de Kommo ────────────────────────────
create or replace function admisiones._kommo(metodo text, ruta text, cuerpo jsonb default null) returns jsonb
language plpgsql security definer set search_path = admisiones, public, extensions as $$
declare tok text; sub text; r extensions.http_response; b jsonb;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'kommo_token';
  select decrypted_secret into sub from vault.decrypted_secrets where name = 'kommo_subdominio';
  if tok is null or sub is null then return jsonb_build_object('status', 0, 'error', 'Falta el token de Kommo'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  r := extensions.http((metodo, 'https://' || sub || '.kommo.com/api/v4' || ruta,
         array[extensions.http_header('Authorization', 'Bearer ' || tok)],
         'application/json', case when cuerpo is null then null else cuerpo::text end)::extensions.http_request);
  begin b := nullif(r.content, '')::jsonb; exception when others then b := to_jsonb(left(r.content, 300)); end;
  return jsonb_build_object('status', r.status, 'body', b);
exception when others then
  return jsonb_build_object('status', 0, 'error', sqlerrm);
end $$;

create or replace function admisiones._kommo_ok(r jsonb, que text) returns jsonb language plpgsql as $$
begin
  if coalesce((r->>'status')::int, 0) not between 200 and 299 then
    raise exception 'Kommo (%): % %', que, r->>'status', left(coalesce(r->>'error', (r->'body')::text, ''), 250);
  end if;
  return r->'body';
end $$;

-- ── Mandar una cita a Kommo ──────────────────────────────────
create or replace function admisiones._kommo_cita(p_id text, p_evento text) returns void
language plpgsql security definer set search_path = admisiones, public, extensions as $$
declare
  k jsonb := (select meta->'kommo' from admisiones.config where id = 1);
  campos jsonb := coalesce((select meta->'kommo_campos' from admisiones.config where id = 1), '{}');
  c jsonb; s jsonb; co jsonb; car jsonb;
  pipe bigint; etapa bigint;
  lead_id bigint; contacto_id bigint; contacto jsonb; lead jsonb; r jsonb; b jsonb;
  tel text; cuando text; lugar text; nota text; vals jsonb := '[]'::jsonb; cambio jsonb;
  etapas jsonb; orden_actual int; orden_meta int; i int;
begin
  if k is null or not coalesce((k->>'activo')::boolean, false) then return; end if;
  pipe := (k->>'pipeline_id')::bigint; etapa := (k->>'status_id')::bigint;
  select d into c from admisiones.citas where id = p_id;
  if c is null then return; end if;
  select d into s from admisiones.solicitantes where matricula = c->>'matricula';
  select d into co from admisiones.coordinadores where id = c->>'coordinador';
  select d into car from admisiones.carreras where id = c->>'carrera';
  tel := right(regexp_replace(coalesce(c->>'telefono', ''), '\D', '', 'g'), 10);
  cuando := admisiones._fecha_corta((c->>'fecha')::date) || ', ' || (c->>'hora') || ' (' || coalesce(c->>'duracion', '') || ' min)';
  lugar := case when c->>'modalidad' = 'linea' then 'En línea: ' || coalesce(nullif(co->>'liga', ''), 'sin liga todavía')
                else 'Presencial: ' || coalesce(nullif(co->>'oficina', ''), 'IBERO Tijuana') end;

  -- 1 · ubicar el lead
  lead_id := (c->>'kommo_lead')::bigint;
  if lead_id is null then
    if coalesce(c->>'correo', '') <> '' then
      r := admisiones._kommo('GET', '/contacts?with=leads&query=' || extensions.urlencode(c->>'correo'));
      contacto := r->'body'->'_embedded'->'contacts'->0;
    end if;
    if contacto is null and length(tel) = 10 then
      r := admisiones._kommo('GET', '/contacts?with=leads&query=' || tel);
      contacto := r->'body'->'_embedded'->'contacts'->0;
    end if;
    if contacto is not null then
      contacto_id := (contacto->>'id')::bigint;
      -- su lead abierto del embudo elegido; si no tiene, uno nuevo
      for i in 0 .. least(coalesce(jsonb_array_length(contacto->'_embedded'->'leads'), 0), 15) - 1 loop
        r := admisiones._kommo('GET', '/leads/' || (contacto->'_embedded'->'leads'->i->>'id'));
        if (r->'body'->>'pipeline_id')::bigint = pipe and (r->'body'->>'status_id')::bigint not in (142, 143) then
          lead_id := (r->'body'->>'id')::bigint; exit;
        end if;
      end loop;
      if lead_id is null then
        b := admisiones._kommo_ok(admisiones._kommo('POST', '/leads', jsonb_build_array(jsonb_build_object(
               'name', c->>'nombre', 'pipeline_id', pipe, 'status_id', etapa,
               '_embedded', jsonb_build_object('contacts', jsonb_build_array(jsonb_build_object('id', contacto_id)))))), 'crear lead');
        lead_id := (b->'_embedded'->'leads'->0->>'id')::bigint;
      end if;
    else
      b := admisiones._kommo_ok(admisiones._kommo('POST', '/leads/complex', jsonb_build_array(jsonb_build_object(
             'name', c->>'nombre', 'pipeline_id', pipe, 'status_id', etapa,
             '_embedded', jsonb_build_object('contacts', jsonb_build_array(jsonb_build_object(
               'name', c->>'nombre',
               'custom_fields_values', (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('field_code', 'EMAIL', 'values', jsonb_build_array(jsonb_build_object('value', c->>'correo', 'enum_code', 'WORK'))) x
                   where coalesce(c->>'correo', '') <> ''
                  union all
                  select jsonb_build_object('field_code', 'PHONE', 'values', jsonb_build_array(jsonb_build_object('value', '+52' || tel, 'enum_code', 'MOB')))
                   where length(tel) = 10) y))))))), 'crear contacto y lead');
      lead_id := (b->0->>'id')::bigint;
      contacto_id := (b->0->>'contact_id')::bigint;
    end if;
    update admisiones.citas set d = d || jsonb_build_object('kommo_lead', lead_id, 'kommo_contacto', contacto_id) where id = p_id;
  end if;

  -- 2 · campos del lead
  if campos ? 'matricula' then
    vals := vals || jsonb_build_object('field_id', (campos->>'matricula')::bigint, 'values', jsonb_build_array(jsonb_build_object('value', c->>'matricula')));
  end if;
  if campos ? 'fecha' then
    vals := vals || jsonb_build_object('field_id', (campos->>'fecha')::bigint, 'values', jsonb_build_array(jsonb_build_object('value',
      extract(epoch from ((((c->>'fecha')::date) + (c->>'hora')::time) at time zone 'America/Tijuana'))::bigint)));
  end if;
  if campos ? 'coordinador' then
    vals := vals || jsonb_build_object('field_id', (campos->>'coordinador')::bigint, 'values', jsonb_build_array(jsonb_build_object('value',
      trim(coalesce(co->>'titulo', '') || ' ' || coalesce(co->>'nombre', '')))));
  end if;
  if campos ? 'modalidad' then
    vals := vals || jsonb_build_object('field_id', (campos->>'modalidad')::bigint, 'values', jsonb_build_array(jsonb_build_object('value',
      case when c->>'modalidad' = 'linea' then 'En línea' else 'Presencial' end)));
  end if;
  if campos ? 'lugar' then
    vals := vals || jsonb_build_object('field_id', (campos->>'lugar')::bigint, 'values', jsonb_build_array(jsonb_build_object('value', lugar)));
  end if;
  if campos ? 'estado' then
    vals := vals || jsonb_build_object('field_id', (campos->>'estado')::bigint, 'values', jsonb_build_array(jsonb_build_object('value',
      case p_evento when 'cancelada' then 'Cancelada'
        else case c->>'estado' when 'realizada' then 'Realizada' when 'no_asistio' then 'No asistió' when 'cancelada' then 'Cancelada' else 'Agendada' end ||
             case c->>'resultado' when 'admitido' then ' · Admitido' when 'no_admitido' then ' · No admitido' else '' end end)));
  end if;
  cambio := jsonb_build_object('id', lead_id, 'custom_fields_values', vals);

  -- 3 · mover a la etapa elegida al agendar o cambiar (nunca hacia atrás)
  if p_evento in ('agendada', 'cambiada') then
    lead := admisiones._kommo_ok(admisiones._kommo('GET', '/leads/' || lead_id), 'leer lead');
    etapas := admisiones._kommo_ok(admisiones._kommo('GET', '/leads/pipelines/' || pipe || '/statuses'), 'leer etapas')->'_embedded'->'statuses';
    select (e->>'sort')::int into orden_meta from jsonb_array_elements(etapas) e where (e->>'id')::bigint = etapa;
    select (e->>'sort')::int into orden_actual from jsonb_array_elements(etapas) e where (e->>'id')::bigint = (lead->>'status_id')::bigint;
    if (lead->>'pipeline_id')::bigint <> pipe or orden_actual is null or orden_actual < orden_meta then
      cambio := cambio || jsonb_build_object('pipeline_id', pipe, 'status_id', etapa);
    end if;
  end if;
  perform admisiones._kommo_ok(admisiones._kommo('PATCH', '/leads', jsonb_build_array(cambio)), 'actualizar lead');

  -- 4 · nota en el lead
  nota := case p_evento
    when 'agendada' then 'Entrevista de admisión agendada (desde la agenda)'
    when 'cambiada' then 'Entrevista de admisión CAMBIADA'
    when 'cancelada' then 'Entrevista de admisión CANCELADA'
    else 'Entrevista de admisión: ' || case c->>'estado' when 'realizada' then 'realizada' when 'no_asistio' then 'no asistió' else 'actualizada' end ||
         case c->>'resultado' when 'admitido' then ' · resultado: Admitido' when 'no_admitido' then ' · resultado: No admitido' else '' end end
    || E'\n' || cuando || E'\n' || lugar
    || E'\nCon: ' || trim(coalesce(co->>'titulo', '') || ' ' || coalesce(co->>'nombre', ''))
    || E'\nLicenciatura: ' || coalesce(car->>'nombre', '') || ' · Matrícula: ' || coalesce(c->>'matricula', '')
    || case when coalesce(c->>'telefono', '') <> '' then E'\nCelular: ' || (c->>'telefono') else '' end
    || case when (c->>'whatsapp')::boolean then E'\nAcepta avisos por WhatsApp' else '' end;
  perform admisiones._kommo_ok(admisiones._kommo('POST', '/leads/' || lead_id || '/notes',
    jsonb_build_array(jsonb_build_object('note_type', 'common', 'params', jsonb_build_object('text', nota)))), 'nota');
end $$;

-- ── La cola: cada minuto ─────────────────────────────────────
create or replace function admisiones.kommo_procesar() returns int
language plpgsql security definer set search_path = admisiones, public, extensions as $$
declare q record; n int := 0;
begin
  for q in select * from admisiones.kommo_cola where hecho is null and intentos < 5 order by id limit 15 loop
    begin
      perform admisiones._kommo_cita(q.cita, q.evento);
      update admisiones.kommo_cola set hecho = now(), intentos = intentos + 1, error = null where id = q.id;
      n := n + 1;
    exception when others then
      update admisiones.kommo_cola set intentos = intentos + 1, error = left(sqlerrm, 500) where id = q.id;
    end;
  end loop;
  delete from admisiones.kommo_cola where hecho < now() - interval '30 days';
  return n;
end $$;

-- ── El disparador: qué cambio vale la pena mandar ────────────
create or replace function admisiones._kommo_encolar() returns trigger
language plpgsql security definer set search_path = admisiones, public as $$
declare ev text;
begin
  if not coalesce(((select meta->'kommo' from admisiones.config where id = 1)->>'activo')::boolean, false) then return new; end if;
  if tg_op = 'INSERT' then ev := 'agendada';
  elsif new.estado = 'cancelada' and old.estado <> 'cancelada' then ev := 'cancelada';
  elsif new.estado = 'agendada' and (new.fecha, new.hora, new.d->>'modalidad') is distinct from (old.fecha, old.hora, old.d->>'modalidad') then ev := 'cambiada';
  elsif new.estado <> old.estado or (new.d->>'resultado') is distinct from (old.d->>'resultado') then ev := 'resultado';
  end if;
  if ev is not null then insert into admisiones.kommo_cola (cita, evento) values (new.id, ev); end if;
  return new;
end $$;
drop trigger if exists kommo_encolar on admisiones.citas;
create trigger kommo_encolar after insert or update on admisiones.citas
  for each row execute function admisiones._kommo_encolar();

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'agenda-kommo') then
    perform cron.schedule('agenda-kommo', '* * * * *', 'select admisiones.kommo_procesar()');
  end if;
end $$;

-- ── Para el Admin ────────────────────────────────────────────
-- Estado: si hay token, qué está elegido, los embudos de Kommo y la cola.
create or replace function public.adm_kommo_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare r jsonb;
begin
  perform admisiones._admin(p_token);
  r := admisiones._kommo('GET', '/leads/pipelines');
  return jsonb_build_object(
    'conectado', coalesce((r->>'status')::int, 0) = 200,
    'error', case when coalesce((r->>'status')::int, 0) <> 200 then coalesce(r->>'error', 'Kommo respondió ' || (r->>'status')) end,
    'ajustes', (select meta->'kommo' from admisiones.config where id = 1),
    'campos', (select meta->'kommo_campos' from admisiones.config where id = 1),
    'embudos', (select coalesce(jsonb_agg(jsonb_build_object('id', p->'id', 'nombre', p->'name',
                  'etapas', (select jsonb_agg(jsonb_build_object('id', s->'id', 'nombre', s->'name')) from jsonb_array_elements(p->'_embedded'->'statuses') s
                             where (s->>'id')::bigint not in (142, 143) and s->>'type' is distinct from '1'))), '[]')
                from jsonb_array_elements(r->'body'->'_embedded'->'pipelines') p),
    'pendientes', (select count(*) from admisiones.kommo_cola where hecho is null and intentos < 5),
    'enviados', (select count(*) from admisiones.kommo_cola where hecho is not null),
    'errores', (select coalesce(jsonb_agg(jsonb_build_object('cita', cita, 'evento', evento, 'error', error, 'intentos', intentos) order by id desc), '[]')
                from (select * from admisiones.kommo_cola where hecho is null and error is not null order by id desc limit 5) e));
end $$;

-- Guardar: activo, embudo y etapa. La primera vez crea en Kommo los
-- campos «Entrevista: …» que falten y ubica «Matrícula».
create or replace function public.adm_kommo_guardar(p_token text, p_activo boolean, p_pipeline bigint, p_status bigint) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare campos jsonb; existentes jsonb; f record; nuevo jsonb;
begin
  perform admisiones._admin(p_token);
  existentes := admisiones._kommo_ok(admisiones._kommo('GET', '/leads/custom_fields?limit=250'), 'leer campos')->'_embedded'->'custom_fields';
  campos := '{}'::jsonb;
  for f in select * from (values ('matricula', 'Matrícula', 'text'), ('fecha', 'Entrevista: fecha y hora', 'date_time'),
                                  ('coordinador', 'Entrevista: coordinador', 'text'), ('modalidad', 'Entrevista: modalidad', 'text'),
                                  ('lugar', 'Entrevista: lugar o liga', 'text'), ('estado', 'Entrevista: estado', 'text')) v(clave, nombre, tipo) loop
    select x into nuevo from jsonb_array_elements(existentes) x where x->>'name' = f.nombre limit 1;
    if nuevo is null then
      nuevo := admisiones._kommo_ok(admisiones._kommo('POST', '/leads/custom_fields',
                 jsonb_build_array(jsonb_build_object('name', f.nombre, 'type', f.tipo))), 'crear campo')->'_embedded'->'custom_fields'->0;
    end if;
    campos := campos || jsonb_build_object(f.clave, (nuevo->>'id')::bigint);
  end loop;
  update admisiones.config set meta = meta || jsonb_build_object(
    'kommo', jsonb_build_object('activo', p_activo, 'pipeline_id', p_pipeline, 'status_id', p_status),
    'kommo_campos', campos) where id = 1;
  return public.adm_kommo_estado(p_token);
end $$;

-- Mandar a Kommo las citas próximas que todavía no estén allá.
create or replace function public.adm_kommo_sincronizar(p_token text) returns int
language plpgsql security definer set search_path = admisiones, public as $$
declare n int;
begin
  perform admisiones._admin(p_token);
  insert into admisiones.kommo_cola (cita, evento)
    select id, 'agendada' from admisiones.citas
     where estado = 'agendada' and fecha >= admisiones._hoy() and not (d ? 'kommo_lead')
       and id not in (select cita from admisiones.kommo_cola where hecho is null and intentos < 5);
  get diagnostics n = row_count;
  return n;
end $$;

-- Reintentar las que fallaron 5 veces.
create or replace function public.adm_kommo_reintentar(p_token text) returns int
language plpgsql security definer set search_path = admisiones, public as $$
declare n int;
begin
  perform admisiones._admin(p_token);
  update admisiones.kommo_cola set intentos = 0 where hecho is null and intentos >= 5;
  get diagnostics n = row_count;
  return n;
end $$;

do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'adm\_kommo%' loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'admisiones' and (p.proname like '%kommo%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
