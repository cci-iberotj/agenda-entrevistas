# Agenda de entrevistas · Admisiones IBERO Tijuana

Plataforma para que los prospectos agenden su entrevista con quien coordina su
carrera, los coordinadores mantengan su disponibilidad al día y Admisiones
(Marysol) vea y administre todo.

**Estado: prototipo (2-nov-2026).** Todo vive en el navegador de quien lo abre
(`localStorage`). Arranca con datos de ejemplo; en cuanto se carga el Excel de
Admisiones desde el Admin, trabaja con los datos reales **sólo en ese navegador**.
Los datos reales nunca se guardan en los archivos del proyecto.

## Cómo se abre

Doble clic en `ABRIR.bat` → <http://localhost:8794/>

| Vista | Dirección | Para quién |
|---|---|---|
| Prospecto | `/` (index.html) | Público, pensada para celular |
| Coordinador | `/coordinador.html` | Los 9 coordinadores (11 licenciaturas) |
| Admin | `/admin.html` | Marysol |

Las tres comparten los datos si se abren en el mismo navegador.

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

## Pendiente para salir de prototipo

1. **Base compartida:** Supabase propio de Admisiones (separado de LA PIZARRA).
   El público no lee la lista de solicitantes: una función recibe matrícula +
   correo y contesta sólo lo de esa persona; otra aparta revalidando el horario.
2. **Entrada de coordinadores y Marysol** con su correo IBERO.
3. **Correos de los coordinadores** (el Excel no los trae) y sus horarios.
4. Publicar en `cci-iberotj.github.io` con `modoPrueba: false`.
