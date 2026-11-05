/* ═══════════════════════════════════════════════════════════
   Agenda de entrevistas · Admisiones IBERO Tijuana

   Lo que va fijo en el código vive aquí. Lo que Marysol ajusta
   desde su Admin (duración, anticipación, carreras, coordinadores)
   se guarda en el almacén; los valores de abajo sólo son el punto
   de partida la primera vez.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const CONFIG = {

  version: '1.8',

  /* ── Modo prueba ───────────────────────────────────────
     true  → carga carreras, coordinadores y citas de ejemplo,
             deja entrar como cualquier coordinador sin contraseña
             y muestra la etiqueta «MODO PRUEBA» abajo a la derecha.
     false → la plataforma de verdad. */
  modoPrueba: false,

  /* ── Dónde se guarda todo ──────────────────────────────
     'nube'  → la base de LA PIZARRA, esquema «admisiones»
               (supabase/esquema.sql). Es la de verdad.
     'local' → en el navegador de esta computadora, con datos de
               ejemplo si modoPrueba es true. Para enseñar o probar
               sin tocar la base. */
  motor: 'nube',

  nube: {
    /* La llave publicable está hecha para vivir en el navegador: lo
       que protege los datos es que las tablas no se ven y cada
       función adm_* revisa quién pregunta. */
    url:   'https://wrezcukptrtmnhnlxmao.supabase.co',
    llave: 'sb_publishable_XTkkarWw-P3Ls31g5ZDTOA_ZghkWshN',
  },

  /* ── Valores iniciales de los ajustes ────────────────── */
  ajustes: {
    duracion: 20,          // minutos por entrevista
    anticipacion: 24,      // horas mínimas antes de la cita
    diasAdelante: 21,      // cuántos días hacia adelante se pueden ver
    horaInicio: 8,         // primera hora de la rejilla del coordinador
    horaFin: 20,           // última hora (no incluida)
  },

  /* ── Contacto que ve el prospecto si algo falla ──────── */
  contacto: {
    area: 'Admisiones',
    correo: 'admisiones@tijuana.ibero.mx',
    sitio: 'tijuana.ibero.mx',
  },

  /* Los tres departamentos de la Dirección Académica, como los
     nombra el organigrama oficial 2026. */
  departamentos: [
    'Ingenierías y Arquitectura',
    'Ciencias Sociales y Negocios',
    'Ciencias de la Salud',
  ],
};
