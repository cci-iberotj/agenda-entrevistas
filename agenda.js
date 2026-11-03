/* ═══════════════════════════════════════════════════════════
   Agenda · fechas, horarios libres y utilidades compartidas

   Todo lo que las tres vistas calculan igual: qué horarios ofrece
   un coordinador en una fecha, cómo se escribe una fecha, el
   archivo .ics para el calendario del prospecto y los avisos.
   Las fechas viajan como texto 'AAAA-MM-DD' en hora local de
   Tijuana, nunca como Date, para que no se corran de día.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Agenda = (() => {
  const CLAVES = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const DIAS   = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES  = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const SEMANA = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const CELDA = 30;   // minutos por celda en la semana del coordinador

  const ESTADOS = { agendada: 'Agendada', realizada: 'Realizada', no_asistio: 'No asistió', cancelada: 'Cancelada' };
  const MODALIDADES = { presencial: 'Presencial', linea: 'En línea' };
  const TIPOS = { a: ['presencial', 'linea'], p: ['presencial'], l: ['linea'] };

  const dos = n => String(n).padStart(2, '0');
  const aISO = f => f.getFullYear() + '-' + dos(f.getMonth() + 1) + '-' + dos(f.getDate());
  function aFecha(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  const hoy = () => aISO(new Date());
  function sumar(iso, n) { const f = aFecha(iso); f.setDate(f.getDate() + n); return aISO(f); }
  const clave = iso => CLAVES[aFecha(iso).getDay()];
  const aMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const aHora = min => dos(Math.floor(min / 60)) + ':' + dos(min % 60);
  const mayus = t => t.charAt(0).toUpperCase() + t.slice(1);

  /* «martes 4 de noviembre» */
  function fechaLarga(iso) {
    const f = aFecha(iso);
    return DIAS[f.getDay()] + ' ' + f.getDate() + ' de ' + MESES[f.getMonth()];
  }
  /* «mar 4 nov» */
  function fechaCorta(iso) {
    const f = aFecha(iso);
    return DIAS[f.getDay()].slice(0, 3) + ' ' + f.getDate() + ' ' + MESES[f.getMonth()].slice(0, 3);
  }
  /* «9:20 a. m.»: así se lee en México */
  function horaBonita(hhmm) {
    let [h, m] = hhmm.split(':').map(Number);
    const sufijo = h < 12 ? 'a. m.' : 'p. m.';
    h = h % 12 || 12;
    return h + ':' + dos(m) + ' ' + sufijo;
  }
  function horaFin(hhmm, dur) { return aHora(aMin(hhmm) + dur); }

  /* ── Horarios libres ─────────────────────────────────────
     Se recorren los tramos pintados del día de corrido y se cortan
     en piezas de la duración de la entrevista. Una pieza que cae en
     dos celdas ofrece sólo las modalidades que tienen las dos.
     Luego se quitan las ocupadas, las bloqueadas y las que no
     cumplen la anticipación. */
  function espacios(co, fecha, datos, op = {}) {
    const aj = datos.ajustes;
    const dur = aj.duracion;
    const dia = (co.semana || {})[clave(fecha)] || {};
    const celdas = Object.keys(dia).map(aMin).sort((a, b) => a - b);
    if (!celdas.length) return [];

    const bloqueos = (co.bloqueos || []).filter(b => b.fecha === fecha);
    if (bloqueos.some(b => !b.desde)) return [];

    const ocupadas = datos.citas.filter(c => c.coordinador === co.id && c.fecha === fecha &&
      c.estado !== 'cancelada' && c.id !== op.ignorar);

    /* sinAnticipacion: desde dentro se puede agendar para dentro de
       una hora, pero nunca en el pasado. todo: sin límite (sólo para
       sembrar los datos de ejemplo, que también tienen pasado). */
    const limite = op.todo ? null
      : new Date(Date.now() + (op.sinAnticipacion ? 0 : aj.anticipacion * 3600e3));
    const salida = [];

    /* tramos de celdas seguidas */
    const tramos = [];
    celdas.forEach(m => {
      const t = tramos[tramos.length - 1];
      if (t && t.fin === m) t.fin = m + CELDA; else tramos.push({ ini: m, fin: m + CELDA });
    });

    tramos.forEach(t => {
      for (let m = t.ini; m + dur <= t.fin; m += dur) {
        let mods = ['presencial', 'linea'];
        for (let c = Math.floor(m / CELDA) * CELDA; c < m + dur; c += CELDA) {
          const tipo = TIPOS[dia[aHora(c)]] || [];
          mods = mods.filter(x => tipo.includes(x));
        }
        if (!mods.length) continue;
        const choca = (a, b) => m < b && a < m + dur;
        if (ocupadas.some(c => choca(aMin(c.hora), aMin(c.hora) + (c.duracion || dur)))) continue;
        if (bloqueos.some(b => choca(aMin(b.desde), aMin(b.hasta)))) continue;
        if (limite) {
          const f = aFecha(fecha); f.setMinutes(m);
          if (f < limite) continue;
        }
        salida.push({ hora: aHora(m), modalidades: mods });
      }
    });
    return salida;
  }

  /* Todos los días visibles de un coordinador: [{ fecha, espacios }] */
  function proximos(co, datos, op = {}) {
    const dias = op.dias || datos.ajustes.diasAdelante;
    const desde = op.desde || hoy();
    const lista = [];
    for (let i = 0; i < dias; i++) {
      const f = sumar(desde, i);
      if (clave(f) === 'dom') continue;
      let e = espacios(co, f, datos, op);
      if (op.modalidad) e = e.filter(x => x.modalidades.includes(op.modalidad));
      lista.push({ fecha: f, espacios: e });
    }
    return lista;
  }

  /* ── Archivo para el calendario del prospecto ────────── */
  function ics(cita, co, carrera) {
    const sello = (fecha, hhmm) => fecha.replace(/-/g, '') + 'T' + hhmm.replace(':', '') + '00';
    const lugar = cita.modalidad === 'linea' ? (co.liga || 'En línea') : (co.oficina || 'IBERO Tijuana');
    const limpiar = t => String(t || '').replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const texto = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IBERO Tijuana//Agenda de entrevistas//ES',
      'BEGIN:VEVENT',
      'UID:' + cita.id + '@agenda.tijuana.ibero.mx',
      'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART;TZID=America/Tijuana:' + sello(cita.fecha, cita.hora),
      'DTEND;TZID=America/Tijuana:' + sello(cita.fecha, horaFin(cita.hora, cita.duracion)),
      'SUMMARY:' + limpiar('Entrevista de admisión · ' + carrera.nombre),
      'LOCATION:' + limpiar(lugar),
      'DESCRIPTION:' + limpiar('Con ' + nombreCompleto(co) + '.\n' +
        (cita.modalidad === 'linea' ? 'Entra a la liga 5 minutos antes.' : 'Llega 10 minutos antes.') +
        '\nNúmero de cita: ' + cita.id),
      'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Tu entrevista es en una hora', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    return new Blob([texto], { type: 'text/calendar;charset=utf-8' });
  }

  function nombreCompleto(co) { return co ? ((co.titulo ? co.titulo + ' ' : '') + co.nombre) : 'Por asignar'; }

  /* ── Nombres como los escribe Admisiones ───────────────────
     El Excel trae «FRANCO PEREZ JULIAN ALEXANDER»: apellidos primero
     y en mayúsculas. Se pasa a «Franco Perez Julian Alexander» y,
     para saludar, se separan los nombres de pila. Se supone que los
     dos primeros bloques son apellidos. Las partículas («de la»,
     «de los») unen la palabra de antes con la de después
     («Espinosa de los Monteros»); al principio, sólo a la de después
     («de la Torre»). */
  const PARTICULAS = /^(de|del|la|las|los|y|van|von|da|di)$/i;
  function titulo(t) {
    return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
      .split(' ').map(p => PARTICULAS.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
      .replace(/^./, c => c.toUpperCase());
  }
  function bloques(t) {
    const out = [];
    let pend = '';
    titulo(t).split(' ').forEach(p => {
      if (PARTICULAS.test(p)) { pend += p + ' '; return; }
      if (pend && out.length) out[out.length - 1] += ' ' + pend + p;
      else out.push(pend + p);
      pend = '';
    });
    if (pend) out.push(pend.trim());
    return out;
  }
  /* «Caballero Solano Victor Manuel» → «Victor Manuel Caballero Solano» */
  function nombreNatural(apellidosPrimero) {
    const b = bloques(apellidosPrimero);
    return b.length >= 3 ? b.slice(2).concat(b.slice(0, 2)).join(' ') : b.join(' ');
  }
  /* «Franco Perez Julian Alexander» → «Julian». Con partículas no se
     adivina: en el Excel real hay apellidos compuestos que no se
     pueden partir con certeza, y saludar con un apellido es peor que
     no poner nombre. Ahí devuelve '' y se saluda sin nombre. */
  function pila(apellidosPrimero) {
    if (titulo(apellidosPrimero).split(' ').some(p => PARTICULAS.test(p))) return '';
    const b = bloques(apellidosPrimero);
    return b.length >= 3 ? b[2] : '';
  }
  const saludo = nombre => pila(nombre) ? 'Hola, ' + pila(nombre) : 'Hola';

  /* ── ¿Puede agendar? ───────────────────────────────────────
     La regla del Excel: «Por agendar entrevista» = Aprobado o Pase
     directo. «A consideración» lo decide el coordinador: sólo pasa
     si alguien lo habilitó. */
  function permiso(s) {
    if (!s) return 'no_existe';
    if (s.fuera) return 'fuera';
    const r = String(s.resultado || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (r.startsWith('aprobado') || r.startsWith('pase directo')) return 'ok';
    if (r.startsWith('a consideracion')) return s.habilitado ? 'ok' : 'consideracion';
    if (r.startsWith('no aprobado')) return 'no_aprobado';
    return 'pendiente';
  }

  return {
    SEMANA, CELDA, ESTADOS, MODALIDADES, TIPOS, DIAS,
    RESULTADOS: { admitido: 'Admitido', no_admitido: 'No admitido' },
    hoy, sumar, clave, aMin, aHora, aFecha, mayus,
    fechaLarga, fechaCorta, horaBonita, horaFin,
    espacios, proximos, ics, nombreCompleto, titulo, nombreNatural, pila, saludo, permiso,
    nombreDia: k => DIAS[CLAVES.indexOf(k)],
  };
})();

