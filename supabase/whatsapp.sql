-- ═══════════════════════════════════════════════════════════
-- Agenda de entrevistas → WhatsApp por Kommo
-- 5-nov-2026 · se corre DESPUÉS de kommo.sql
--
-- Kommo sólo manda plantillas de WhatsApp (las que aprueba Meta) a
-- través de un Salesbot. La API no crea bots, pero sí los lanza:
--   POST /api/v2/salesbot/run  [{bot_id, entity_id: lead, entity_type: 2}]
-- Hay dos bots hechos a mano en Kommo, cada uno con un solo paso que
-- manda su plantilla y SIN disparador propio:
--   · confirmación  → al agendar o cambiar la cita
--   · recordatorio  → un cron cada hora, ~24 h antes
-- Sólo si el prospecto aceptó la casilla de WhatsApp (cita.whatsapp).
--
-- MODO PRUEBA (encendido de fábrica): sólo se manda si TODOS los
-- celulares del contacto en Kommo están en la lista de prueba. Así ni
-- por error le llega algo a un prospecto real hasta que Leo lo apruebe.
-- Los leads de prueba quedan con la etiqueta «prueba-agenda».
--
-- Ajustes en config.meta->'kommo_wa' (Admin → Ajustes → WhatsApp):
--   {activo, prueba, lista:[tel10], bot_confirmacion, bot_recordatorio, horas}
-- ═══════════════════════════════════════════════════════════

-- _kommo acepta también rutas fuera de /api/v4 (la de salesbot es v2)
create or replace function admisiones._kommo(metodo text, ruta text, cuerpo jsonb default null) returns jsonb
language plpgsql security definer set search_path = admisiones, public, extensions as $$
declare tok text; sub text; r extensions.http_response; b jsonb;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'kommo_token';
  select decrypted_secret into sub from vault.decrypted_secrets where name = 'kommo_subdominio';
  if tok is null or sub is null then return jsonb_build_object('status', 0, 'error', 'Falta el token de Kommo'); end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  r := extensions.http((metodo, 'https://' || sub || '.kommo.com' || case when ruta like '/api/%' then ruta else '/api/v4' || ruta end,
         array[extensions.http_header('Authorization', 'Bearer ' || tok)],
         'application/json', case when cuerpo is null then null else cuerpo::text end)::extensions.http_request);
  begin b := nullif(r.content, '')::jsonb; exception when others then b := to_jsonb(left(r.content, 300)); end;
  return jsonb_build_object('status', r.status, 'body', b);
exception when others then
  return jsonb_build_object('status', 0, 'error', sqlerrm);
end $$;

-- ── Mandar un WhatsApp (lanzar el bot) ───────────────────────
-- Devuelve lo que pasó; lo deja anotado en la cita (wa_confirmacion /
-- wa_recordatorio) para no repetirlo y para que el Admin lo vea.
create or replace function admisiones._kommo_wa(p_id text, p_lead bigint, p_cual text) returns text
language plpgsql security definer set search_path = admisiones, public, extensions as $$
declare
  w jsonb := coalesce((select meta->'kommo_wa' from admisiones.config where id = 1), '{}');
  c jsonb; bot bigint; contacto_id bigint; tels text[]; lista text[]; que text; r jsonb;
