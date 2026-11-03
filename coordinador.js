/* ═══════════════════════════════════════════════════════════
   Vista del coordinador

   Mis citas  → quién viene y marcar cómo le fue
   Mi semana  → el calendario real: libres, citas y bloqueos; un
                clic en un libre lo tapa, un clic en un tapado lo abre
   Mi horario → su semana tipo pintada en una rejilla, más la
                oficina, la liga y la foto que ve el prospecto
   ═══════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const { esc } = UI;
  const LLAVE_YO = 'agenda-entrevistas.coordinador';

  let datos, yo = null, vista = 'citas', filtro = 'proximas';
  let lunes = lunesDe(Agenda.hoy());
  let pincel = 'a';

  function lunesDe(iso) {
    const k = Agenda.SEMANA.indexOf(Agenda.clave(iso));
    return Agenda.sumar(iso, k < 0 ? 1 : -k);   // domingo → el lunes siguiente
  }
  const co = () => datos.coordinadores.find(x => x.id === yo);
  const quien = () => co() ? co().nombre : 'Coordinador';

  async function recargar() {
    try { datos = await Almacen.cargar(); }
    catch (e) { if (e.message === 'SIN_SESION') return location.reload(); throw e; }
    pintar();
  }
  const soyCoordinador = () => { const s = Almacen.sesion(); return !!(s && s.rol === 'coordinador'); };

  /* ── Elegir agenda ─────────────────────────────────────────
     Sólo Admisiones (o el modo de prueba local) elige de quién es la
     agenda que ve; un coordinador entra directo a la suya. */
  function pintarEntrar() {
    $('#barra').classList.add('oculto');
    const lista = datos.coordinadores.filter(c => c.activo);
    $('#principal').innerHTML = '<div class="tarjeta entrar">' +
      '<span class="rotulo" style="justify-content:center"><b>IBERO Tijuana</b><span class="barra">/</span>Admisiones</span>' +
      '<h2>' + (Almacen.necesitaSesion ? '¿Qué agenda quieres ver?' : 'Entra a tu agenda') + '</h2>' +
      '<p class="meta">' + (Almacen.necesitaSesion ? 'Entraste como Admisiones: puedes abrir la agenda de cualquier coordinador y llenarla por él.'
        : 'Prueba local: elige con quién entrar.') + '</p>' +
      '<div class="lista-entrar">' + lista.map(c => '<button data-co="' + c.id + '">' + UI.avatar(c, 40) +
        '<span><b>' + esc(Agenda.nombreCompleto(c)) + '</b><small class="meta">' +
        esc(datos.carreras.filter(x => x.coordinador === c.id).map(x => x.nombre).join(', ') || 'Sin carrera asignada') +
        '</small></span></button>').join('') + '</div>' +
      (Almacen.necesitaSesion ? '<a class="btn fantasma chico" href="admin.html">← Volver al Admin</a>' : '') +
      '</div>';
    $('#principal').onclick = e => {
      const b = e.target.closest('[data-co]');
      if (!b) return;
      yo = b.dataset.co;
      sessionStorage.setItem(LLAVE_YO, yo);
      pintar();
    };
  }

  /* ── Marco ─────────────────────────────────────────────── */
  function pintar() {
    if (!yo || !co()) return pintarEntrar();
    $('#principal').onclick = null;
    $('#barra').classList.remove('oculto');
    const coord = soyCoordinador();
    $('#yo').innerHTML = UI.avatar(co(), 34) + '<span>' + esc(co().nombre.split(' ')[0]) + '</span>' +
      (coord ? '<button class="btn fantasma chico" id="mi-clave">Mi clave</button>' : '') +
      '<button class="btn fantasma chico" id="salir">' + (coord || !Almacen.necesitaSesion ? 'Salir' : 'Otra agenda') + '</button>';
    if (coord) $('#mi-clave').onclick = Interno.cambiarClave;
    $('#salir').onclick = async () => {
      if (coord) { await Almacen.salir(); return location.replace(location.pathname); }
      sessionStorage.removeItem(LLAVE_YO); yo = null; history.replaceState(null, '', location.pathname); pintar();
    };
    document.querySelectorAll('#pestanas button').forEach(b => b.classList.toggle('activo', b.dataset.vista === vista));
    ({ citas: pintarCitas, semana: pintarSemana, horario: pintarHorario })[vista]();
  }
  $('#pestanas').addEventListener('click', e => {
    const b = e.target.closest('[data-vista]');
    if (!b) return;
    vista = b.dataset.vista; pintar();
  });

  /* ── Mis citas ─────────────────────────────────────────── */
  function pintarCitas() {
    const hoy = Agenda.hoy();
    const mias = datos.citas.filter(c => c.coordinador === yo);
    const vivas = mias.filter(c => c.estado !== 'cancelada');
    const deHoy = vivas.filter(c => c.fecha === hoy);
    const semana = vivas.filter(c => c.fecha >= lunesDe(hoy) && c.fecha <= Agenda.sumar(lunesDe(hoy), 5));
    const porMarcar = vivas.filter(c => c.estado === 'agendada' && c.fecha < hoy);
    const libres = Agenda.proximos(co(), datos, { dias: 7 }).reduce((n, d) => n + d.espacios.length, 0);

    const grupos = {
      proximas: [vivas.filter(c => c.fecha >= hoy && c.estado === 'agendada'), false, 'No tienes citas próximas.'],
      marcar: [porMarcar, true, 'Todo al día: no hay entrevistas pendientes de marcar.'],
      pasadas: [mias.filter(c => c.fecha < hoy || c.estado === 'cancelada'), true, 'Todavía no hay entrevistas pasadas.'],
    };
    const misCarreras = datos.carreras.filter(x => x.coordinador === yo).map(x => x.id);
    const mios = Interno.deCarreras(datos, misCarreras);
    const faltan = Interno.porAgendar(mios, datos);
    const consid = Interno.aConsideracion(mios);
    const deSolicitantes = { faltan: [faltan, 'Todos tus solicitantes aprobados ya tienen cita.'],
                             consid: [consid, 'No tienes solicitantes «A consideración».'] }[filtro];
    const [lista, desc, vacio] = grupos[filtro] || [[], false, ''];

    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="seccion-titulo"><div><h2>Hola, ' + esc(co().nombre.split(' ')[0]) + '</h2>' +
      '<p class="meta">' + esc(datos.carreras.filter(x => x.coordinador === yo).map(x => x.nombre).join(' · ')) + '</p></div></div>' +
      '<div class="cifras">' +
      '<div class="tarjeta cifra marca"><small>Hoy</small><b>' + deHoy.length + '</b><span>' + (deHoy.length === 1 ? 'entrevista' : 'entrevistas') + '</span></div>' +
      '<div class="tarjeta cifra"><small>Esta semana</small><b>' + semana.length + '</b><span>agendadas</span></div>' +
      '<div class="tarjeta cifra"><small>Por marcar</small><b>' + porMarcar.length + '</b><span>ya pasaron y no dicen cómo fue</span></div>' +
      '<div class="tarjeta cifra"><small>Horarios libres</small><b>' + libres + '</b><span>en los próximos 7 días</span></div>' +
      '</div>' +
      (libres === 0 ? '<div class="alerta-fila grave">No tienes horarios libres en los próximos 7 días: los prospectos no pueden agendar contigo.' +
        '<button class="btn chico" data-ir="horario">Abrir horarios</button></div>' : '') +
      '<div class="filtros"><div class="chips">' +
      [['proximas', 'Próximas'], ['marcar', 'Por marcar' + (porMarcar.length ? ' (' + porMarcar.length + ')' : '')],
       ['faltan', 'Sin agendar' + (faltan.length ? ' (' + faltan.length + ')' : '')],
       ['consid', 'A consideración' + (consid.length ? ' (' + consid.length + ')' : '')], ['pasadas', 'Pasadas']]
        .map(([k, t]) => '<button data-filtro="' + k + '" class="' + (filtro === k ? 'activo' : '') + '">' + t + '</button>').join('') +
      '</div></div>' +
      (filtro === 'consid' ? '<p class="meta">Quedaron hasta 50 puntos debajo del mínimo. Si decides entrevistar a alguien, toca «Lo entrevisto» y ya podrá agendar contigo.</p>' : '') +
      (filtro === 'faltan' ? '<p class="meta">Aprobados o con pase directo que todavía no agendan. Puedes escribirles para recordárselo.</p>' : '') +
      '<div class="tarjeta">' + (deSolicitantes
        ? Interno.tablaSolicitantes(deSolicitantes[0], { vacio: deSolicitantes[1] })
        : Interno.tabla(lista, datos, { descendente: desc, vacio })) + '</div>' +
      '</div>';
  }

  /* ── Mi semana ─────────────────────────────────────────── */
  function pintarSemana() {
    const yoCo = co();
    const hoy = Agenda.hoy();
    const ahora = new Date();
    const dur = datos.ajustes.duracion;
    const sinNada = Object.assign({}, yoCo, { bloqueos: [] });
    const vacios = { ajustes: datos.ajustes, citas: [] };

    const columnas = Agenda.SEMANA.map((k, i) => {
      const fecha = Agenda.sumar(lunes, i);
      const pasado = fecha < hoy;
      const bloqueos = (yoCo.bloqueos || []).filter(b => b.fecha === fecha);
      const diaTapado = bloqueos.some(b => !b.desde);
      const citas = datos.citas.filter(c => c.coordinador === yo && c.fecha === fecha && c.estado !== 'cancelada');
      const piezas = [];
      citas.forEach(c => piezas.push({ m: Agenda.aMin(c.hora), html:
        '<button class="bloque cita ' + c.estado + '" data-cita="' + c.id + '"><b>' + Agenda.horaBonita(c.hora) + '</b>' +
        esc(c.nombre.split(' ').slice(0, 2).join(' ')) + '<br><span class="meta">' + Agenda.MODALIDADES[c.modalidad] + '</span></button>' }));
      if (!pasado && !diaTapado) {
        Agenda.espacios(sinNada, fecha, vacios, { sinAnticipacion: true }).forEach(e => {
          const m = Agenda.aMin(e.hora);
          if (citas.some(c => m < Agenda.aMin(c.hora) + c.duracion && Agenda.aMin(c.hora) < m + dur)) return;
          const f = Agenda.aFecha(fecha); f.setMinutes(m);
          if (f < ahora) return;
          const tapado = bloqueos.some(b => m < Agenda.aMin(b.hasta) && Agenda.aMin(b.desde) < m + dur);
          const mods = e.modalidades.length === 2 ? 'Presencial o en línea' : Agenda.MODALIDADES[e.modalidades[0]];
          piezas.push({ m, html: '<button class="bloque ' + (tapado ? 'tapado' : 'libre') + '" data-fecha="' + fecha + '" data-hora="' + e.hora + '">' +
            '<b>' + Agenda.horaBonita(e.hora) + '</b>' + (tapado ? 'Bloqueado' : mods) + '</button>' });
        });
      }
      piezas.sort((a, b) => a.m - b.m);
      const f = Agenda.aFecha(fecha);
      const tieneHorario = Object.keys((yoCo.semana || {})[k] || {}).length > 0;
      return '<div class="col-dia' + (fecha === hoy ? ' es-hoy' : '') + (diaTapado ? ' bloqueado' : '') + '">' +
        '<header><small>' + Agenda.nombreDia(k) + '</small><b>' + f.getDate() + '</b></header>' +
        (diaTapado ? '<div class="bloque tapado" style="cursor:default;text-align:center">Día bloqueado</div>' : '') +
        piezas.map(p => p.html).join('') +
        (!piezas.length && !diaTapado ? '<div class="nada">' + (pasado ? '—' : tieneHorario ? 'Sin horarios' : 'No atiendes') + '</div>' : '') +
        (!pasado && (tieneHorario || diaTapado) ? '<button class="btn fantasma chico" data-dia="' + fecha + '">' + (diaTapado ? 'Abrir el día' : 'Bloquear el día') + '</button>' : '') +
        '</div>';
    }).join('');

    const fin = Agenda.sumar(lunes, 5);
    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="seccion-titulo"><div><h2>Semana del ' + Agenda.aFecha(lunes).getDate() + ' al ' + Agenda.fechaLarga(fin).replace(/^\S+ /, '') + '</h2>' +
      '<p class="meta">¿Surgió algo? Toca un horario libre para bloquearlo; tócalo otra vez para abrirlo.</p></div>' +
      '<div style="display:flex;gap:6px"><button class="btn chico" data-semana="-7">← Anterior</button>' +
      '<button class="btn chico" data-semana="0">Esta semana</button><button class="btn chico" data-semana="7">Siguiente →</button></div></div>' +
      '<div class="leyenda"><span><i style="background:var(--ok-velo);border:1px solid var(--ok)"></i>Libre</span>' +
      '<span><i style="background:var(--capa-2);border:1px solid var(--linea-sutil);border-left:3px solid var(--info)"></i>Cita</span>' +
      '<span><i class="bloque tapado" style="padding:0"></i>Bloqueado</span></div>' +
      '<div class="semana-cal">' + columnas + '</div></div>';
  }

  async function alternarBloqueo(fecha, hora) {
    const c = co();
    const m = Agenda.aMin(hora), dur = datos.ajustes.duracion;
    const choca = b => b.fecha === fecha && b.desde && m < Agenda.aMin(b.hasta) && Agenda.aMin(b.desde) < m + dur;
    const bloqueos = c.bloqueos || [];
    if (bloqueos.some(choca)) c.bloqueos = bloqueos.filter(b => !choca(b));
    else c.bloqueos = bloqueos.concat({ id: Almacen.codigo(5), fecha, desde: hora, hasta: Agenda.horaFin(hora, dur) });
    await Almacen.guardarCoordinador({ id: c.id, bloqueos: c.bloqueos });
    recargar();
  }
  async function alternarDia(fecha) {
    const c = co();
    const tapado = (c.bloqueos || []).some(b => b.fecha === fecha && !b.desde);
    const citas = datos.citas.filter(x => x.coordinador === yo && x.fecha === fecha && x.estado === 'agendada');
    if (tapado) c.bloqueos = c.bloqueos.filter(b => !(b.fecha === fecha && !b.desde));
    else c.bloqueos = (c.bloqueos || []).filter(b => b.fecha !== fecha).concat({ id: Almacen.codigo(5), fecha });
    await Almacen.guardarCoordinador({ id: c.id, bloqueos: c.bloqueos });
    if (!tapado && citas.length)
      UI.aviso('Ojo: ese día ya tienes ' + citas.length + (citas.length === 1 ? ' cita. Siguen en pie; muévela' : ' citas. Siguen en pie; muévelas') + ' si no vas a estar.', 'error');
    recargar();
  }

  /* ── Mi horario ────────────────────────────────────────── */
  function pintarHorario() {
    const c = co();
    const aj = datos.ajustes;
    const filas = [];
    for (let m = aj.horaInicio * 60; m < aj.horaFin * 60; m += Agenda.CELDA) filas.push(Agenda.aHora(m));

    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="tarjeta" style="padding:20px;display:grid;gap:16px">' +
      '<div><h2>Lo que ve el prospecto</h2><p class="meta">Se guarda en cuanto sales del campo.</p></div>' +
      '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
      '<div id="foto-caja">' + UI.avatar(c, 84) + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><label class="btn chico">Cambiar foto<input type="file" accept="image/*" id="foto" hidden></label>' +
      (c.foto ? '<button class="btn fantasma chico" id="quitar-foto">Quitar foto</button>' : '') + '</div></div>' +
      '<div class="fila-campos">' +
      '<label class="campo"><span>Dónde atiendes en persona</span><input type="text" data-campo="oficina" value="' + esc(c.oficina) + '" placeholder="Edificio, cubículo u oficina"></label>' +
      '<label class="campo"><span>Liga para las entrevistas en línea</span><input type="url" data-campo="liga" value="' + esc(c.liga) + '" placeholder="https://teams.microsoft.com/…"></label>' +
      '</div></div>' +

      '<div class="tarjeta" style="display:grid;gap:14px;padding:20px 20px 4px">' +
      '<div class="seccion-titulo"><div><h2>Tu semana tipo</h2>' +
      '<p class="meta">Pinta los bloques en que puedes entrevistar; cada cuadro es media hora. Se repite cada semana y se guarda solo.</p></div>' +
      '<button class="btn fantasma chico" id="borrar-todo">Borrar todo</button></div>' +
      '<div class="pinceles" id="pinceles">' +
      [['a', 'Presencial o en línea'], ['p', 'Sólo presencial'], ['l', 'Sólo en línea'], ['borrar', 'Borrador']]
        .map(([k, t]) => '<button class="pincel' + (pincel === k ? ' activo' : '') + '" data-pincel="' + k + '"><i class="t-' + k + '"></i>' + t + '</button>').join('') +
      '</div><p class="meta" id="resumen-horario"></p></div>' +
      '<div class="tarjeta rejilla-caja"><div class="rejilla" id="rejilla">' +
      '<div></div>' + Agenda.SEMANA.map(k => '<div class="cab">' + Agenda.mayus(Agenda.nombreDia(k)) + '</div>').join('') +
      filas.map(h => '<div class="hr' + (h.endsWith(':30') ? ' media' : '') + '">' + Agenda.horaBonita(h).replace(':00', '') + '</div>' +
        Agenda.SEMANA.map(k => {
          const t = ((c.semana || {})[k] || {})[h];
          return '<div class="c' + (t ? ' t-' + t : '') + '" data-d="' + k + '" data-h="' + h + '"></div>';
        }).join('')).join('') +
      '</div></div></div>';

    resumenHorario();
    montarRejilla();

    document.querySelectorAll('[data-campo]').forEach(inp => inp.addEventListener('change', async () => {
      await Almacen.guardarCoordinador({ id: c.id, [inp.dataset.campo]: inp.value.trim() });
      datos = await Almacen.cargar();
      UI.aviso('Guardado.', 'ok');
    }));
    $('#foto').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        await Almacen.guardarCoordinador({ id: c.id, foto: await UI.leerFoto(f) });
        UI.aviso('Foto lista.', 'ok'); recargar();
      } catch (err) { UI.aviso(err.message, 'error'); }
    };
    const quitar = $('#quitar-foto');
    if (quitar) quitar.onclick = async () => { await Almacen.guardarCoordinador({ id: c.id, foto: '' }); recargar(); };
    $('#pinceles').onclick = e => {
      const b = e.target.closest('[data-pincel]');
      if (!b) return;
      pincel = b.dataset.pincel;
      document.querySelectorAll('.pincel').forEach(x => x.classList.toggle('activo', x === b));
    };
    $('#borrar-todo').onclick = () => {
      const v = UI.ventana('¿Borrar toda tu semana tipo?',
        '<p>Dejarás de aparecer para los prospectos hasta que vuelvas a pintar horarios. Las citas que ya tienes siguen en pie.</p>' +
        '<div class="pie"><button class="btn fantasma" data-no>No</button><button class="btn primario" data-si>Sí, borrar</button></div>', { sinFoco: true });
      v.querySelector('[data-no]').onclick = UI.cerrarVentana;
      v.querySelector('[data-si]').onclick = async () => {
        await Almacen.guardarCoordinador({ id: c.id, semana: {} });
        UI.cerrarVentana(); recargar();
      };
    };
  }

  function resumenHorario() {
    const c = co();
    const celdas = Object.values(c.semana || {}).reduce((n, d) => n + Object.keys(d).length, 0);
    const libres = Agenda.proximos(c, datos, {}).reduce((n, d) => n + d.espacios.length, 0);
    $('#resumen-horario').innerHTML = celdas
      ? '<b>' + (celdas / 2).toString().replace('.5', '½') + ' h a la semana.</b> Con eso, los prospectos ven <b>' + libres +
        '</b> horarios libres de ' + datos.ajustes.duracion + ' min en los próximos ' + datos.ajustes.diasAdelante + ' días.'
      : '<b style="color:var(--peligro)">Todavía no pintas ningún horario:</b> los prospectos de tu carrera no pueden agendar.';
  }

  /* Pintar arrastrando, con ratón o con el dedo. El primer cuadro
     decide si el trazo pinta o borra: empezar sobre un cuadro del
     mismo color lo borra, como en la rejilla de la convocatoria. */
  function montarRejilla() {
    const r = $('#rejilla');
    let modo = undefined;
    const c = co();
    function aplicar(cel) {
      if (!cel || !cel.classList.contains('c')) return;
      const { d, h } = cel.dataset;
      c.semana = c.semana || {};
      c.semana[d] = c.semana[d] || {};
      if (modo) c.semana[d][h] = modo; else delete c.semana[d][h];
      if (!Object.keys(c.semana[d]).length) delete c.semana[d];
      cel.className = 'c' + (modo ? ' t-' + modo : '');
    }
    /* Si el ratón va rápido, pointermove se salta cuadros: se rellena
       el rectángulo entre el último cuadro tocado y el actual. */
    const horas = [...new Set([...r.querySelectorAll('.c')].map(x => x.dataset.h))];
    let ultimo = null;
    function rellenar(cel) {
      if (!cel || !cel.classList.contains('c') || cel === ultimo) return;
      const [d0, d1] = [ultimo, cel].map(x => Agenda.SEMANA.indexOf(x.dataset.d)).sort((a, b) => a - b);
      const [h0, h1] = [ultimo, cel].map(x => horas.indexOf(x.dataset.h)).sort((a, b) => a - b);
      for (let i = d0; i <= d1; i++) for (let j = h0; j <= h1; j++)
        aplicar(r.querySelector('.c[data-d="' + Agenda.SEMANA[i] + '"][data-h="' + horas[j] + '"]'));
      ultimo = cel;
    }
    r.addEventListener('pointerdown', e => {
      const cel = e.target.closest('.c');
      if (!cel) return;
      e.preventDefault();
      const actual = ((c.semana || {})[cel.dataset.d] || {})[cel.dataset.h];
      modo = pincel === 'borrar' || actual === pincel ? null : pincel;
      aplicar(cel);
      ultimo = cel;
    });
    r.addEventListener('pointermove', e => {
      if (modo === undefined) return;
      rellenar(document.elementFromPoint(e.clientX, e.clientY));
    });
    const soltar = async () => {
      if (modo === undefined) return;
      modo = undefined;
      await Almacen.guardarCoordinador({ id: c.id, semana: c.semana });
      datos = await Almacen.cargar();
      resumenHorario();
    };
    addEventListener('pointerup', soltar);
    addEventListener('pointercancel', soltar);
  }

  /* ── Clics del contenido ───────────────────────────────── */
  $('#principal').addEventListener('click', e => {
    if (!yo) return;
    const t = e.target.closest('[data-cita],[data-filtro],[data-semana],[data-fecha],[data-dia],[data-ir],[data-habilitar]');
    if (!t) return;
    if (t.dataset.habilitar) Almacen.habilitar(t.dataset.habilitar, !!t.dataset.si, quien()).then(recargar);
    else if (t.dataset.cita) Interno.ficha(t.dataset.cita, quien(), recargar);
    else if (t.dataset.filtro) { filtro = t.dataset.filtro; pintar(); }
    else if (t.dataset.semana) { const n = +t.dataset.semana; lunes = n ? Agenda.sumar(lunes, n) : lunesDe(Agenda.hoy()); pintar(); }
    else if (t.dataset.dia) alternarDia(t.dataset.dia);
    else if (t.dataset.fecha) alternarBloqueo(t.dataset.fecha, t.dataset.hora);
    else if (t.dataset.ir) { vista = t.dataset.ir; pintar(); }
  });

  /* ── Arranque ──────────────────────────────────────────── */
  (async () => {
    if (Almacen.necesitaSesion && !Almacen.sesion())
      await Interno.pantallaEntrar($('#principal'), 'Entra a tu agenda',
        'Con tu correo IBERO y la clave que te dio Admisiones.');
    try { datos = await Almacen.cargar(); }
    catch (e) { if (e.message === 'SIN_SESION') return location.reload(); throw e; }
    const pedido = new URLSearchParams(location.search).get('como');
    if (soyCoordinador()) yo = Almacen.sesion().quien;
    else {
      yo = pedido || sessionStorage.getItem(LLAVE_YO);
      if (pedido) { sessionStorage.setItem(LLAVE_YO, pedido); vista = 'horario'; }
    }
    pintar();
    UI.etiquetaPrueba();
    /* no se repinta mientras pinta su horario o tiene una ficha abierta */
    Almacen.alCambiar(() => { if (vista !== 'horario' && !document.querySelector('.velo')) recargar(); });
  })();
})();
