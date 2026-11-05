-- ═══════════════════════════════════════════════════════════
-- Agenda de entrevistas · Admisiones IBERO Tijuana
-- Vive en la base de LA PIZARRA, en su propio esquema «admisiones».
--
-- REGLA DE ORO: las tablas NO se ven desde la página. El esquema no
-- está expuesto en la API y además tiene RLS sin políticas. Todo pasa
-- por funciones public.adm_* (security definer) que revisan quién
-- pregunta:
--   · el prospecto, con matrícula + correo (los dos del Excel);
--   · coordinadores y Admisiones, con una sesión que da adm_entrar
--     (usuario + clave propia de la agenda; NO son cuentas de LA PIZARRA).
-- Cada entidad guarda su objeto completo en «d» (jsonb), con la misma
-- forma que usa la página (almacen.js); las columnas sueltas de citas
-- existen para los candados y las búsquedas.
--
-- Se puede volver a correr: todo es «if not exists» / «or replace».
-- ═══════════════════════════════════════════════════════════

create schema if not exists admisiones;
revoke all on schema admisiones from public, anon, authenticated;

create table if not exists admisiones.config (
  id int primary key default 1 check (id = 1),
  ajustes jsonb not null default '{"duracion":20,"anticipacion":24,"diasAdelante":21,"horaInicio":8,"horaFin":20}',
  meta jsonb not null default '{}'
);
insert into admisiones.config (id) values (1) on conflict do nothing;

create table if not exists admisiones.carreras      (id text primary key, d jsonb not null);
create table if not exists admisiones.coordinadores (id text primary key, d jsonb not null, clave text);
-- La clave que da Admisiones es temporal: al entrar, la agenda le pide poner una propia.
alter table admisiones.coordinadores add column if not exists clave_temporal boolean not null default false;
create table if not exists admisiones.solicitantes  (matricula text primary key, d jsonb not null);
create table if not exists admisiones.citas (
  id text primary key, d jsonb not null,
  matricula text not null, coordinador text not null,
  fecha date not null, hora text not null, estado text not null,
  creado timestamptz not null default now()
);
create index if not exists citas_coord_fecha on admisiones.citas (coordinador, fecha);
create index if not exists citas_matricula on admisiones.citas (matricula);
create table if not exists admisiones.admins   (usuario text primary key, nombre text not null, clave text not null);
create table if not exists admisiones.sesiones (token text primary key, rol text not null, quien text not null,
                                                nombre text not null, expira timestamptz not null);

do $$ declare t text; begin
  foreach t in array array['config','carreras','coordinadores','solicitantes','citas','admins','sesiones'] loop
    execute format('alter table admisiones.%I enable row level security', t);
    execute format('revoke all on admisiones.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ── Ayudantes (privados, en el esquema que nadie ve) ──────────

create or replace function admisiones._aj() returns jsonb language sql stable as
$$ select ajustes from admisiones.config where id = 1 $$;

create or replace function admisiones._hoy() returns date language sql stable as
$$ select (now() at time zone 'America/Tijuana')::date $$;

create or replace function admisiones._min(h text) returns int language sql immutable as
$$ select split_part(h, ':', 1)::int * 60 + split_part(h, ':', 2)::int $$;

create or replace function admisiones._hhmm(m int) returns text language sql immutable as
$$ select lpad((m / 60)::text, 2, '0') || ':' || lpad((m % 60)::text, 2, '0') $$;

-- igual que Importar.norm del navegador: minúsculas, sin acentos, un espacio
create or replace function admisiones._norm(t text) returns text language sql immutable as
$$ select regexp_replace(translate(lower(trim(coalesce(t, ''))), 'áéíóúüñàèìòù', 'aeiouunaeiou'), '\s+', ' ', 'g') $$;

-- «mié 4 nov», para el historial
create or replace function admisiones._fecha_corta(f date) returns text language sql immutable as $$
  select (array['dom','lun','mar','mié','jue','vie','sáb'])[extract(dow from f)::int + 1] || ' ' ||
         extract(day from f)::int || ' ' ||
         (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from f)::int]
$$;

create or replace function admisiones._codigo(n int) returns text language plpgsql volatile as $$
declare abc text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(n); s text := ''; i int;
begin
  for i in 0 .. n - 1 loop s := s || substr(abc, get_byte(b, i) % length(abc) + 1, 1); end loop;
  return s;