begin
  select d into c from admisiones.citas where id = p_id;
  if c is null or not coalesce((w->>'activo')::boolean, false) then return 'apagado'; end if;
  if not coalesce((c->>'whatsapp')::boolean, false) then return 'sin permiso'; end if;
  bot := nullif(w->>('bot_' || p_cual), '')::bigint;
  if bot is null then return 'sin bot'; end if;

  -- los celulares que Kommo tiene del contacto principal del lead: a ésos manda el bot
  r := admisiones._kommo_ok(admisiones._kommo('GET', '/leads/' || p_lead || '?with=contacts'), 'leer lead');
  select (x->>'id')::bigint into contacto_id from jsonb_array_elements(r->'_embedded'->'contacts') x
   order by (x->>'is_main')::boolean desc limit 1;
  if contacto_id is not null then
    r := admisiones._kommo_ok(admisiones._kommo('GET', '/contacts/' || contacto_id), 'leer contacto');
    select array_agg(distinct right(regexp_replace(v->>'value', '\D', '', 'g'), 10)) into tels
      from jsonb_array_elements(r->'custom_fields_values') f, jsonb_array_elements(f->'values') v
     where f->>'field_code' = 'PHONE';
  end if;

  if coalesce((w->>'prueba')::boolean, true) then
    select array_agg(right(regexp_replace(x, '\D', '', 'g'), 10)) into lista from jsonb_array_elements_text(coalesce(w->'lista', '[]')) x;
    if tels is null or not (tels <@ coalesce(lista, '{}')) then
      que := 'omitido (modo prueba: ' || coalesce(array_to_string(tels, ', '), 'sin celular') || ' no está en la lista)';
      update admisiones.citas set d = d || jsonb_build_object('wa_' || p_cual, jsonb_build_object('en', now(), 'que', que)) where id = p_id;
      return que;
    end if;
    perform admisiones._kommo('PATCH', '/leads', jsonb_build_array(jsonb_build_object('id', p_lead,
      'tags_to_add', jsonb_build_array(jsonb_build_object('name', 'prueba-agenda')))));
  elsif tels is null then
    que := 'sin celular en Kommo';
    update admisiones.citas set d = d || jsonb_build_object('wa_' || p_cual, jsonb_build_object('en', now(), 'que', que)) where id = p_id;
    return que;
  end if;

  perform admisiones._kommo_ok(admisiones._kommo('POST', '/api/v2/salesbot/run',
    jsonb_build_array(jsonb_build_object('bot_id', bot, 'entity_id', p_lead, 'entity_type', 2))), 'lanzar bot');
  que := 'enviado a ' || array_to_string(tels, ', ');
  update admisiones.citas set d = d || jsonb_build_object('wa_' || p_cual, jsonb_build_object('en', now(), 'que', que)) where id = p_id;
  return que;
end $$;

-- ── _kommo_cita: igual que en kommo.sql + paso 5 (WhatsApp) ──
-- y el evento «recordatorio» (sólo refresca campos y lanza el bot).
create or replace function admisiones._kommo_cita(p_id text, p_evento text) returns void
language plpgsql security definer set search_path = admisiones, public, extensions as $$
declare
  k jsonb := (select meta->'kommo' from admisiones.config where id = 1);
  campos jsonb := coalesce((select meta->'kommo_campos' from admisiones.config where id = 1), '{}');
  c jsonb; s jsonb; co jsonb; car jsonb;
  pipe bigint; etapa bigint;
  lead_id bigint; contacto_id bigint; contacto jsonb; lead jsonb; r jsonb; b jsonb;
  tel text; cuando text; lugar text; nota text; vals jsonb := '[]'::jsonb; cambio jsonb;
  etapas jsonb; orden_actual int; orden_meta int; i int; wa text;
