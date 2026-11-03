/* ═══════════════════════════════════════════════════════════
   Vista del prospecto · tus datos → horario → confirmar → listo

   Se identifica con matrícula + correo contra la lista que
   Admisiones carga desde su Excel. Con eso ya sabemos su carrera y
   su coordinador; no elige nada que podamos saber nosotros. Si ya
   tiene cita, la ve y puede cambiarla o cancelarla. Cambiar reusa el
   paso de horario (estado.mover) y se salta el de confirmar.
   ═══════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const { esc } = UI;

  const ICONO = {
    presencial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    linea: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg>',
    palomita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  const correoAdm = () => '<a href="mailto:' + esc(CONFIG.contacto.correo) + '">' + esc(CONFIG.contacto.correo) + '</a>';

  let datos;
  const estado = { yo: null, correo: '', carrera: null, co: null, modalidad: null, fecha: null, hora: null, mover: null };

  /* ── Pasos ─────────────────────────────────────────────── */
  const ORDEN = ['tu', 'horario', 'confirmar', 'listo', 'aviso'];
  function ir(paso) {
    ORDEN.forEach(p => $('#paso-' + p).classList.toggle('oculto', p !== paso));
    const i = ['tu', 'horario', 'confirmar'].indexOf(paso);
    document.querySelectorAll('#pasos li').forEach((li, k) => {
      li.classList.toggle('activo', k === i);
      li.classList.toggle('hecho', i < 0 || k < i);
    });
    $('#pasos').classList.toggle('oculto', i < 0 || !!estado.mover);
    /* los pasos se esconden en «listo», «aviso» y al mover: ahí se sube al título del paso */
    const ancla = $('#pasos').classList.contains('oculto') ? $('#paso-' + paso) : $('#pasos');
    if (paso !== 'tu') ancla.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── 1 · Quién eres ────────────────────────────────────── */
  function marcar(form, malos) {
    form.querySelectorAll('.campo').forEach(c => c.classList.toggle('error', malos.includes(c.dataset.campo)));
    if (malos.length) form.elements[malos[0]].focus();
    return !malos.length;
  }
  function errorTu(html) {
    const e = $('#error-tu');
    e.innerHTML = html || '';
    e.classList.toggle('oculto', !html);
  }
  $('#form-tu').addEventListener('input', e => { const c = e.target.closest('.campo'); if (c) c.classList.remove('error'); errorTu(''); });
  $('#form-tu').addEventListener('submit', async e => {
    e.preventDefault();
    const f = $('#form-tu').elements;
    const malos = [];
    if (f.matricula.value.trim().length < 5) malos.push('matricula');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.correo.value.trim())) malos.push('correo');
    if (!marcar($('#form-tu'), malos)) return;
    try {
      const r = await Almacen.identificar(f.matricula.value, f.correo.value);
      datos = r.datos;
      estado.correo = f.correo.value.trim().toLowerCase();
      entrar(r);
    } catch (err) {
      if (err.message === 'NO_EXISTE')
        errorTu('No encontramos esa matrícula. Revísala en el correo que te mandó Admisiones o escríbenos a ' + correoAdm() + '.');
      else if (err.message === 'CORREO')
        errorTu('Esa matrícula está registrada con otro correo. Usa el que diste al inscribirte al proceso; si ya no lo tienes, escríbenos a ' + correoAdm() + '.');
      else errorTu(esc(err.message));
    }
  });

  function entrar(r) {
    estado.yo = r.s;
    estado.mover = null;
    const hola = esc(Agenda.saludo(r.s.nombre));
    if (r.vigente) return mostrarListo(r.vigente, 'tuya');
    if (r.cita && r.cita.estado === 'realizada') return mostrarListo(r.cita, 'tuya');
    const avisos = {
      pendiente: ['Todavía no tenemos tu resultado', 'En cuanto Admisiones registre el resultado de tu examen, vuelve aquí y agenda tu entrevista.'],
      consideracion: ['Tu coordinador está revisando tu caso', 'Si decide entrevistarte, te avisamos y aquí mismo podrás escoger tu horario.'],
      no_aprobado: ['Por ahora no hay entrevista', 'Para agendarla primero necesitas aprobar el examen. Admisiones te va a contactar para tu segunda oportunidad.'],
      fuera: ['Tu registro no está activo', 'Escríbenos a ' + correoAdm() + ' y lo revisamos contigo.'],
    };
    if (r.permiso !== 'ok') return mostrarAviso(hola, ...(avisos[r.permiso] || avisos.fuera));
    const co = r.carrera && datos.coordinadores.find(c => c.id === r.carrera.coordinador && c.activo);
    if (!co) return mostrarAviso(hola, 'Todavía no hay horarios para ' + esc(r.s.licenciatura || 'tu carrera'),
      'Escríbenos a ' + correoAdm() + ' y te buscamos un espacio.');
    estado.carrera = r.carrera; estado.co = co;
    estado.fecha = estado.hora = estado.modalidad = null;
    pintarHorario();
    ir('horario');
  }

  function mostrarAviso(hola, titulo, texto) {
    $('#paso-aviso').innerHTML = '<div class="tarjeta boleto"><div class="cuando" style="padding-top:28px">' +
      '<span>' + hola + '</span><b style="margin-top:6px">' + titulo + '</b></div>' +
      '<p class="consejo" style="margin:14px 24px 0">' + texto + '</p>' +
      '<div class="acciones"><button class="btn" id="otra-matricula">Usar otra matrícula</button></div></div>';
    $('#otra-matricula').onclick = () => ir('tu');
    ir('aviso');
  }

  if (CONFIG.modoPrueba) {
    $('#usar-ejemplo').classList.remove('oculto');
    $('#usar-ejemplo').addEventListener('click', () => {
      const hoy = Agenda.hoy();
      const libre = datos.solicitantes.find(s => Agenda.permiso(s) === 'ok' && s.correo &&
        !datos.citas.some(c => c.matricula === s.matricula && (c.estado === 'realizada' || (c.estado === 'agendada' && c.fecha >= hoy))) &&
        datos.carreras.some(c => Importar.norm(c.nombre) === Importar.norm(s.licenciatura) && c.coordinador));
      if (!libre) return UI.aviso('No quedan prospectos de ejemplo sin cita.', 'error');
      const f = $('#form-tu').elements;
      f.matricula.value = libre.matricula; f.correo.value = libre.correo;
      errorTu('');
    });
  }

  /* ── 2 · Horario ───────────────────────────────────────── */
  function pintarHorario() {
    const { co, carrera, yo } = estado;
    $('#titulo-horario').textContent = estado.mover ? 'Escoge tu nuevo horario'
      : Agenda.saludo(yo.nombre) + ': escoge tu horario';
    $('#atras-horario').textContent = estado.mover ? '← No cambiar' : '← Volver';
    $('#quien').innerHTML = UI.avatar(co, 60) +
      '<div><span class="cargo">Tu entrevista de ' + esc(carrera.nombre) + ' es con</span>' +
      '<b>' + esc(Agenda.nombreCompleto(co)) + '</b></div>';

    const sinNada = '<div class="vacio"><b>Por ahora no hay horarios abiertos para ' + esc(carrera.nombre) + '.</b>' +
      'Vuelve a revisar más tarde o escríbenos a ' + correoAdm() + '.</div>';
    const ignorar = estado.mover && estado.mover.id;
    const todos = Agenda.proximos(co, datos, { ignorar });
    const mods = ['presencial', 'linea'].filter(m => todos.some(d => d.espacios.some(e => e.modalidades.includes(m))));
    if (!mods.length) {
      $('#caja-modalidad').innerHTML = ''; $('#dias').innerHTML = ''; $('#horas').innerHTML = sinNada;
      $('#seguir-horario').disabled = true;
      return;
    }
    if (!mods.includes(estado.modalidad)) estado.modalidad = mods[0];
    $('#caja-modalidad').innerHTML = '<div class="selector" role="radiogroup" aria-label="Modalidad">' +
      ['presencial', 'linea'].map(m => '<button role="radio" data-mod="' + m + '"' +
        (mods.includes(m) ? '' : ' disabled title="Sin horarios en esta modalidad"') +
        ' class="' + (estado.modalidad === m ? 'activo' : '') + '" aria-checked="' + (estado.modalidad === m) + '">' +
        ICONO[m] + Agenda.MODALIDADES[m] + '</button>').join('') + '</div>';

    const dias = Agenda.proximos(co, datos, { modalidad: estado.modalidad, ignorar });
    if (!estado.fecha || !dias.some(d => d.fecha === estado.fecha && d.espacios.length)) {
      const primero = dias.find(d => d.espacios.length);
      estado.fecha = primero ? primero.fecha : null;
      estado.hora = null;
    }
    $('#dias').innerHTML = dias.map(d => {
      const n = d.espacios.length, partes = Agenda.fechaCorta(d.fecha).split(' ');
      return '<button class="dia' + (d.fecha === estado.fecha ? ' activo' : '') + '" data-fecha="' + d.fecha + '"' +
        (n ? '' : ' disabled') + ' role="option" aria-selected="' + (d.fecha === estado.fecha) + '">' +
        '<small>' + partes[0] + '</small><b>' + partes[1] + '</b><small>' + partes[2] + '</small>' +
        '<span class="cuantos">' + (n ? n + (n === 1 ? ' libre' : ' libres') : '—') + '</span></button>';
    }).join('');

    const elegido = dias.find(d => d.fecha === estado.fecha);
    $('#horas').innerHTML = elegido ? elegido.espacios.map(e =>
      '<button class="hora' + (e.hora === estado.hora ? ' activo' : '') + '" data-hora="' + e.hora + '">' +
      Agenda.horaBonita(e.hora) + '</button>').join('') : '';
    $('#seguir-horario').disabled = !estado.hora;
    $('#seguir-horario').textContent = estado.mover ? 'Cambiar a este horario' : 'Seguir';
    const activo = $('#dias .dia.activo');
    if (activo) activo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  $('#caja-modalidad').addEventListener('click', e => {
    const b = e.target.closest('[data-mod]');
    if (!b || b.disabled) return;
    estado.modalidad = b.dataset.mod; estado.hora = null;
    pintarHorario();
  });
  $('#dias').addEventListener('click', e => {
    const b = e.target.closest('.dia');
    if (!b || b.disabled) return;
    estado.fecha = b.dataset.fecha; estado.hora = null;
    pintarHorario();
  });
  $('#horas').addEventListener('click', e => {
    const b = e.target.closest('.hora');
    if (!b) return;
    estado.hora = b.dataset.hora;
    document.querySelectorAll('.hora').forEach(x => x.classList.toggle('activo', x === b));
    $('#seguir-horario').disabled = false;
  });
  $('#atras-horario').addEventListener('click', () => {
    if (estado.mover) { const c = estado.mover; estado.mover = null; mostrarListo(c, 'tuya'); return; }
    ir('tu');
  });
  $('#seguir-horario').addEventListener('click', () => {
    if (!estado.hora) return;
    if (estado.mover) return mover();
    const { yo, co, carrera } = estado;
    $('#resumen').innerHTML = UI.avatar(co, 44) + '<div><b>' + esc(Agenda.mayus(Agenda.fechaLarga(estado.fecha))) +
      ', ' + Agenda.horaBonita(estado.hora) + '</b><span class="meta">' + Agenda.MODALIDADES[estado.modalidad] +
      ' · ' + esc(Agenda.nombreCompleto(co)) + '</span></div>';
    $('#ficha-tu').innerHTML = '<dt>Nombre</dt><dd>' + esc(Agenda.titulo(yo.nombre)) + '</dd>' +
      '<dt>Matrícula</dt><dd>' + esc(yo.matricula) + '</dd>' +
      '<dt>Carrera</dt><dd>' + esc(carrera.nombre) + '</dd>' +
      '<dt>Correo</dt><dd>' + esc(yo.correo || estado.correo) + '</dd>';
    ir('confirmar');
    setTimeout(() => $('#form-confirmar [name=telefono]').focus({ preventScroll: true }), 300);
  });

  /* ── 3 · Confirmar ─────────────────────────────────────── */
  $('#form-confirmar').addEventListener('input', e => { const c = e.target.closest('.campo'); if (c) c.classList.remove('error'); });
  $('#form-confirmar').addEventListener('submit', e => { e.preventDefault(); confirmar(); });
  $('#atras-confirmar').addEventListener('click', () => ir('horario'));
  $('#confirmar').addEventListener('click', confirmar);

  async function confirmar() {
    const f = $('#form-confirmar').elements;
    if (!marcar($('#form-confirmar'), f.telefono.value.replace(/\D/g, '').length < 10 ? ['telefono'] : [])) return;
    const boton = $('#confirmar');
    boton.disabled = true;
    try {
      const c = await Almacen.reservar({
        matricula: estado.yo.matricula, correo: estado.correo, telefono: f.telefono.value,
        fecha: estado.fecha, hora: estado.hora, modalidad: estado.modalidad,
      });
      datos = await Almacen.cargar();
      mostrarListo(c, 'nueva');
    } catch (err) {
      datos = await Almacen.cargar();
      if (err.message === 'OCUPADO' || err.message === 'MODALIDAD') {
        UI.aviso('Alguien acaba de tomar ese horario. Escoge otro.', 'error');
        estado.hora = null; pintarHorario(); ir('horario');
      } else if (err.message === 'YA_TIENE') {
        const r = await Almacen.identificar(estado.yo.matricula, estado.correo);
        datos = r.datos;
        UI.aviso('Ya tenías una cita agendada.', 'error');
        mostrarListo(r.vigente, 'tuya');
      } else UI.aviso(/conexión/.test(err.message) ? err.message : 'No se pudo agendar. Escríbenos a ' + CONFIG.contacto.correo + '.', 'error');
    } finally { boton.disabled = false; }
  }

  /* ── Listo: el boleto ──────────────────────────────────── */
  function mostrarListo(c, como) {
    const co = datos.coordinadores.find(x => x.id === c.coordinador);
    const carrera = datos.carreras.find(x => x.id === c.carrera);
    const enLinea = c.modalidad === 'linea';
    const vigente = c.estado === 'agendada' && c.fecha >= Agenda.hoy();
    const titulo = !vigente ? 'Tu entrevista ya pasó'
      : { nueva: '¡Listo, ya tienes cita!', movida: 'Cambiamos tu cita', tuya: 'Tu cita' }[como];
    const pila = Agenda.pila(c.nombre);
    const lugar = enLinea
      ? (Agenda.ligaValida(co.liga) === 'ok' ? '<a href="' + esc(co.liga) + '" target="_blank" rel="noopener">Entrar a la videollamada</a>'
        : 'Tu coordinador te va a mandar la liga a tu correo')
      : esc(co.oficina || 'IBERO Tijuana');
    $('#paso-listo').innerHTML =
      '<div class="tarjeta boleto">' +
      '<div class="arriba"><div class="palomita">' + ICONO.palomita + '</div><h2>' + titulo + '</h2>' +
      '<p>' + (vigente ? (pila ? esc(pila) + ', te esperamos.' : 'Te esperamos.')
        : (pila ? esc(pila) + ', si' : 'Si') + ' necesitas algo escríbenos a ' + esc(CONFIG.contacto.correo) + '.') + '</p></div>' +
      '<div class="cuando"><b>' + esc(Agenda.mayus(Agenda.fechaLarga(c.fecha))) + '</b>' +
      '<span>' + Agenda.horaBonita(c.hora) + ' a ' + Agenda.horaBonita(Agenda.horaFin(c.hora, c.duracion)) + '</span></div>' +
      '<dl>' +
      '<dt>Con</dt><dd>' + esc(Agenda.nombreCompleto(co)) + '</dd>' +
      '<dt>Carrera</dt><dd>' + esc(carrera.nombre) + '</dd>' +
      '<dt>' + (enLinea ? 'En línea' : 'Dónde') + '</dt><dd>' + lugar + '</dd>' +
      '<dt>Matrícula</dt><dd>' + esc(c.matricula) + '</dd>' +
      '</dl>' +
      (vigente ? '<p class="consejo" style="margin-top:16px">' + (enLinea
        ? 'Conéctate 5 minutos antes desde un lugar tranquilo, con cámara y audífonos.'
        : 'Llega 10 minutos antes y pregunta en recepción por la coordinación.') + '</p>' : '') +
      '<div class="acciones">' + (vigente
        ? '<a class="btn primario" id="a-google" target="_blank" rel="noopener">Agregar a Google Calendar</a>' +
          '<button class="btn" id="a-ics">Agregar a iPhone u Outlook</button>' +
          '<div style="display:flex;gap:10px;justify-content:center;margin-top:6px">' +
          '<button class="btn fantasma chico" id="b-mover">Cambiar horario</button>' +
          '<button class="btn fantasma chico" id="b-cancelar">Cancelar cita</button></div>'
        : '') + '</div></div>' +
      (vigente ? '<p class="meta" style="text-align:center;margin-top:18px">¿Necesitas cambiarla después? Entra a esta misma página con tu matrícula y tu correo.</p>' : '');
    ir('listo');
    if (!vigente) return;

    const sello = (f, h) => f.replace(/-/g, '') + 'T' + h.replace(':', '') + '00';
    const g = new URLSearchParams({
      action: 'TEMPLATE',
      text: 'Entrevista de admisión · ' + carrera.nombre,
      dates: sello(c.fecha, c.hora) + '/' + sello(c.fecha, Agenda.horaFin(c.hora, c.duracion)),
      ctz: 'America/Tijuana',
      details: 'Con ' + Agenda.nombreCompleto(co) + (enLinea && co.liga ? '\nLiga: ' + co.liga : ''),
      location: enLinea ? (co.liga || 'En línea') : (co.oficina || 'IBERO Tijuana'),
    });
    $('#a-google').href = 'https://calendar.google.com/calendar/render?' + g;
    $('#a-ics').onclick = () => UI.descargar(Agenda.ics(c, co, carrera), 'entrevista-ibero.ics');
    $('#b-mover').onclick = () => {
      estado.mover = c;
      estado.carrera = carrera; estado.co = co;
      estado.yo = estado.yo || datos.solicitantes.find(s => s.matricula === c.matricula);
      estado.modalidad = c.modalidad; estado.fecha = c.fecha; estado.hora = null;
      pintarHorario(); ir('horario');
    };
    $('#b-cancelar').onclick = () => {
      const v = UI.ventana('¿Cancelar tu cita?',
        '<p>Se libera el horario del ' + esc(Agenda.fechaLarga(c.fecha)) + ' a las ' + Agenda.horaBonita(c.hora) +
        ' para alguien más. Puedes agendar otra cuando quieras.</p>' +
        '<div class="pie"><button class="btn fantasma" data-no>Mejor no</button>' +
        '<button class="btn primario" data-si>Sí, cancelar</button></div>', { sinFoco: true });
      v.querySelector('[data-no]').onclick = UI.cerrarVentana;
      v.querySelector('[data-si]').onclick = async () => {
        await Almacen.cancelarCita(c.id, 'Prospecto');
        datos = await Almacen.cargar();
        UI.cerrarVentana();
        UI.aviso('Tu cita quedó cancelada.');
        estado.mover = null; ir('tu');
      };
    };
  }

  async function mover() {
    const boton = $('#seguir-horario');
    boton.disabled = true;
    try {
      const c = await Almacen.moverCita(estado.mover.id, estado.fecha, estado.hora, estado.modalidad, 'Prospecto');
      datos = await Almacen.cargar();
      estado.mover = null;
      mostrarListo(c, 'movida');
    } catch (err) {
      UI.aviso(err.message === 'OCUPADO' ? 'Alguien acaba de tomar ese horario. Escoge otro.' : err.message, 'error');
      datos = await Almacen.cargar(); estado.hora = null; pintarHorario();
    } finally { boton.disabled = false; }
  }

  /* ── Arranque ──────────────────────────────────────────── */
  (async () => {
    datos = await Almacen.cargar();
    $('#bajada').textContent = 'Escribe tu matrícula, escoge el horario que te acomode y listo. Son ' +
      datos.ajustes.duracion + ' minutos, en persona o en línea.';
    $('#pie').innerHTML = '¿Dudas? Escríbenos a ' + correoAdm() + ' · ' + esc(CONFIG.contacto.sitio);
    ir('tu');
    UI.etiquetaPrueba();
    Almacen.alCambiar(async () => {
      datos = await Almacen.cargar();
      if (!$('#paso-horario').classList.contains('oculto')) pintarHorario();
    });
  })();
})();