end $$;

-- Misma regla que Agenda.permiso: Aprobado o Pase directo; «A consideración» sólo habilitado.
create or replace function admisiones._permiso(s jsonb) returns text language sql immutable as $$
  select case
    when s is null then 'no_existe'
    when coalesce((s->>'fuera')::boolean, false) then 'fuera'
    when admisiones._norm(s->>'resultado') like 'aprobado%' or admisiones._norm(s->>'resultado') like 'pase directo%' then 'ok'
    when admisiones._norm(s->>'resultado') like 'a consideracion%' then
      case when coalesce((s->>'habilitado')::boolean, false) then 'ok' else 'consideracion' end
    when admisiones._norm(s->>'resultado') like 'no aprobado%' then 'no_aprobado'
    else 'pendiente' end
$$;

create or replace function admisiones._carrera_de(s jsonb) returns jsonb language sql stable as $$
  select d from admisiones.carreras
  where coalesce((d->>'activa')::boolean, true) and admisiones._norm(d->>'nombre') = admisiones._norm(s->>'licenciatura')
  limit 1
$$;

-- Lo que el público puede ver de un coordinador (sin su correo)
create or replace function admisiones._co_publico(d jsonb) returns jsonb language sql immutable as
$$ select d - 'correo' $$;

create or replace function admisiones._anotar(d jsonb, que text, quien text) returns jsonb language sql stable as $$
  select jsonb_set(d, '{historial}', coalesce(d->'historial', '[]'::jsonb) ||
    jsonb_build_object('cuando', now(), 'que', que, 'quien', quien))
$$;

create or replace function admisiones._guardar_cita(c jsonb) returns jsonb language plpgsql as $$
begin
  insert into admisiones.citas (id, d, matricula, coordinador, fecha, hora, estado)
  values (c->>'id', c, c->>'matricula', c->>'coordinador', (c->>'fecha')::date, c->>'hora', c->>'estado')
  on conflict (id) do update set d = excluded.d, matricula = excluded.matricula, coordinador = excluded.coordinador,
    fecha = excluded.fecha, hora = excluded.hora, estado = excluded.estado;
  return c;
end $$;

-- ¿Ese horario sigue libre? La misma cuenta que Agenda.espacios:
-- todas las medias horas que toca están pintadas con una modalidad
-- compatible, no hay bloqueo, no choca con otra cita y cumple la
-- anticipación (desde dentro: sólo que no sea pasado).
create or replace function admisiones._libre(co jsonb, f date, h text, modalidad text, ignorar text, interno boolean)
returns boolean language plpgsql stable as $$
declare
  aj jsonb := admisiones._aj();
  dur int := (aj->>'duracion')::int;
  dia jsonb := coalesce(co->'semana'->((array['dom','lun','mar','mie','jue','vie','sab'])[extract(dow from f)::int + 1]), '{}'::jsonb);
  m int := admisiones._min(h);
  c int;
  tipo text;
begin
  if co is null or not coalesce((co->>'activo')::boolean, true) then return false; end if;
  if h !~ '^\d\d:\d\d$' or modalidad not in ('presencial', 'linea') then return false; end if;
  -- en línea sólo con liga de REUNIÓN (no de equipo, canal o chat de Teams); igual que Agenda.ligaValida
  if modalidad = 'linea' and not (coalesce(co->>'liga', '') ~* '^https?://\S+$'
       and coalesce(co->>'liga', '') !~* 'teams\.microsoft\.com/l/(team|channel|chat)/') then return false; end if;
  c := (m / 30) * 30;
  while c < m + dur loop
    tipo := dia->>admisiones._hhmm(c);
    if tipo is null then return false; end if;
    if modalidad = 'presencial' and tipo not in ('a', 'p') then return false; end if;
    if modalidad = 'linea' and tipo not in ('a', 'l') then return false; end if;
    c := c + 30;
  end loop;
  if exists (select 1 from jsonb_array_elements(coalesce(co->'bloqueos', '[]'::jsonb)) b
             where b->>'fecha' = f::text and (b->>'desde' is null or
               (m < admisiones._min(b->>'hasta') and admisiones._min(b->>'desde') < m + dur))) then return false; end if;
  if exists (select 1 from admisiones.citas x
             where x.coordinador = co->>'id' and x.fecha = f and x.estado <> 'cancelada' and x.id is distinct from ignorar
               and m < admisiones._min(x.hora) + coalesce((x.d->>'duracion')::int, dur) and admisiones._min(x.hora) < m + dur) then return false; end if;
  if ((f + make_interval(mins => m)) at time zone 'America/Tijuana') <
     now() + (case when interno then interval '0' else make_interval(hours => (aj->>'anticipacion')::int) end) then return false; end if;
  if not interno and f > admisiones._hoy() + (aj->>'diasAdelante')::int then return false; end if;
  return true;