/* ── Utilidades de pantalla ──────────────────────────────── */
const UI = (() => {
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function iniciales(nombre) {
    return String(nombre || '?').split(/\s+/).filter(p => p && !/^(de|del|la|los|y)$/i.test(p))
      .slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }

  /* Foto del coordinador o, si no hay, sus iniciales sobre rojo. */
  function avatar(co, tam = 56) {
    const st = 'width:' + tam + 'px;height:' + tam + 'px;font-size:' + Math.round(tam * .36) + 'px';
    if (co && co.foto) return '<span class="avatar" style="' + st + '"><img src="' + co.foto + '" alt=""></span>';
    return '<span class="avatar" style="' + st + '">' + esc(iniciales(co ? co.nombre : '?')) + '</span>';
  }

  let tAviso;
  function aviso(texto, tipo = '') {
    let el = document.getElementById('aviso');
    if (!el) { el = document.createElement('div'); el.id = 'aviso'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'aviso visible ' + tipo;
    el.textContent = texto;
    clearTimeout(tAviso);
    tAviso = setTimeout(() => el.classList.remove('visible'), 3200);
  }

  /* Ventana modal sencilla. Devuelve el elemento para llenarlo. */
  function ventana(titulo, html, op = {}) {
    cerrarVentana();
    const fondo = document.createElement('div');
    fondo.className = 'velo';
    fondo.innerHTML = '<div class="ventana' + (op.ancha ? ' ancha' : '') + '" role="dialog" aria-modal="true">' +
      '<header><h2>' + esc(titulo) + '</h2><button class="cerrar" aria-label="Cerrar">×</button></header>' +
      '<div class="cuerpo">' + html + '</div></div>';
    fondo.addEventListener('click', e => { if (e.target === fondo || e.target.closest('.cerrar')) cerrarVentana(); });
    document.body.appendChild(fondo);
    document.body.classList.add('con-ventana');
    const f = fondo.querySelector('input, select, textarea');
    if (f && !op.sinFoco) setTimeout(() => f.focus(), 30);
    return fondo.querySelector('.ventana');
  }
  function cerrarVentana() {
    document.querySelectorAll('.velo').forEach(v => v.remove());
    document.body.classList.remove('con-ventana');
  }
  addEventListener('keydown', e => { if (e.key === 'Escape') cerrarVentana(); });

  function descargar(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function etiquetaPrueba() {
    if (!CONFIG.modoPrueba) return;
    const e = document.createElement('div');
    e.className = 'modo-prueba';
    e.textContent = 'MODO PRUEBA · datos de ejemplo';
    document.body.appendChild(e);
  }

  /* Reduce una foto a 320 px y la guarda como JPEG dentro del dato. */
  function leerFoto(archivo) {
    return new Promise((ok, mal) => {
      const img = new Image();
      img.onload = () => {
        const lado = 320, c = document.createElement('canvas');
        c.width = c.height = lado;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2 * .6, s, s, 0, 0, lado, lado);
        URL.revokeObjectURL(img.src);
        ok(c.toDataURL('image/jpeg', .85));
      };
      img.onerror = () => mal(new Error('No pude leer esa imagen.'));
      img.src = URL.createObjectURL(archivo);
    });
  }

  /* Abre un mailto: (o cualquier liga) como si se hubiera hecho clic */
  function abrir(url) {
    const a = document.createElement('a');
    a.href = url;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return { esc, iniciales, avatar, aviso, ventana, cerrarVentana, descargar, etiquetaPrueba, leerFoto, abrir };
})();