begin
  if k is null or not coalesce((k->>'activo')::boolean, false) then return; end if;
  pipe := (k->>'pipeline_id')::bigint; etapa := (k->>'status_id')::bigint;
  select d into c from admisiones.citas where id = p_id;
  if c is null then return; end if;
  -- un recordatorio de una cita que ya se canceló o se movió fuera de la ventana: nada
  if p_evento = 'recordatorio' and c->>'estado' <> 'agendada' then return; end if;
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
      -- si Kommo no tiene ningún celular del contacto, se le pone el que dio en la agenda
      if length(tel) = 10 and not exists (select 1 from jsonb_array_elements(coalesce(contacto->'custom_fields_values', '[]')) f
                                           where f->>'field_code' = 'PHONE') then
        perform admisiones._kommo('PATCH', '/contacts', jsonb_build_array(jsonb_build_object('id', contacto_id,
          'custom_fields_values', jsonb_build_array(jsonb_build_object('field_code', 'PHONE',
            'values', jsonb_build_array(jsonb_build_object('value', '+52' || tel, 'enum_code', 'MOB')))))));
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

  -- 2 · campos del lead (los leen las plantillas de WhatsApp)
  if campos ? 'matricula' then
    vals := vals || jsonb_build_object('field_id', (campos->>'matricula')::bigint, 'values', jsonb_build_array(jsonb_build_object('value', c->>'matricula')));
  end if;
  if campos ? 'fecha' then
    vals := vals || jsonb_build_object('field_id', (campos->>'fecha')::bigint, 'values', jsonb_build_array(jsonb_build_object('value',
      extract(epoch from ((((c->>'fecha')::date) + (c->>'hora')::time) at time zone 'America/Tijuana'))::bigint)));
  end if;
  if campos ? 'cuando' then
    vals := vals || jsonb_build_object('field_id', (campos->>'cuando')::bigint, 'values', jsonb_build_array(jsonb_build_object('value',
      admisiones._cuando((c->>'fecha')::date, c->>'hora'))));
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

  -- 4 · WhatsApp (antes de la nota, para que la nota diga qué pasó)
  if p_evento in ('agendada', 'cambiada') then
    -- una cita movida vuelve a merecer su recordatorio
    update admisiones.citas set d = d - 'wa_recordatorio' where id = p_id;
    wa := admisiones._kommo_wa(p_id, lead_id, 'confirmacion');
  elsif p_evento = 'recordatorio' then
    wa := admisiones._kommo_wa(p_id, lead_id, 'recordatorio');
  end if;

  -- 5 · nota en el lead
  nota := case p_evento
    when 'agendada' then 'Entrevista de admisión agendada (desde la agenda)'
    when 'cambiada' then 'Entrevista de admisión CAMBIADA'
    when 'cancelada' then 'Entrevista de admisión CANCELADA'
    when 'recordatorio' then 'Recordatorio de entrevista por WhatsApp'
    else 'Entrevista de admisión: ' || case c->>'estado' when 'realizada' then 'realizada' when 'no_asistio' then 'no asistió' else 'actualizada' end ||
         case c->>'resultado' when 'admitido' then ' · resultado: Admitido' when 'no_admitido' then ' · resultado: No admitido' else '' end end
    || E'\n' || cuando || E'\n' || lugar
    || E'\nCon: ' || trim(coalesce(co->>'titulo', '') || ' ' || coalesce(co->>'nombre', ''))
    || E'\nLicenciatura: ' || coalesce(car->>'nombre', '') || ' · Matrícula: ' || coalesce(c->>'matricula', '')
    || case when coalesce(c->>'telefono', '') <> '' then E'\nCelular: ' || (c->>'telefono') else '' end
    || case when (c->>'whatsapp')::boolean then E'\nAcepta avisos por WhatsApp' else '' end
    || case when wa is not null and wa not in ('apagado', 'sin permiso') then E'\nWhatsApp: ' || wa else '' end;
  perform admisiones._kommo_ok(admisiones._kommo('POST', '/leads/' || lead_id || '/notes',
    jsonb_build_array(jsonb_build_object('note_type', 'common', 'params', jsonb_build_object('text', nota)))), 'nota');
end $$;

-- ── Recordatorios: cada hora, las citas que caen en las próximas N h ──
-- No a quien agendó hace menos de 12 h (acaba de recibir su confirmación).
create or replace function admisiones.kommo_recordatorios() returns int
language plpgsql security definer set search_path = admisiones, public as $$
declare
  w jsonb := coalesce((select meta->'kommo_wa' from admisiones.config where id = 1), '{}');
  n int;