end $$;

create or replace function admisiones._sesion(t text) returns admisiones.sesiones language plpgsql as $$
declare s admisiones.sesiones;
begin
  select * into s from admisiones.sesiones where token = t and expira > now();
  if not found then raise exception 'SIN_SESION' using errcode = '28000'; end if;
  return s;
end $$;

create or replace function admisiones._admin(t text) returns admisiones.sesiones language plpgsql as $$
declare s admisiones.sesiones := admisiones._sesion(t);
begin
  if s.rol <> 'admin' then raise exception 'SOLO_ADMIN'; end if;
  return s;
end $$;

-- El prospecto: matrícula + correo. Si el Excel no traía correo, basta la matrícula.
create or replace function admisiones._prospecto(p_matricula text, p_correo text) returns jsonb language plpgsql as $$
declare s jsonb;
begin
  select d into s from admisiones.solicitantes where matricula = upper(trim(p_matricula));
  if s is null then perform pg_sleep(0.3); raise exception 'NO_EXISTE'; end if;
  if coalesce(s->>'correo', '') <> '' and lower(s->>'correo') <> lower(trim(coalesce(p_correo, ''))) then
    perform pg_sleep(0.3); raise exception 'CORREO';
  end if;
  return s;
end $$;

-- Los coordinadores de una sesión: sus carreras
create or replace function admisiones._mis_carreras(s admisiones.sesiones) returns setof text language sql stable as
$$ select id from admisiones.carreras where s.rol = 'admin' or d->>'coordinador' = s.quien $$;

create or replace function admisiones._puede_cita(s admisiones.sesiones, c jsonb) returns void language plpgsql as $$
begin
  if c is null then raise exception 'No encontré esa cita.'; end if;
  if s.rol <> 'admin' and c->>'coordinador' <> s.quien then raise exception 'Esa cita no es de tu agenda.'; end if;
end $$;

-- ══ PÚBLICO: lo que puede llamar la página del prospecto ══════

create or replace function public.adm_publico() returns jsonb
language sql stable security definer set search_path = admisiones, public as
$$ select jsonb_build_object('ajustes', admisiones._aj()) $$;

