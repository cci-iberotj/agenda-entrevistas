# Agenda de entrevistas · Admisiones IBERO Tijuana

Plataforma para que los prospectos agenden su entrevista con quien coordina su
carrera, los coordinadores mantengan su disponibilidad al día y Admisiones
(Marysol) vea y administre todo.

**Publicada (2-nov-2026):** <https://cci-iberotj.github.io/agenda-entrevistas/>

| Vista | Dirección | Quién entra |
|---|---|---|
| Prospecto | `/` | Público: matrícula + correo |
| Coordinador | `/coordinador.html` | Su correo + la clave que le da Admisiones |
| Admin | `/admin.html` | Usuario `admisiones` + clave (en `datos/claves.txt`, fuera del repo) |

## Dónde viven los datos

En la base de **LA PIZARRA** (proyecto `wrezcukptrtmnhnlxmao`), en el esquema
propio **`admisiones`** — decisión de Leo del 2-nov-2026 para no ocupar el
segundo lugar gratuito de Supabase. Ver `supabase/esquema.sql`.

- Las tablas **no se ven** desde la página: el esquema no está expuesto y tiene
  RLS sin políticas. Todo pasa por funciones `public.adm_*` que revisan quién
  pregunta (matrícula + correo, o la sesión de `adm_entrar`).
- Coordinadores y Admisiones **no** son usuarios de LA PIZARRA: tienen claves
  propias de la agenda (bcrypt), sesiones de 12 h.
- El candado de «dos personas, mismo horario» está en la base
  (`pg_advisory_xact_lock` por coordinador) y la base vuelve a revisar
  horario pintado, modalidad, bloqueos, anticipación y días hacia adelante.

Herramientas:

    python supabase/correr.py supabase/esquema.sql --si-borra   # (re)crear funciones
    python supabase/correr.py "select count(*) from admisiones.citas"
    python publicar.py "qué cambió"                           # versión + commit + empujar

`correr.py` usa el token de cuenta que vive en `LA PIZARRA/datos/`.
`config.js → motor: 'local'` + `modoPrueba: true` vuelve al prototipo con datos
de ejemplo (no toca la base).

## Probar en local

Doble clic en `ABRIR.bat` → <http://localhost:8794/> (usa la misma base que lo
publicado, salvo que se cambie el motor a 'local').

## El Excel de Admisiones

`Resultados_Admision_IBERO_Tijuana_2027.xlsx`, el archivo de control que
Admisiones comparte con las coordinaciones. En el Admin → *Prospectos* se
arrastra o se elige. Se leen:

- **Especificaciones** → la tabla «Criterios por licenciatura»: licenciatura y
  coordinador(a). Los nombres vienen apellidos primero y se voltean
  («Caballero Solano Victor Manuel» → «Victor Manuel Caballero Solano»).
- **Base Primavera 2027, Base Otoño 2027** (cualquier hoja «Base …») → un
  solicitante por renglón: matrícula, nombre, licenciatura, resultado del
  examen, validación de promedio, observaciones y correo.

Las columnas se buscan por su título, no por su posición. Volver a cargarlo
actualiza a quien ya estaba, agrega a los nuevos y marca como «fuera» (sin
borrar) a quien ya no viene. Se conservan horarios, oficinas, ligas, fotos,
títulos y los permisos dados a los de «A consideración».

**Quién puede agendar** (la regla del propio Excel para «Por agendar entrevista»):
Aprobado o Pase directo. «A consideración del coordinador» sólo si el
coordinador (o Admisiones) toca «Lo entrevisto». Pendiente y No aprobado ven un
aviso y no agendan.

## Lo que hace cada vista

**Prospecto.** Matrícula + correo → la plataforma ya sabe su licenciatura y su
coordinador → presencial o en línea → día y hora → celular → boleto con
Google Calendar e iPhone/Outlook (.ics). Si ya tiene cita, al entrar la ve y
puede cambiarla o cancelarla. Una matrícula sólo puede tener una cita vigente.
El saludo usa el nombre de pila; con apellidos compuestos («de los…») saluda
sin nombre para no equivocarse.

**Coordinador.** *Mis citas* con filtros: próximas, por marcar, **sin agendar**
(aprobados de su licenciatura que no han agendado), **a consideración** (con
el botón para dejarlos agendar) y pasadas. La ficha de cada cita trae el
resultado del examen, la escuela y las observaciones de Admisiones, y se marca
asistencia y **resultado de la entrevista: Admitido / No admitido**, como en el
Excel. *Mi semana* (bloquear horarios o días) y *Mi horario* (semana tipo en
rejilla de media hora; oficina, liga y foto).

**Admin.** *Tablero* por licenciatura, como el Tablero del Excel
(solicitantes, por agendar, agendadas, admitidos, no admitidos, horarios
libres en 7 días), filtrable por ciclo; en rojo las licenciaturas con gente
esperando y sin horarios. *Prospectos* (cargar el Excel; lista con la
situación de cada quien). *Citas* (búsqueda, filtros, ficha; **Descargar para
Excel** con las columnas del archivo de Admisiones: Matrícula, Fecha de
entrevista, Resultado entrevista, Comentarios del coordinador…). *Carreras y
coordinadores*. *Ajustes* (duración, anticipación, días visibles, horario de
la rejilla, reiniciar el prototipo).

## Reglas que ya están en el código

- Duración 20 min y anticipación 24 h (ajustables en Admin).
- Antes de guardar se vuelve a revisar que el horario siga libre: si dos
  personas eligen lo mismo, sólo pasa la primera.
- Desde dentro se puede mover una cita sin la anticipación, nunca al pasado.
- Carrera o coordinador con citas no se borra: se desactiva.
- No se manda correo: el boleto y el calendario son la confirmación.

## Archivos

| Archivo | Qué es |
|---|---|
| `config.js` | Modo prueba, motor, valores iniciales de ajustes, contacto, departamentos |
| `almacen.js` | Única puerta a los datos (hoy motor `local`); identificar, reservar, importar |
| `importar.js` | Lee el Excel de Admisiones (con `xlsx.full.min.js`, SheetJS 0.18.5) |
| `agenda.js` | Fechas, horarios libres, .ics, nombres, regla de quién puede agendar |
| `ejemplo.js` | Licenciaturas como en el Excel; coordinadores, solicitantes y matrículas INVENTADOS |
| `interno.js` | Ficha de cita, mover, tablas; compartido por coordinador y Admin |
| `prospecto.js`, `coordinador.js`, `admin.js` | Cada vista |
| `estilos.css`, `tipografia.css` | Paleta de LA PIZARRA (prospecto con rojo vivo) y Alverata + Myriad empotradas |

## Pendiente

1. Que Admisiones capture el **correo** de cada coordinador (Admin → Carreras y
   coordinadores → Editar; el Excel no los trae) y luego toque **«Dar acceso»**:
   genera una **clave temporal** para cada uno y su mensaje listo. Al entrar la
   primera vez, la agenda les pide poner una clave propia (`clave_temporal`).
2. Que cada coordinador **pinte su horario** (o Admisiones por él, con «Abrir su agenda»).
3. Volver a cargar el Excel cada vez que Admisiones lo actualice.
4. Sin probar: el .ics en un iPhone real.