begin
  if not coalesce((w->>'activo')::boolean, false) or nullif(w->>'bot_recordatorio', '') is null then return 0; end if;
  insert into admisiones.kommo_cola (cita, evento)
    select c.id, 'recordatorio' from admisiones.citas c
     where c.estado = 'agendada' and coalesce((c.d->>'whatsapp')::boolean, false)
       and not (c.d ? 'wa_recordatorio')
       and ((c.fecha + c.hora::time) at time zone 'America/Tijuana')
           between now() + interval '1 hour' and now() + make_interval(hours => coalesce((w->>'horas')::int, 24))
       and coalesce((c.d->'wa_confirmacion'->>'en')::timestamptz, c.creado) < now() - interval '12 hours'
       and c.id not in (select cita from admisiones.kommo_cola where evento = 'recordatorio' and hecho is null and intentos < 5);
  get diagnostics n = row_count;
  return n;
end $$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'agenda-recordatorios') then
    perform cron.schedule('agenda-recordatorios', '5 * * * *', 'select admisiones.kommo_recordatorios()');
  end if;
end $$;

-- ── Para el Admin ────────────────────────────────────────────
-- Estado de WhatsApp: ajustes, los bots que hay en Kommo y los últimos envíos.
create or replace function public.adm_kommo_wa_estado(p_token text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare r jsonb;
begin
  perform admisiones._admin(p_token);
  r := admisiones._kommo('GET', '/bots');
  return jsonb_build_object(
    'ajustes', coalesce((select meta->'kommo_wa' from admisiones.config where id = 1), '{"prueba": true}'::jsonb),
    'bots', (select coalesce(jsonb_agg(jsonb_build_object('id', b->'id', 'nombre', b->'name') order by b->>'name'), '[]')
               from jsonb_array_elements(r->'body'->'_embedded'->'items') b
              where b->>'type_functionality' = 'regular'),
    'ultimos', (select coalesce(jsonb_agg(x order by x->>'en' desc), '[]') from (
                  select x from (
                    select jsonb_build_object('cita', id, 'nombre', d->>'nombre', 'cual', 'Confirmación',
                                              'en', d->'wa_confirmacion'->>'en', 'que', d->'wa_confirmacion'->>'que') x
                      from admisiones.citas where d ? 'wa_confirmacion'
                    union all
                    select jsonb_build_object('cita', id, 'nombre', d->>'nombre', 'cual', 'Recordatorio',
                                              'en', d->'wa_recordatorio'->>'en', 'que', d->'wa_recordatorio'->>'que')
                      from admisiones.citas where d ? 'wa_recordatorio') u
                  order by x->>'en' desc limit 8) t));
end $$;

create or replace function public.adm_kommo_wa_guardar(p_token text, p_activo boolean, p_prueba boolean, p_lista text,
                                                        p_bot_confirmacion bigint, p_bot_recordatorio bigint, p_horas int) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare lista jsonb;
begin
  perform admisiones._admin(p_token);
  select coalesce(jsonb_agg(distinct t), '[]') into lista
    from (select right(regexp_replace(x, '\D', '', 'g'), 10) t from regexp_split_to_table(coalesce(p_lista, ''), '[,;\n]+') x) y
   where length(t) = 10;
  if not coalesce(p_prueba, true) and coalesce(p_activo, false) and (p_bot_confirmacion is null) then
    raise exception 'Falta elegir el bot de confirmación.';
  end if;
  update admisiones.config set meta = meta || jsonb_build_object('kommo_wa', jsonb_build_object(
    'activo', coalesce(p_activo, false), 'prueba', coalesce(p_prueba, true), 'lista', lista,
    'bot_confirmacion', p_bot_confirmacion, 'bot_recordatorio', p_bot_recordatorio,
    'horas', greatest(2, least(coalesce(p_horas, 24), 72)))) where id = 1;
  return public.adm_kommo_wa_estado(p_token);
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