create or replace function public.adm_identificar(p_matricula text, p_correo text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s jsonb; car jsonb; vig jsonb; ult jsonb; hoy date := admisiones._hoy(); coords text[];
begin
  s := admisiones._prospecto(p_matricula, p_correo);
  select d into vig from admisiones.citas where matricula = s->>'matricula' and estado = 'agendada' and fecha >= hoy order by fecha, hora limit 1;
  select d into ult from admisiones.citas where matricula = s->>'matricula' and estado <> 'cancelada' order by fecha desc, hora desc limit 1;
  car := admisiones._carrera_de(s);
  coords := array_remove(array[car->>'coordinador', ult->>'coordinador'], null);
  return jsonb_build_object(
    's', jsonb_build_object('matricula', s->>'matricula', 'nombre', s->>'nombre', 'licenciatura', s->>'licenciatura',
                            'correo', s->>'correo', 'resultado', s->>'resultado', 'habilitado', s->'habilitado', 'fuera', s->'fuera'),
    'permiso', admisiones._permiso(s),
    'vigente', vig,
    'cita', coalesce(vig, ult),
    'carrera', car,
    'datos', jsonb_build_object(
      'ajustes', admisiones._aj(),
      'carreras', (select coalesce(jsonb_agg(d), '[]') from admisiones.carreras where id in (car->>'id', ult->>'carrera')),
      'coordinadores', (select coalesce(jsonb_agg(admisiones._co_publico(d)), '[]') from admisiones.coordinadores where id = any(coords)),
      'citas', (select coalesce(jsonb_agg(case when x.matricula = s->>'matricula' then x.d else
                  jsonb_build_object('id', x.id, 'coordinador', x.coordinador, 'fecha', x.fecha, 'hora', x.hora,
                                     'duracion', (x.d->>'duracion')::int, 'estado', x.estado) end), '[]')
                from admisiones.citas x where x.coordinador = any(coords) and x.estado <> 'cancelada' and (x.fecha >= hoy or x.matricula = s->>'matricula')),
      'solicitantes', '[]'::jsonb));
end $$;

drop function if exists public.adm_reservar(text, text, text, date, text, text);
create or replace function public.adm_reservar(p_matricula text, p_correo text, p_telefono text,
                                               p_fecha date, p_hora text, p_modalidad text,
                                               p_whatsapp boolean default false) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s jsonb; car jsonb; co jsonb; c jsonb;
begin
  s := admisiones._prospecto(p_matricula, p_correo);
  perform pg_advisory_xact_lock(hashtext('adm:m:' || (s->>'matricula')));
  if admisiones._permiso(s) <> 'ok' then raise exception 'SIN_PERMISO'; end if;
  if exists (select 1 from admisiones.citas where matricula = s->>'matricula' and estado = 'agendada' and fecha >= admisiones._hoy())
    then raise exception 'YA_TIENE'; end if;
  car := admisiones._carrera_de(s);
  if car is null or coalesce(car->>'coordinador', '') = '' then raise exception 'SIN_COORDINADOR'; end if;
  perform pg_advisory_xact_lock(hashtext('adm:c:' || (car->>'coordinador')));
  select d into co from admisiones.coordinadores where id = car->>'coordinador';
  if not admisiones._libre(co, p_fecha, p_hora, p_modalidad, null, false) then raise exception 'OCUPADO'; end if;
  if coalesce(s->>'correo', '') = '' and coalesce(p_correo, '') <> '' then
    update admisiones.solicitantes set d = jsonb_set(d, '{correo}', to_jsonb(lower(trim(p_correo)))) where matricula = s->>'matricula';
  end if;
  c := jsonb_build_object(
    'id', admisiones._codigo(6), 'matricula', s->>'matricula',
    'correo', coalesce(nullif(s->>'correo', ''), lower(trim(coalesce(p_correo, '')))),
    'nombre', initcap(lower(s->>'nombre')), 'telefono', left(trim(coalesce(p_telefono, '')), 30),
    'carrera', car->>'id', 'coordinador', car->>'coordinador',
    'fecha', p_fecha::text, 'hora', p_hora, 'duracion', (admisiones._aj()->>'duracion')::int,
    'modalidad', p_modalidad, 'estado', 'agendada', 'resultado', '', 'nota', '',
    'whatsapp', coalesce(p_whatsapp, false),
    'creado', now(), 'historial', '[]'::jsonb);
  return admisiones._guardar_cita(admisiones._anotar(c, 'Agendó su cita', 'Prospecto'));
end $$;

create or replace function public.adm_mover_prospecto(p_matricula text, p_correo text, p_id text,
                                                      p_fecha date, p_hora text, p_modalidad text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s jsonb; c jsonb; co jsonb;
begin
  s := admisiones._prospecto(p_matricula, p_correo);
  select d into c from admisiones.citas where id = p_id and matricula = s->>'matricula' and estado = 'agendada';
  if c is null then raise exception 'No encontramos esa cita.'; end if;
  perform pg_advisory_xact_lock(hashtext('adm:c:' || (c->>'coordinador')));
  select d into co from admisiones.coordinadores where id = c->>'coordinador';
  if not admisiones._libre(co, p_fecha, p_hora, p_modalidad, p_id, false) then raise exception 'OCUPADO'; end if;
  c := admisiones._anotar(c, 'Cambió de ' || admisiones._fecha_corta((c->>'fecha')::date) || ' ' || (c->>'hora') ||
                          ' a ' || admisiones._fecha_corta(p_fecha) || ' ' || p_hora, 'Prospecto');
  -- si se mueve, el aviso anterior ya no vale: se vuelve a avisar
  c := (c - 'avisada') || jsonb_build_object('fecha', p_fecha::text, 'hora', p_hora, 'modalidad', p_modalidad, 'estado', 'agendada',
                               'duracion', (admisiones._aj()->>'duracion')::int);
  return admisiones._guardar_cita(c);
end $$;

create or replace function public.adm_cancelar_prospecto(p_matricula text, p_correo text, p_id text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s jsonb; c jsonb;
begin
  s := admisiones._prospecto(p_matricula, p_correo);
  select d into c from admisiones.citas where id = p_id and matricula = s->>'matricula' and estado = 'agendada';
  if c is null then raise exception 'No encontramos esa cita.'; end if;
  return admisiones._guardar_cita(admisiones._anotar(c, 'Canceló', 'Prospecto') || '{"estado":"cancelada"}');
end $$;

-- ══ INTERNO: coordinadores y Admisiones ═══════════════════════

create or replace function public.adm_entrar(p_usuario text, p_clave text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare u text := lower(trim(coalesce(p_usuario, ''))); rol text; quien text; nombre text; t text; exp timestamptz;
        cambiar boolean := false;
begin
  select 'admin', a.usuario, a.nombre into rol, quien, nombre from admisiones.admins a
   where a.usuario = u and a.clave = extensions.crypt(coalesce(p_clave, ''), a.clave);
  if rol is null then
    select 'coordinador', c.id, c.d->>'nombre', c.clave_temporal into rol, quien, nombre, cambiar from admisiones.coordinadores c
     where lower(c.d->>'correo') = u and c.clave is not null and coalesce((c.d->>'activo')::boolean, true)
       and c.clave = extensions.crypt(coalesce(p_clave, ''), c.clave);
  end if;
  if rol is null then perform pg_sleep(0.6); raise exception 'CLAVE'; end if;
  delete from admisiones.sesiones where expira < now();
  t := encode(extensions.gen_random_bytes(24), 'hex');
  exp := now() + interval '12 hours';
  insert into admisiones.sesiones values (t, rol, quien, nombre, exp);
  return jsonb_build_object('token', t, 'rol', rol, 'quien', quien, 'nombre', nombre, 'expira', exp, 'cambiar', coalesce(cambiar, false));
end $$;

create or replace function public.adm_salir(p_token text) returns void
language sql security definer set search_path = admisiones, public as
$$ delete from admisiones.sesiones where token = p_token $$;

create or replace function public.adm_mi_clave(p_token text, p_actual text, p_nueva text) returns void
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); n int;
begin
  if length(coalesce(p_nueva, '')) < 6 then raise exception 'La clave nueva debe tener al menos 6 caracteres.'; end if;
  if p_nueva = p_actual then raise exception 'La clave nueva tiene que ser distinta de la que te dieron.'; end if;
  if s.rol = 'admin' then
    update admisiones.admins set clave = extensions.crypt(p_nueva, extensions.gen_salt('bf'))
     where usuario = s.quien and clave = extensions.crypt(coalesce(p_actual, ''), clave);
  else
    update admisiones.coordinadores set clave = extensions.crypt(p_nueva, extensions.gen_salt('bf')), clave_temporal = false
     where id = s.quien and clave = extensions.crypt(coalesce(p_actual, ''), clave);
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'La clave actual no coincide.'; end if;
end $$;

-- Todo lo que ve una sesión. Admisiones: todo. Coordinador: sus carreras,
-- sus solicitantes y sus citas; de los demás coordinadores sólo lo público.
create or replace function public.adm_datos(p_token text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); mias text[];
begin
  mias := array(select admisiones._mis_carreras(s));
  return jsonb_build_object(
    'sesion', jsonb_build_object('rol', s.rol, 'quien', s.quien, 'nombre', s.nombre),
    'origen', (select meta->'origen' from admisiones.config where id = 1),
    'importado', (select meta->'importado' from admisiones.config where id = 1),
    'ajustes', admisiones._aj(),
    'carreras', (select coalesce(jsonb_agg(d), '[]') from admisiones.carreras),
    'coordinadores', (select coalesce(jsonb_agg(case when s.rol = 'admin' or id = s.quien
                        then d || jsonb_build_object('tieneClave', clave is not null, 'claveTemporal', clave_temporal) else admisiones._co_publico(d) end), '[]')
                      from admisiones.coordinadores),
    'solicitantes', (select coalesce(jsonb_agg(x.d), '[]') from admisiones.solicitantes x
                     where s.rol = 'admin' or admisiones._norm(x.d->>'licenciatura') in
                       (select admisiones._norm(c.d->>'nombre') from admisiones.carreras c where c.id = any(mias))),
    'citas', (select coalesce(jsonb_agg(d), '[]') from admisiones.citas where s.rol = 'admin' or coordinador = s.quien));
end $$;

create or replace function public.adm_guardar_ajustes(p_token text, p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare a jsonb;
begin
  perform admisiones._admin(p_token);
  select jsonb_object_agg(key, value) into a from jsonb_each(p_cambios)
   where key in ('duracion', 'anticipacion', 'diasAdelante', 'horaInicio', 'horaFin') and jsonb_typeof(value) = 'number';
  update admisiones.config set ajustes = ajustes || coalesce(a, '{}') where id = 1 returning ajustes into a;
  return a;
end $$;

create or replace function public.adm_guardar_carrera(p_token text, p_c jsonb) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare r jsonb;
begin
  perform admisiones._admin(p_token);
  select '{"activa":true}'::jsonb || coalesce((select d from admisiones.carreras where id = p_c->>'id'), '{}') || p_c into r;
  r := jsonb_set(r, '{nombre}', to_jsonb(trim(coalesce(r->>'nombre', ''))));
  if r->>'nombre' = '' then raise exception 'Escribe el nombre de la carrera.'; end if;
  if coalesce(r->>'id', '') = '' then r := jsonb_set(r, '{id}', to_jsonb('ca-' || admisiones._codigo(5))); end if;
  if exists (select 1 from admisiones.carreras where id <> r->>'id' and admisiones._norm(d->>'nombre') = admisiones._norm(r->>'nombre'))
    then raise exception 'Ya hay una carrera con ese nombre.'; end if;
  insert into admisiones.carreras values (r->>'id', r) on conflict (id) do update set d = excluded.d;
  return r;
end $$;

create or replace function public.adm_borrar_carrera(p_token text, p_id text) returns void
language plpgsql security definer set search_path = admisiones, public as $$
begin
  perform admisiones._admin(p_token);
  if exists (select 1 from admisiones.citas where d->>'carrera' = p_id) then
    raise exception 'Esta carrera ya tiene citas. Desactívala en vez de borrarla: deja de aparecer para los prospectos y el historial se conserva.';
  end if;
  delete from admisiones.carreras where id = p_id;
end $$;

create or replace function public.adm_guardar_coordinador(p_token text, p_c jsonb) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); c jsonb := p_c; r jsonb;
begin
  if s.rol <> 'admin' then
    if coalesce(c->>'id', '') <> s.quien then raise exception 'Sólo puedes cambiar tu propia agenda.'; end if;
    select jsonb_object_agg(key, value) into c from jsonb_each(p_c)
     where key in ('id', 'semana', 'bloqueos', 'oficina', 'liga', 'foto', 'titulo');
  end if;
  if length(coalesce(c->>'foto', '')) > 400000 then raise exception 'La foto es demasiado grande.'; end if;
  c := c - 'tieneClave' - 'claveTemporal';
  select '{"activo":true,"semana":{},"bloqueos":[],"foto":"","titulo":"","oficina":"","liga":"","correo":""}'::jsonb ||
         coalesce((select d from admisiones.coordinadores where id = c->>'id'), '{}') || c into r;
  r := jsonb_set(r, '{nombre}', to_jsonb(trim(coalesce(r->>'nombre', ''))));
  r := jsonb_set(r, '{correo}', to_jsonb(lower(trim(coalesce(r->>'correo', '')))));
  if r->>'nombre' = '' then raise exception 'Escribe el nombre del coordinador.'; end if;
  if coalesce(r->>'id', '') = '' then r := jsonb_set(r, '{id}', to_jsonb('co-' || admisiones._codigo(5))); end if;
  if r->>'correo' <> '' and exists (select 1 from admisiones.coordinadores where id <> r->>'id' and lower(d->>'correo') = r->>'correo')
    then raise exception 'Ese correo ya es de otro coordinador.'; end if;
  insert into admisiones.coordinadores (id, d) values (r->>'id', r) on conflict (id) do update set d = excluded.d;
  return r;
end $$;

create or replace function public.adm_clave_coordinador(p_token text, p_id text, p_clave text) returns void
language plpgsql security definer set search_path = admisiones, public as $$
begin
  perform admisiones._admin(p_token);
  if length(coalesce(p_clave, '')) < 6 then raise exception 'La clave debe tener al menos 6 caracteres.'; end if;
  update admisiones.coordinadores set clave = extensions.crypt(p_clave, extensions.gen_salt('bf')), clave_temporal = true where id = p_id;
  delete from admisiones.sesiones where quien = p_id;   -- la clave vieja deja de servir en todos lados
end $$;

create or replace function public.adm_borrar_coordinador(p_token text, p_id text) returns void
language plpgsql security definer set search_path = admisiones, public as $$
begin
  perform admisiones._admin(p_token);
  if exists (select 1 from admisiones.citas where coordinador = p_id) then
    raise exception 'Este coordinador ya tiene citas. Desactívalo en vez de borrarlo: el historial se conserva.';
  end if;
  delete from admisiones.coordinadores where id = p_id;
  delete from admisiones.sesiones where quien = p_id;
  update admisiones.carreras set d = jsonb_set(d, '{coordinador}', '""') where d->>'coordinador' = p_id;
end $$;

create or replace function public.adm_actualizar_cita(p_token text, p_id text, p_cambios jsonb) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); c jsonb; quien text;
begin
  select d into c from admisiones.citas where id = p_id;
  perform admisiones._puede_cita(s, c);
  quien := case when s.rol = 'admin' then 'Admisiones' else s.nombre end;
  if p_cambios ? 'estado' and p_cambios->>'estado' <> c->>'estado' then
    if p_cambios->>'estado' not in ('agendada', 'realizada', 'no_asistio') then raise exception 'Estado no válido.'; end if;
    c := admisiones._anotar(c, 'Marcó: ' || case p_cambios->>'estado' when 'agendada' then 'Agendada' when 'realizada' then 'Realizada' else 'No asistió' end, quien)
         || jsonb_build_object('estado', p_cambios->>'estado');
  end if;
  if p_cambios ? 'resultado' and p_cambios->>'resultado' <> coalesce(c->>'resultado', '') then
    if p_cambios->>'resultado' not in ('', 'admitido', 'no_admitido') then raise exception 'Resultado no válido.'; end if;
    c := admisiones._anotar(c, 'Resultado de la entrevista: ' || case p_cambios->>'resultado' when 'admitido' then 'Admitido'
           when 'no_admitido' then 'No admitido' else 'sin definir' end, quien) || jsonb_build_object('resultado', p_cambios->>'resultado');
  end if;
  if p_cambios ? 'nota' and p_cambios->>'nota' <> coalesce(c->>'nota', '') then
    c := admisiones._anotar(c, 'Editó la nota', quien) || jsonb_build_object('nota', left(p_cambios->>'nota', 4000));
  end if;
  -- «avisada»: Admisiones mandó el correo de la cita al prospecto y al coordinador
  -- avisada = true la pone (con la hora); false la quita
  if p_cambios ? 'avisada' then
    if coalesce((p_cambios->>'avisada')::boolean, false) then
      c := admisiones._anotar(c, 'Marcó la cita como avisada', quien) || jsonb_build_object('avisada', now());
    elsif c ? 'avisada' then
      c := admisiones._anotar(c, 'Quitó la marca de avisada', quien) - 'avisada';
    end if;
  end if;
  if (p_cambios ? 'correo' and p_cambios->>'correo' <> coalesce(c->>'correo', '')) or
     (p_cambios ? 'telefono' and p_cambios->>'telefono' <> coalesce(c->>'telefono', '')) then
    c := admisiones._anotar(c, 'Corrigió datos de contacto', quien) ||
         jsonb_build_object('correo', lower(trim(coalesce(p_cambios->>'correo', c->>'correo'))),
                            'telefono', left(trim(coalesce(p_cambios->>'telefono', c->>'telefono')), 30));
  end if;
  return admisiones._guardar_cita(c);
end $$;

create or replace function public.adm_mover_cita(p_token text, p_id text, p_fecha date, p_hora text, p_modalidad text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); c jsonb; co jsonb;
begin
  select d into c from admisiones.citas where id = p_id;
  perform admisiones._puede_cita(s, c);
  perform pg_advisory_xact_lock(hashtext('adm:c:' || (c->>'coordinador')));
  select d into co from admisiones.coordinadores where id = c->>'coordinador';
  if not admisiones._libre(co, p_fecha, p_hora, p_modalidad, p_id, true) then raise exception 'OCUPADO'; end if;
  c := admisiones._anotar(c, 'Cambió de ' || admisiones._fecha_corta((c->>'fecha')::date) || ' ' || (c->>'hora') ||
         ' a ' || admisiones._fecha_corta(p_fecha) || ' ' || p_hora, case when s.rol = 'admin' then 'Admisiones' else s.nombre end);
  -- si se mueve, el aviso anterior ya no vale: se vuelve a avisar
  c := (c - 'avisada') || jsonb_build_object('fecha', p_fecha::text, 'hora', p_hora, 'modalidad', p_modalidad, 'estado', 'agendada',
                               'duracion', (admisiones._aj()->>'duracion')::int);
  return admisiones._guardar_cita(c);
end $$;

create or replace function public.adm_cancelar_cita(p_token text, p_id text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); c jsonb;
begin
  select d into c from admisiones.citas where id = p_id;
  perform admisiones._puede_cita(s, c);
  c := admisiones._anotar(c, 'Canceló' || case when coalesce(p_motivo, '') <> '' then ': ' || left(p_motivo, 300) else '' end,
                          case when s.rol = 'admin' then 'Admisiones' else s.nombre end);
  return admisiones._guardar_cita(c || '{"estado":"cancelada"}');
end $$;

create or replace function public.adm_habilitar(p_token text, p_matricula text, p_si boolean) returns jsonb
language plpgsql security definer set search_path = admisiones, public as $$
declare s admisiones.sesiones := admisiones._sesion(p_token); x jsonb;
begin
  select d into x from admisiones.solicitantes where matricula = p_matricula;
  if x is null then raise exception 'No encontré esa matrícula.'; end if;
  if s.rol <> 'admin' and not exists (select 1 from admisiones.carreras c where c.d->>'coordinador' = s.quien
       and admisiones._norm(c.d->>'nombre') = admisiones._norm(x->>'licenciatura')) then
    raise exception 'Ese solicitante no es de tus licenciaturas.';
  end if;
  x := x || jsonb_build_object('habilitado', p_si, 'habilitadoPor',
         case when p_si then (case when s.rol = 'admin' then 'Admisiones' else s.nombre end) || ' · ' || to_char(admisiones._hoy(), 'DD/MM/YYYY') else '' end);
  update admisiones.solicitantes set d = x where matricula = p_matricula;
  return x;
end $$;

-- La fusión con el Excel la calcula el navegador (la misma que en modo local)
-- y aquí sólo se escribe. Los coordinadores sólo se agregan, nunca se pisan;
-- en solicitantes se respeta lo que se decidió aquí (habilitado) y el correo
-- que dio el prospecto si el Excel no lo trae.
create or replace function public.adm_importar(p_token text, p_carreras jsonb, p_coordinadores jsonb,
                                               p_solicitantes jsonb, p_meta jsonb) returns void
language plpgsql security definer set search_path = admisiones, public as $$
begin
  perform admisiones._admin(p_token);
  insert into admisiones.coordinadores (id, d)
    select x->>'id', x - 'tieneClave' - 'claveTemporal' from jsonb_array_elements(p_coordinadores) x
    on conflict (id) do nothing;
  insert into admisiones.carreras (id, d)
    select x->>'id', x from jsonb_array_elements(p_carreras) x
    on conflict (id) do update set d = excluded.d;
  insert into admisiones.solicitantes (matricula, d)
    select x->>'matricula', x from jsonb_array_elements(p_solicitantes) x
    on conflict (matricula) do update set d = excluded.d || jsonb_build_object(
      'habilitado', coalesce(admisiones.solicitantes.d->'habilitado', excluded.d->'habilitado', 'false'),
      'habilitadoPor', coalesce(admisiones.solicitantes.d->'habilitadoPor', excluded.d->'habilitadoPor', '""'),
      'correo', case when coalesce(excluded.d->>'correo', '') = '' then coalesce(admisiones.solicitantes.d->'correo', '""') else excluded.d->'correo' end);
  update admisiones.config set meta = meta || p_meta where id = 1;
end $$;

-- Sólo anon y authenticated pueden llamar a las públicas; nada más del esquema.
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'adm\_%' loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'admisiones' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
