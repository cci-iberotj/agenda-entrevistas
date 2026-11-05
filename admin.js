/* ═══════════════════════════════════════════════════════════
   Admin · la vista de Marysol

   Tablero  → por licenciatura, como el Tablero del Excel: cuántos
              faltan por agendar, agendados, admitidos; alertas de
              carreras con gente por agendar y sin horarios
   Prospectos → se carga el Excel de control de Admisiones; lista de
              solicitantes con su situación
   Citas    → todas, con búsqueda y filtros; se exportan a Excel
   Carreras y coordinadores → altas, cambios, bajas y quién
              coordina qué; desde aquí se abre la agenda de cada uno
   Ajustes  → duración, anticipación, días visibles, horario
   ═══════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const $ = s => document.querySelector(s);
  const { esc } = UI;
  const QUIEN = 'Admisiones';

  let datos, vista = 'tablero', ciclo = '';
  const filtro = { texto: '', carrera: '', estado: '', periodo: 'proximas' };
  const filtroP = { texto: '', lic: '', situacion: '' };
  let ultimoResumen = null;

  async function recargar() {
    try { datos = await Almacen.cargar(); }
    catch (e) { if (e.message === 'SIN_SESION') return location.reload(); throw e; }
    pintar();
  }

  function pintar() {
    document.querySelectorAll('#pestanas button').forEach(b => b.classList.toggle('activo', b.dataset.vista === vista));
    ({ tablero: pintarTablero, prospectos: pintarProspectos, citas: pintarCitas, equipo: pintarEquipo, ajustes: pintarAjustes })[vista]();
  }
  $('#pestanas').addEventListener('click', e => {
    const b = e.target.closest('[data-vista]');
    if (b) { vista = b.dataset.vista; pintar(); }
  });

  const coDe = carrera => datos.coordinadores.find(x => x.id === carrera.coordinador && x.activo);
  const libres7 = co => co ? Agenda.proximos(co, datos, { dias: 7 }).reduce((n, d) => n + d.espacios.length, 0) : 0;
  const agendaDe = id => 'coordinador.html?como=' + encodeURIComponent(id);
  /* cuántas citas próximas faltan por avisar, en el mismo botón */
  function botonAvisar() {
    const hoy = Agenda.hoy();
    const n = datos.citas.filter(c => c.estado === 'agendada' && c.fecha >= hoy && !c.avisada).length;
    return '<button class="btn chico' + (n ? ' primario' : '') + '" data-avisar-citas>✉ Avisar citas' + (n ? ' (' + n + ' por avisar)' : '') + '</button>';
  }
  const sinLiga = co => co.activo && Agenda.ofreceLinea(co) && Agenda.ligaValida(co.liga) !== 'ok';

  /* ── Tablero ───────────────────────────────────────────── */
  const ciclos = () => [...new Set(datos.solicitantes.map(x => x.ciclo).filter(Boolean))];
  const delCiclo = lista => ciclo ? lista.filter(x => x.ciclo === ciclo) : lista;
  const chipsCiclo = () => ciclos().length > 1 ? '<div class="chips">' + [['', 'Todos los ciclos']].concat(ciclos().map(c => [c, c]))
    .map(([k, t]) => '<button data-ciclo="' + esc(k) + '" class="' + (ciclo === k ? 'activo' : '') + '">' + esc(t) + '</button>').join('') + '</div>' : '';

  function pintarTablero() {
    const hoy = Agenda.hoy();
    const sol = delCiclo(datos.solicitantes.filter(x => !x.fuera));
    const enCiclo = new Set(sol.map(x => x.matricula));
    const citas = datos.citas.filter(c => c.estado !== 'cancelada' && enCiclo.has(c.matricula));
    const norm = Importar.norm;

    /* una fila por licenciatura, como el Tablero del Excel */
    const filas = datos.carreras.filter(c => c.activa).map(c => {
      const suyos = sol.filter(x => norm(x.licenciatura) === norm(c.nombre));
      const suyas = citas.filter(x => x.carrera === c.id);
      const co = coDe(c);
      return {
        c, co, solicitantes: suyos.length,
        faltan: Interno.porAgendar(suyos, datos).length,
        consid: Interno.aConsideracion(suyos).filter(x => !x.habilitado).length,
        agendadas: suyas.filter(x => x.estado === 'agendada' && x.fecha >= hoy).length,
        realizadas: suyas.filter(x => x.estado === 'realizada').length,
        admitidos: suyas.filter(x => x.resultado === 'admitido').length,
        noAdmitidos: suyas.filter(x => x.resultado === 'no_admitido').length,
        libres: libres7(co),
      };
    });
    const suma = k => filas.reduce((n, f) => n + f[k], 0);

    /* cobertura: lo que urge es gente por agendar sin horarios */
    const alertas = filas.map(f => {
      if (!f.co && (f.faltan || f.solicitantes)) return { grave: true, txt: '<b>' + esc(f.c.nombre) + '</b> no tiene coordinador asignado.', boton: '<button class="btn chico" data-ir="equipo">Asignar</button>' };
      if (!f.co) return null;
      if (f.faltan && f.libres === 0) return { grave: true, txt: '<b>' + esc(f.c.nombre) + '</b>: ' + f.faltan + (f.faltan === 1 ? ' solicitante espera' : ' solicitantes esperan') + ' horario y ' + esc(f.co.nombre) + ' no tiene horarios libres en 7 días.', boton: '<a class="btn chico" href="' + agendaDe(f.co.id) + '" target="_blank">Abrir su horario</a>' };
      if (f.faltan > f.libres) return { grave: false, txt: '<b>' + esc(f.c.nombre) + '</b>: ' + f.faltan + ' por agendar y sólo ' + f.libres + ' horarios libres en 7 días.', boton: '<a class="btn chico" href="' + agendaDe(f.co.id) + '" target="_blank">Ver su agenda</a>' };
      return null;
    }).filter(Boolean).sort((a, b) => b.grave - a.grave);

    const pronto = datos.citas.filter(c => c.estado !== 'cancelada' && (c.fecha === hoy || c.fecha === Agenda.sumar(hoy, 1)));
    const imp = datos.importado;
    const celda = (n, fuerte) => '<td style="text-align:center">' + (n ? (fuerte ? '<b>' + n + '</b>' : n) : '<span class="meta">0</span>') + '</td>';

    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="seccion-titulo"><div><h2>' + Agenda.mayus(Agenda.fechaLarga(hoy)) + '</h2>' +
      '<p class="meta">' + (imp ? 'Datos del Excel cargado el ' + new Date(imp.cuando).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) + '.'
        : CONFIG.modoPrueba ? 'Datos de ejemplo. Carga el Excel de Admisiones en «Prospectos».'
        : 'Todavía no se carga el Excel de Admisiones: hazlo en «Prospectos».') + '</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + chipsCiclo() +
      botonAvisar() +
      '<a class="btn chico" href="index.html" target="_blank">Ver la página del prospecto ↗</a></div></div>' +
      '<div class="cifras">' +
      '<div class="tarjeta cifra marca"><small>Por agendar</small><b>' + suma('faltan') + '</b><span>aprobados sin cita</span></div>' +
      '<div class="tarjeta cifra"><small>Agendadas</small><b>' + suma('agendadas') + '</b><span>próximas entrevistas</span></div>' +
      '<div class="tarjeta cifra"><small>Admitidos</small><b>' + suma('admitidos') + '</b><span>' + suma('realizadas') + ' entrevistas hechas</span></div>' +
      '<div class="tarjeta cifra"><small>A consideración</small><b>' + suma('consid') + '</b><span>esperan decisión del coordinador</span></div>' +
      '</div>' +
      /* con más de tres, una sola línea: el detalle está en rojo en la tabla */
      (alertas.length > 3
        ? '<div class="alerta-fila grave"><span><b>' + alertas.length + ' licenciaturas</b> tienen solicitantes esperando y no les alcanzan los horarios de la próxima semana. Están en rojo en la tabla; desde ahí abres la agenda de cada coordinador.</span></div>'
        : alertas.length ? '<div class="alertas">' + alertas.map(a => '<div class="alerta-fila' + (a.grave ? ' grave' : '') + '"><span>' + a.txt + '</span>' + a.boton + '</div>').join('') + '</div>'
        : '<div class="alerta-fila" style="background:var(--ok-velo);color:var(--ok)">Hay horarios suficientes para todos los que faltan por agendar.</div>') +
      (() => {
        const faltan = datos.coordinadores.filter(sinLiga);
        return faltan.length ? '<div class="alerta-fila"><span><b>' + faltan.length + (faltan.length === 1 ? ' coordinador abrió' : ' coordinadores abrieron') +
          ' horarios en línea sin una liga de reunión válida</b> (' + faltan.map(c => esc(c.nombre.split(' ')[0])).join(', ') +
          '). Sus prospectos sólo ven los horarios presenciales hasta que la pongan.</span></div>' : '';
      })() +
      '<div class="tarjeta tabla-caja"><table class="tabla"><thead><tr><th>Licenciatura</th><th>Coordinador</th>' +
      '<th style="text-align:center">Solicitantes</th><th style="text-align:center">Por agendar</th><th style="text-align:center">Agendadas</th>' +
      '<th style="text-align:center">Admitidos</th><th style="text-align:center">No admitidos</th><th style="text-align:center">Libres 7 días</th></tr></thead><tbody>' +
      filas.map(f => {
        const falta = f.faltan > f.libres;
        return '<tr style="cursor:default"' + (falta ? ' class="fila-alerta"' : '') + '><td><b>' + esc(f.c.nombre) + '</b></td><td>' +
          (f.co ? '<a href="' + agendaDe(f.co.id) + '" target="_blank" title="Abrir su agenda">' + esc(f.co.nombre) + '</a>' : '<a href="#" data-ir="equipo">Sin asignar</a>') + '</td>' +
          celda(f.solicitantes) + celda(f.faltan, true) + celda(f.agendadas) + celda(f.admitidos) + celda(f.noAdmitidos) +
          '<td style="text-align:center">' + (f.co ? (falta ? '<b>' + f.libres + '</b>' : f.libres) : '—') + '</td></tr>';
      }).join('') +
      '<tr style="cursor:default"><td><b>Total</b></td><td></td>' + ['solicitantes', 'faltan', 'agendadas', 'admitidos', 'noAdmitidos'].map(k => celda(suma(k), true)).join('') + '<td></td></tr>' +
      '</tbody></table></div>' +
      '<div class="tarjeta"><div style="padding:16px 16px 4px"><h3>Hoy y mañana</h3></div>' +
      Interno.tabla(pronto, datos, { conCoordinador: true, vacio: 'Sin entrevistas hoy ni mañana.' }) + '</div>' +
      '</div>';
  }

  /* ── Prospectos: el Excel de Admisiones ────────────────── */
  function situacion(s) {
    const hoy = Agenda.hoy();
    const c = datos.citas.filter(x => x.matricula === s.matricula && x.estado !== 'cancelada')
      .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora))[0];
    if (c && c.estado === 'agendada' && c.fecha >= hoy) return ['agendada', 'Cita ' + Agenda.fechaCorta(c.fecha) + ' ' + Agenda.horaBonita(c.hora), c];
    if (c && c.estado === 'realizada') return ['realizada', c.resultado ? Agenda.RESULTADOS[c.resultado] : 'Entrevistado', c];
    const p = Agenda.permiso(s);
    if (p === 'ok') return ['faltan', c && c.estado === 'no_asistio' ? 'Faltó; puede reagendar' : 'Sin agendar', c];
    return [p, { consideracion: 'A consideración', pendiente: 'Sin resultado', no_aprobado: 'No aprobado', fuera: 'Ya no está en el Excel' }[p] || p, c];
  }

  function pintarProspectos() {
    const ya = document.activeElement && document.activeElement.id === 'buscar-p';
    const imp = datos.importado;
    const r = ultimoResumen;
    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="seccion-titulo"><div><h2>Prospectos</h2><p class="meta">Salen del Excel de control de Admisiones. Cárgalo cada vez que lo actualices: lo de aquí (citas, permisos) se conserva.</p></div></div>' +
      '<label class="tarjeta" id="soltar" style="display:flex;gap:16px;align-items:center;padding:18px 20px;cursor:pointer;border-style:dashed;border-width:2px">' +
      '<span class="avatar" style="width:48px;height:48px;font-size:20px;background:var(--ok)">⇪</span>' +
      '<span style="flex:1"><b>Cargar el Excel de Admisiones</b><span class="meta" style="display:block">' +
      (imp ? 'Último: ' + esc(imp.archivo) + ' · ' + imp.solicitantes + ' solicitantes · ' + new Date(imp.cuando).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
        : 'Arrástralo aquí o haz clic. Se leen las hojas «Base…» y la tabla de coordinadores de «Especificaciones».') +
      '</span></span><span class="btn primario chico">Elegir archivo</span>' +
      '<input type="file" id="excel" accept=".xlsx,.xls" hidden></label>' +
      (r ? '<div class="alerta-fila" style="background:var(--ok-velo);color:var(--ok);display:block">' +
        '<b style="color:var(--ok)">Listo.</b> ' + r.nuevos + ' solicitantes nuevos, ' + r.actualizados + ' actualizados' +
        (r.fuera ? ', ' + r.fuera + ' ya no venían en el archivo (se marcan, no se borran)' : '') +
        (r.coordinadoresNuevos ? ', ' + r.coordinadoresNuevos + ' coordinadores nuevos' : '') +
        (r.carrerasNuevas ? ', ' + r.carrerasNuevas + ' licenciaturas nuevas' : '') + '. <b style="color:var(--ok)">' + r.porAgendar + ' pueden agendar.</b>' +
        (r.reemplazoEjemplo ? '<br>Los datos de ejemplo se reemplazaron por los del Excel. Falta que cada coordinador llene su horario.' : '') +
        (r.avisos && r.avisos.length ? '<br>' + r.avisos.map(esc).join('<br>') : '') + '</div>' : '') +
      '<div class="filtros">' +
      '<input type="text" id="buscar-p" placeholder="Buscar por nombre, matrícula o correo" value="' + esc(filtroP.texto) + '">' +
      '<select id="f-lic"><option value="">Todas las licenciaturas</option>' +
      [...new Set(datos.solicitantes.map(x => x.licenciatura))].sort().map(l => '<option' + (filtroP.lic === l ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
      chipsCiclo() + '</div>' +
      '<div class="chips" id="chips-sit">' + [['', 'Todos'], ['faltan', 'Sin agendar'], ['agendada', 'Con cita'], ['realizada', 'Entrevistados'],
        ['consideracion', 'A consideración'], ['pendiente', 'Sin resultado'], ['no_aprobado', 'No aprobados']]
        .map(([k, t]) => '<button data-sit="' + k + '" class="' + (filtroP.situacion === k ? 'activo' : '') + '">' + t + '</button>').join('') + '</div>' +
      '<div class="tarjeta" id="tabla-p"></div></div>';
    pintarTablaP();
    if (ya) { const b = $('#buscar-p'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }

    $('#buscar-p').oninput = e => { filtroP.texto = e.target.value; pintarTablaP(); };
    $('#f-lic').onchange = e => { filtroP.lic = e.target.value; pintarTablaP(); };
    $('#excel').onchange = e => cargarExcel(e.target.files[0]);
    const zona = $('#soltar');
    zona.addEventListener('dragover', e => { e.preventDefault(); zona.style.borderColor = 'var(--ok)'; });
    zona.addEventListener('dragleave', () => { zona.style.borderColor = ''; });
    zona.addEventListener('drop', e => { e.preventDefault(); zona.style.borderColor = ''; cargarExcel(e.dataTransfer.files[0]); });
  }

  function pintarTablaP() {
    const t = Importar.norm(filtroP.texto);
    const lista = delCiclo(datos.solicitantes).filter(s => {
      if (filtroP.lic && s.licenciatura !== filtroP.lic) return false;
      const [sit] = situacion(s);
      if (filtroP.situacion ? sit !== filtroP.situacion : sit === 'fuera') return false;
      return !t || Importar.norm(s.nombre + ' ' + s.matricula + ' ' + s.correo).includes(t);
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const colores = { agendada: 'e-agendada', realizada: 'e-realizada', faltan: 'r-no_admitido', consideracion: 'e-no_asistio' };
    $('#tabla-p').innerHTML = !lista.length ? '<div class="vacio"><b>Nadie con estos filtros.</b></div>' :
      '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Solicitante</th><th>Licenciatura</th><th>Examen</th><th>Situación</th><th></th></tr></thead><tbody>' +
      lista.map(s => {
        const [sit, texto, c] = situacion(s);
        const consid = /^a consideraci/i.test(Importar.norm(s.resultado));
        return '<tr' + (c ? ' data-cita="' + c.id + '"' : ' style="cursor:default"') + '><td><b>' + esc(Agenda.titulo(s.nombre)) + '</b><span class="meta">' + esc(s.matricula) + ' · ' + esc(s.correo || 'sin correo') + '</span></td>' +
          '<td>' + esc(s.licenciatura) + '<span class="meta">' + esc(s.ciclo) + '</span></td>' +
          '<td>' + esc(s.resultado || '—') + (s.observaciones ? '<span class="meta">' + esc(s.observaciones) + '</span>' : '') + '</td>' +
          '<td><span class="insignia ' + (colores[sit] || 'e-cancelada') + '">' + esc(texto) + '</span></td>' +
          '<td style="text-align:right">' + (consid && sit !== 'agendada' && sit !== 'realizada'
            ? '<button class="btn chico' + (s.habilitado ? ' fantasma' : '') + '" data-habilitar="' + esc(s.matricula) + '" data-si="' + (s.habilitado ? '' : '1') + '">' +
              (s.habilitado ? 'Quitar permiso' : 'Dejar agendar') + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function cargarExcel(file) {
    if (!file) return;
    try {
      UI.aviso('Leyendo ' + file.name + '…');
      const leido = await Importar.archivo(file);
      ultimoResumen = await Almacen.importar(leido, file.name);
      ultimoResumen.avisos = leido.avisos;
      datos = await Almacen.cargar();
      UI.aviso('Excel cargado.', 'ok');
      pintar();
    } catch (err) { UI.aviso(err.message, 'error'); }
  }

  /* ── Citas ─────────────────────────────────────────────── */
  function citasFiltradas() {
    const hoy = Agenda.hoy();
    const t = filtro.texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return datos.citas.filter(c => {
      if (filtro.carrera && c.carrera !== filtro.carrera) return false;
      if (filtro.estado && c.estado !== filtro.estado) return false;
      if (filtro.periodo === 'proximas' && c.fecha < hoy) return false;
      if (filtro.periodo === 'pasadas' && c.fecha >= hoy) return false;
      if (t) {
        const hay = (c.nombre + ' ' + c.matricula + ' ' + c.correo + ' ' + c.telefono).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }

  function pintarCitas() {
    const ya = document.activeElement && document.activeElement.id === 'buscar';
    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="seccion-titulo"><div><h2>Citas</h2><p class="meta" id="cuantas"></p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' + botonAvisar() +
      '<button class="btn chico" id="exportar">Descargar para Excel</button></div></div>' +
      '<div class="filtros">' +
      '<input type="text" id="buscar" placeholder="Buscar por nombre, matrícula, correo o celular" value="' + esc(filtro.texto) + '">' +
      '<select id="f-carrera"><option value="">Todas las carreras</option>' +
      datos.carreras.map(c => '<option value="' + c.id + '"' + (filtro.carrera === c.id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>').join('') + '</select>' +
      '<select id="f-estado"><option value="">Cualquier estado</option>' +
      Object.entries(Agenda.ESTADOS).map(([k, v]) => '<option value="' + k + '"' + (filtro.estado === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>' +
      '<div class="chips">' + [['proximas', 'Próximas'], ['pasadas', 'Pasadas'], ['todas', 'Todas']]
        .map(([k, t]) => '<button data-periodo="' + k + '" class="' + (filtro.periodo === k ? 'activo' : '') + '">' + t + '</button>').join('') + '</div>' +
      '</div><div class="tarjeta" id="tabla-citas"></div></div>';
    pintarTablaCitas();
    if (ya) { const b = $('#buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }

    $('#buscar').oninput = e => { filtro.texto = e.target.value; pintarTablaCitas(); };
    $('#f-carrera').onchange = e => { filtro.carrera = e.target.value; pintarTablaCitas(); };
    $('#f-estado').onchange = e => { filtro.estado = e.target.value; pintarTablaCitas(); };
    $('#exportar').onclick = exportar;
  }
  function pintarTablaCitas() {
    const lista = citasFiltradas();
    $('#cuantas').textContent = lista.length + (lista.length === 1 ? ' cita' : ' citas') + ' con estos filtros.';
    $('#tabla-citas').innerHTML = Interno.tabla(lista, datos, {
      conCoordinador: true, descendente: filtro.periodo !== 'proximas', vacio: 'Ninguna cita con estos filtros.' });
  }

  /* CSV con BOM: Excel lo abre con acentos y en columnas. */
  function exportar() {
    const lista = citasFiltradas().sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    /* columnas con los nombres del Excel de Admisiones, para pegarlas en la pestaña de cada licenciatura */
    const cab = ['Matrícula', 'Nombre del aspirante', 'Licenciatura', 'Fecha de entrevista', 'Hora', 'Modalidad', 'Asistencia',
      'Resultado entrevista', 'Comentarios del coordinador', 'Coordinador', 'Correo de contacto', 'Celular', 'Agendó el'];
    const celda = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const filas = lista.map(c => {
      const carrera = datos.carreras.find(x => x.id === c.carrera) || {};
      const co = datos.coordinadores.find(x => x.id === c.coordinador);
      const [y, m, d] = c.fecha.split('-');
      return [c.matricula, c.nombre.toUpperCase(), carrera.nombre, d + '/' + m + '/' + y, c.hora, Agenda.MODALIDADES[c.modalidad],
        Agenda.ESTADOS[c.estado], Agenda.RESULTADOS[c.resultado] || '', c.nota, Agenda.nombreCompleto(co), c.correo, c.telefono,
        c.creado ? new Date(c.creado).toLocaleDateString('es-MX') : ''].map(celda).join(',');
    });
    const texto = '﻿' + [cab.map(celda).join(',')].concat(filas).join('\r\n');
    UI.descargar(new Blob([texto], { type: 'text/csv;charset=utf-8' }), 'entrevistas-admision-' + Agenda.hoy() + '.csv');
    UI.aviso(lista.length + ' citas descargadas.', 'ok');
  }

  /* ── Carreras y coordinadores ──────────────────────────── */
  function pintarEquipo() {
    const cos = datos.coordinadores.slice().sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre, 'es'));
    const carreras = datos.carreras.slice().sort((a, b) =>
      CONFIG.departamentos.indexOf(a.departamento) - CONFIG.departamentos.indexOf(b.departamento) || a.nombre.localeCompare(b.nombre, 'es'));
    $('#principal').innerHTML = '<div class="contenido">' +
      '<div class="seccion-titulo"><div><h2>Coordinadores</h2><p class="meta">Cada quien llena su horario en su agenda; desde aquí puedes abrirla y llenarla por él.</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (Almacen.necesitaSesion ? '<button class="btn chico" data-accesos>Dar acceso</button>' : '') +
      '<button class="btn primario chico" data-nuevo-co>+ Agregar coordinador</button></div></div>' +
      '<div class="lista-equipo">' + (cos.map(co => {
        const suyas = datos.carreras.filter(c => c.coordinador === co.id);
        const horas = Object.values(co.semana || {}).reduce((n, d) => n + Object.keys(d).length, 0) / 2;
        const n = co.activo ? libres7(co) : 0;
        return '<div class="tarjeta ficha-co' + (co.activo ? '' : ' inactivo') + '">' + UI.avatar(co, 52) +
          '<div class="datos"><b>' + esc(Agenda.nombreCompleto(co)) + (co.activo ? '' : ' · <span class="meta">inactivo</span>') + '</b>' +
          '<span class="meta">' + esc(co.correo || 'Sin correo') + '</span>' +
          (Almacen.necesitaSesion ? '<span>' + estadoAcceso(co) + '</span>' : '') +
          (sinLiga(co) ? '<span><span class="insignia r-no_admitido">En línea sin liga válida</span></span>' : '') +
          '<div class="carreras-de">' + (suyas.map(c => '<span>' + esc(c.nombre) + '</span>').join('') || '<span>Sin carrera</span>') + '</div>' +
          '<span class="meta" style="margin-top:6px">' + String(horas).replace('.5', '½') + ' h a la semana · <b style="color:' + (n ? 'var(--ok)' : 'var(--peligro)') + '">' + n + ' libres</b> en 7 días</span>' +
          '<div class="medidor"><i style="width:' + Math.min(100, n / 30 * 100) + '%"></i></div>' +
          '<div class="acciones-co">' +
          (Almacen.necesitaSesion && co.correo ? '<button class="btn primario chico" data-mandar="' + co.id + '">✉ Mandar acceso</button>' : '') +
          '<a class="btn chico" href="' + agendaDe(co.id) + '" target="_blank">Abrir su agenda</a>' +
          '<button class="btn fantasma chico" data-editar-co="' + co.id + '">Editar</button></div></div></div>';
      }).join('') || '<div class="vacio"><b>Todavía no hay coordinadores.</b>Agrega el primero.</div>') + '</div>' +

      '<div class="seccion-titulo" style="margin-top:12px"><div><h2>Carreras</h2><p class="meta">Las que están activas aparecen en la página del prospecto.</p></div>' +
      '<button class="btn primario chico" data-nueva-ca>+ Agregar carrera</button></div>' +
      '<div class="tarjeta tabla-caja"><table class="tabla"><thead><tr><th>Carrera</th><th>Departamento</th><th>Coordinador</th><th>Para prospectos</th><th></th></tr></thead><tbody>' +
      carreras.map(c => '<tr style="cursor:default"><td><b>' + esc(c.nombre) + '</b></td><td>' + esc(c.departamento) + '</td>' +
        '<td><select data-asignar="' + c.id + '" style="min-height:38px;font-size:14.5px"><option value="">Sin asignar</option>' +
        datos.coordinadores.filter(x => x.activo || x.id === c.coordinador).map(x => '<option value="' + x.id + '"' + (x.id === c.coordinador ? ' selected' : '') + '>' + esc(x.nombre) + '</option>').join('') +
        '</select></td>' +
        '<td><label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" data-activa="' + c.id + '"' + (c.activa ? ' checked' : '') +
        ' style="width:20px;height:20px;accent-color:var(--marca-solida)">' + (c.activa ? 'Visible' : 'Oculta') + '</label></td>' +
        '<td><button class="btn fantasma chico" data-editar-ca="' + c.id + '">Editar</button></td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function editarCoordinador(id) {
    const co = datos.coordinadores.find(x => x.id === id) || { titulo: '', nombre: '', correo: '', oficina: '', liga: '', foto: '', activo: true };
    let foto = co.foto;
    const v = UI.ventana(id ? 'Editar coordinador' : 'Nuevo coordinador',
      '<div style="display:flex;gap:14px;align-items:center"><span data-foto>' + UI.avatar(co, 64) + '</span>' +
      '<label class="btn chico">Subir foto<input type="file" accept="image/*" hidden data-archivo></label>' +
      '<button class="btn fantasma chico" data-sin-foto>Quitar</button></div>' +
      '<div class="fila-campos" style="grid-template-columns:110px 1fr">' +
      '<label class="campo"><span>Título</span><input type="text" name="titulo" value="' + esc(co.titulo) + '" placeholder="Mtra."></label>' +
      '<label class="campo"><span>Nombre</span><input type="text" name="nombre" value="' + esc(co.nombre) + '"></label></div>' +
      '<label class="campo"><span>Correo IBERO <em>(con este entra a su agenda)</em></span><input type="email" name="correo" value="' + esc(co.correo) + '" placeholder="nombre@tijuana.ibero.mx"></label>' +
      '<label class="campo"><span>Dónde atiende en persona</span><input type="text" name="oficina" value="' + esc(co.oficina) + '"></label>' +
      '<label class="campo"><span>Liga para entrevistas en línea</span><input type="url" name="liga" value="' + esc(co.liga) + '"></label>' +
      (Almacen.necesitaSesion ? '<div class="campo"><span>Clave temporal para entrar <em>(al entrar pone la suya)</em></span>' +
        '<div style="display:flex;gap:8px"><input type="text" name="clave" autocomplete="off" placeholder="' +
        (!co.tieneClave ? 'Todavía no tiene: no puede entrar'
          : co.claveTemporal ? 'Ya tiene una temporal; genera otra sólo si la perdió'
          : 'Ya puso su clave; genera otra sólo si la olvidó') + '">' +
        '<button class="btn chico" data-generar type="button">Generar</button></div></div>' : '') +
      (id ? '<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="activo"' + (co.activo ? ' checked' : '') +
        ' style="width:20px;height:20px;accent-color:var(--marca-solida)"> Activo <span class="meta">(si lo desactivas, sus carreras dejan de recibir citas)</span></label>' : '') +
      '<div class="pie">' + (id ? '<button class="btn peligro chico" data-borrar>Borrar</button><span style="flex:1"></span>' : '') +
      '<button class="btn fantasma" data-no>Cancelar</button><button class="btn primario" data-si>Guardar</button></div>');
    v.querySelector('[data-archivo]').onchange = async e => {
      try {
        foto = await UI.leerFoto(e.target.files[0]);
        v.querySelector('[data-foto]').innerHTML = UI.avatar({ nombre: co.nombre, foto }, 64);
      } catch (err) { UI.aviso(err.message, 'error'); }
    };
    v.querySelector('[data-sin-foto]').onclick = () => { foto = ''; v.querySelector('[data-foto]').innerHTML = UI.avatar({ nombre: v.querySelector('[name=nombre]').value || co.nombre }, 64); };
    const generar = v.querySelector('[data-generar]');
    if (generar) generar.onclick = () => { v.querySelector('[name=clave]').value = Interno.claveNueva(); };
    v.querySelector('[data-no]').onclick = UI.cerrarVentana;
    v.querySelector('[data-si]').onclick = async () => {
      const val = n => { const el = v.querySelector('[name=' + n + ']'); return el ? el.value.trim() : ''; };
      const clave = val('clave');
      if (clave && !val('correo')) return UI.aviso('Para darle clave, escribe su correo: con ese entra.', 'error');
      if (val('liga') && Agenda.ligaValida(val('liga')) !== 'ok')
        return UI.aviso(Agenda.ligaValida(val('liga')) === 'canal'
          ? 'Esa liga es de un equipo o canal de Teams: los prospectos no pueden entrar. Tiene que ser la de una reunión.'
          : 'La liga tiene que ser una dirección web (https://…).', 'error');
      try {
        const activo = v.querySelector('[name=activo]');
        const r = await Almacen.guardarCoordinador({ id: co.id, titulo: val('titulo'), nombre: val('nombre'), correo: val('correo'),
          oficina: val('oficina'), liga: val('liga'), foto, activo: activo ? activo.checked : true });
        if (clave) {
          await Almacen.claveCoordinador(r.id, clave);
          return mostrarAcceso(r, clave);
        }
        UI.cerrarVentana(); UI.aviso('Guardado.', 'ok'); recargar();
      } catch (err) { UI.aviso(err.message, 'error'); }
    };
    const borrar = v.querySelector('[data-borrar]');
    if (borrar) borrar.onclick = async () => {
      try { await Almacen.borrarCoordinador(id); UI.cerrarVentana(); UI.aviso('Borrado.'); recargar(); }
      catch (err) { UI.aviso(err.message, 'error'); }
    };
  }

  /* ── Accesos de los coordinadores ──────────────────────────
     Admisiones da una clave TEMPORAL; la primera vez que el
     coordinador entra, la agenda le pide poner la suya. */
  function estadoAcceso(co) {
    if (!co.correo) return '<span class="insignia e-cancelada">Falta su correo</span>';
    if (!co.tieneClave) return '<span class="insignia r-no_admitido">Sin acceso</span>';
    if (co.claveTemporal) return '<span class="insignia e-no_asistio">Clave temporal · aún no entra</span>';
    return '<span class="insignia e-realizada">Ya entró</span>';
  }
  const ASUNTO = 'Tu agenda de entrevistas de admisión';
  /* «Juan Manuel Ávalos González» → «Juan Manuel»: todo menos los dos apellidos */
  function pila(co) {
    const p = co.nombre.trim().split(/\s+/);
    return p.length >= 3 ? p.slice(0, -2).join(' ') : p[0];
  }
  /* Outlook de escritorio abre los mailto:; si en esa computadora no
     está como programa de correo, queda la versión del navegador. */
  const aOutlook = (co, texto) => 'mailto:' + co.correo + '?subject=' + encodeURIComponent(ASUNTO) + '&body=' + encodeURIComponent(texto);
  const aOutlookWeb = (co, texto) => 'https://outlook.office.com/mail/deeplink/compose?to=' + encodeURIComponent(co.correo) +
    '&subject=' + encodeURIComponent(ASUNTO) + '&body=' + encodeURIComponent(texto);
  function mensajeAcceso(co, clave) {
    return ['Hola, ' + pila(co) + ':', '',
      'Ya está lista la agenda de entrevistas de admisión. Ahí marcas los horarios en que puedes entrevistar y ves quién agendó contigo.', '',
      'Entra aquí: ' + new URL('coordinador.html', location.href).href,
      'Correo: ' + co.correo,
      'Clave temporal: ' + clave, '',
      'La primera vez te va a pedir que pongas una clave propia.',
      'Si vas a entrevistar en línea, pega en «Mi horario» la liga de tu reunión de Teams; ahí mismo viene cómo sacarla.', '',
      'Admisiones · IBERO Tijuana'].join('\n');
  }
  function fichaMensaje(co, texto) {
    return '<div class="campo"><span>' + esc(Agenda.nombreCompleto(co)) + '</span>' +
      '<textarea readonly style="min-height:200px">' + esc(texto) + '</textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end">' +
      '<a class="btn fantasma chico" href="' + esc(aOutlookWeb(co, texto)) + '" target="_blank" rel="noopener">Outlook en el navegador</a>' +
      '<button class="btn chico" data-copiar>Copiar</button>' +
      '<a class="btn primario chico" href="' + esc(aOutlook(co, texto)) + '">Abrir en Outlook</a></div></div>';
  }
  function copiables(v) {
    v.querySelectorAll('[data-copiar]').forEach(b => b.onclick = async () => {
      const t = b.closest('.campo').querySelector('textarea');
      try { await navigator.clipboard.writeText(t.value); UI.aviso('Copiado.', 'ok'); }
      catch (e) { t.select(); }
    });
  }
  function mostrarAcceso(co, clave) {
    const v = UI.ventana('Acceso de ' + co.nombre.split(' ')[0],
      '<p>Guardado. Mándale esto; la clave temporal no se vuelve a mostrar.</p>' + fichaMensaje(co, mensajeAcceso(co, clave)),
      { sinFoco: true });
    copiables(v);
    recargar();
  }
  /* Desde la tarjeta del coordinador: genera la clave y abre Outlook con
     el mensaje ya escrito; Marysol sólo le da Enviar. */
  function mandarAcceso(id) {
    const co = datos.coordinadores.find(c => c.id === id);
    const v = UI.ventana('Mandar acceso a ' + pila(co),
      '<p>Se genera una <b>clave temporal nueva</b> y se abre Outlook con el mensaje listo para <b>' + esc(co.correo) + '</b>.</p>' +
      (co.tieneClave ? '<p class="meta">' + (co.claveTemporal ? 'Ya se le había mandado una' : 'Ya había entrado con su propia clave') +
        ': esa deja de servir y tendrá que usar la nueva.</p>' : '') +
      '<div class="pie"><button class="btn fantasma" data-no>Cancelar</button><button class="btn primario" data-si>Abrir en Outlook</button></div>',
      { sinFoco: true });
    v.querySelector('[data-no]').onclick = UI.cerrarVentana;
    v.querySelector('[data-si]').onclick = async () => {
      try {
        const clave = Interno.claveNueva();
        await Almacen.claveCoordinador(co.id, clave);
        const texto = mensajeAcceso(co, clave);
        UI.abrir(aOutlook(co, texto));
        const w = UI.ventana('Mensaje para ' + pila(co),
          '<p>Se abrió Outlook con el mensaje. Si no apareció, ábrelo en el navegador o cópialo. La clave temporal no se vuelve a mostrar.</p>' +
          fichaMensaje(co, texto), { sinFoco: true });
        copiables(w);
        recargar();
      } catch (e) { UI.aviso(e.message, 'error'); }
    };
  }

  /* Varios a la vez: los que tienen correo y todavía no tienen acceso
     van palomeados; a los demás se les puede regenerar si la perdieron. */
  function darAccesos() {
    const cos = datos.coordinadores.filter(c => c.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const v = UI.ventana('Dar acceso a coordinadores',
      '<p class="meta">Se genera una clave temporal para cada uno y te sale su mensaje listo. Los que no tienen correo no se pueden elegir: captúralo en «Editar».</p>' +
      '<div style="display:grid;gap:8px">' + cos.map(c => '<label style="display:flex;gap:10px;align-items:center;' + (c.correo ? 'cursor:pointer' : 'opacity:.55') + '">' +
        '<input type="checkbox" value="' + c.id + '"' + (c.correo ? '' : ' disabled') + (c.correo && !c.tieneClave ? ' checked' : '') +
        ' style="width:20px;height:20px;accent-color:var(--marca-solida)">' +
        '<span style="flex:1"><b>' + esc(Agenda.nombreCompleto(c)) + '</b><span class="meta" style="display:block">' + esc(c.correo || 'sin correo') + '</span></span>' +
        estadoAcceso(c) + '</label>').join('') + '</div>' +
      '<div class="pie"><button class="btn fantasma" data-no>Cancelar</button><button class="btn primario" data-si>Generar claves</button></div>',
      { ancha: true, sinFoco: true });
    v.querySelector('[data-no]').onclick = UI.cerrarVentana;
    v.querySelector('[data-si]').onclick = async () => {
      const ids = [...v.querySelectorAll('input:checked')].map(x => x.value);
      if (!ids.length) return UI.aviso('Palomea al menos a uno.', 'error');
      const hechos = [];
      try {
        for (const id of ids) {
          const co = datos.coordinadores.find(c => c.id === id);
          const clave = Interno.claveNueva();
          await Almacen.claveCoordinador(id, clave);
          hechos.push([co, mensajeAcceso(co, clave)]);
        }
      } catch (e) { UI.aviso(e.message, 'error'); }
      if (!hechos.length) return;
      const w = UI.ventana(hechos.length === 1 ? 'Su mensaje' : 'Sus ' + hechos.length + ' mensajes',
        '<p>Mándale a cada quien el suyo. Las claves temporales no se vuelven a mostrar.</p>' +
        hechos.map(([co, t]) => fichaMensaje(co, t)).join(''), { ancha: true, sinFoco: true });
      copiables(w);
      recargar();
    };
  }

  function editarCarrera(id) {
    const c = datos.carreras.find(x => x.id === id) || { nombre: '', departamento: CONFIG.departamentos[0], coordinador: '' };
    const v = UI.ventana(id ? 'Editar carrera' : 'Nueva carrera',
      '<label class="campo"><span>Nombre</span><input type="text" name="nombre" value="' + esc(c.nombre) + '"></label>' +
      '<label class="campo"><span>Departamento</span><select name="departamento">' +
      CONFIG.departamentos.map(d => '<option' + (d === c.departamento ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select></label>' +
      '<label class="campo"><span>Coordinador</span><select name="coordinador"><option value="">Sin asignar</option>' +
      datos.coordinadores.filter(x => x.activo).map(x => '<option value="' + x.id + '"' + (x.id === c.coordinador ? ' selected' : '') + '>' + esc(Agenda.nombreCompleto(x)) + '</option>').join('') +
      '</select></label>' +
      '<div class="pie">' + (id ? '<button class="btn peligro chico" data-borrar>Borrar</button><span style="flex:1"></span>' : '') +
      '<button class="btn fantasma" data-no>Cancelar</button><button class="btn primario" data-si>Guardar</button></div>');
    v.querySelector('[data-no]').onclick = UI.cerrarVentana;
    v.querySelector('[data-si]').onclick = async () => {
      const val = n => v.querySelector('[name=' + n + ']').value;
      try {
        await Almacen.guardarCarrera({ id: c.id, nombre: val('nombre'), departamento: val('departamento'), coordinador: val('coordinador') });
        UI.cerrarVentana(); UI.aviso('Guardado.', 'ok'); recargar();
      } catch (err) { UI.aviso(err.message, 'error'); }
    };
    const borrar = v.querySelector('[data-borrar]');
    if (borrar) borrar.onclick = async () => {
      try { await Almacen.borrarCarrera(id); UI.cerrarVentana(); UI.aviso('Borrada.'); recargar(); }
      catch (err) { UI.aviso(err.message, 'error'); }
    };
  }

  /* ── Ajustes ───────────────────────────────────────────── */
  function pintarAjustes() {
    const a = datos.ajustes;
    const opciones = (nombre, lista, sufijo) => '<select data-ajuste="' + nombre + '">' +
      lista.map(n => '<option value="' + n + '"' + (a[nombre] === n ? ' selected' : '') + '>' + n + ' ' + sufijo + '</option>').join('') + '</select>';
    const horas = [];
    for (let h = 6; h <= 22; h++) horas.push(h);
    const hora = (nombre, lista) => '<select data-ajuste="' + nombre + '">' +
      lista.map(h => '<option value="' + h + '"' + (a[nombre] === h ? ' selected' : '') + '>' + Agenda.horaBonita(Agenda.aHora(h * 60)) + '</option>').join('') + '</select>';
    $('#principal').innerHTML = '<div class="contenido" style="max-width:720px">' +
      '<div><h2>Ajustes</h2><p class="meta">Se aplican al momento en las tres vistas.</p></div>' +
      '<div class="tarjeta" style="padding:22px;display:grid;gap:18px">' +
      '<label class="campo"><span>Duración de cada entrevista</span>' + opciones('duracion', [15, 20, 30, 45, 60], 'minutos') +
      '<small class="meta">Las citas ya agendadas conservan la duración con la que se hicieron.</small></label>' +
      '<label class="campo"><span>Anticipación mínima para agendar</span>' + opciones('anticipacion', [2, 12, 24, 48, 72], 'horas') + '</label>' +
      '<label class="campo"><span>Hasta cuándo pueden agendar los prospectos</span>' + opciones('diasAdelante', [7, 14, 21, 30, 45, 60], 'días hacia adelante') + '</label>' +
      '<div class="fila-campos"><label class="campo"><span>La rejilla de horarios empieza a las</span>' + hora('horaInicio', horas.slice(0, -1)) + '</label>' +
      '<label class="campo"><span>y termina a las</span>' + hora('horaFin', horas.slice(1)) + '</label></div>' +
      '</div>' +
      (Almacen.necesitaSesion ? '<div class="tarjeta" style="padding:22px;display:grid;gap:10px"><h3>Mi clave</h3>' +
        '<p class="meta">La de la cuenta «' + esc(Almacen.sesion().quien) + '» con la que entras a este Admin.</p>' +
        '<div><button class="btn chico" id="mi-clave">Cambiar mi clave</button></div></div>' : '') +
      (CONFIG.modoPrueba ? '<div class="tarjeta" style="padding:22px;display:grid;gap:10px"><h3>Datos de ejemplo</h3>' +
        '<p class="meta">Borra todo lo de este navegador (también lo cargado del Excel) y vuelve a poner las carreras, coordinadores, prospectos y citas de ejemplo.</p>' +
        '<div><button class="btn chico" id="reiniciar">Reiniciar el prototipo</button></div></div>' : '') +
      '</div>';
    document.querySelectorAll('[data-ajuste]').forEach(el => el.onchange = async () => {
      const k = el.dataset.ajuste;
      const valor = el.type === 'checkbox' ? el.checked : +el.value;
      if (k === 'horaInicio' && valor >= datos.ajustes.horaFin) return UI.aviso('La hora de inicio debe ser antes de la de fin.', 'error'), pintar();
      if (k === 'horaFin' && valor <= datos.ajustes.horaInicio) return UI.aviso('La hora de fin debe ser después de la de inicio.', 'error'), pintar();
      await Almacen.guardarAjustes({ [k]: valor });
      datos = await Almacen.cargar();
      UI.aviso('Guardado.', 'ok');
    });
    if ($('#mi-clave')) $('#mi-clave').onclick = Interno.cambiarClave;
    const r = $('#reiniciar');
    if (r) r.onclick = async () => { datos = await Almacen.reiniciar(); ultimoResumen = null; ciclo = ''; UI.aviso('Prototipo como nuevo.', 'ok'); pintar(); };
  }

  /* ── Clics del contenido ───────────────────────────────── */
  $('#principal').addEventListener('click', e => {
    const t = e.target.closest('[data-avisar-citas],[data-mandar],[data-accesos],[data-habilitar],[data-cita],[data-periodo],[data-ir],[data-nuevo-co],[data-editar-co],[data-nueva-ca],[data-editar-ca],[data-ciclo],[data-sit]');
    if (!t) return;
    const d = t.dataset;
    if (d.habilitar) Almacen.habilitar(d.habilitar, !!d.si, QUIEN).then(recargar);
    else if ('ciclo' in d) { ciclo = d.ciclo; pintar(); }
    else if ('sit' in d) { filtroP.situacion = d.sit; pintar(); }
    else if (d.cita) Interno.ficha(d.cita, QUIEN, recargar);
    else if (d.periodo) { filtro.periodo = d.periodo; pintar(); }
    else if (d.ir) { vista = d.ir; pintar(); }
    else if ('nuevoCo' in d) editarCoordinador(null);
    else if ('accesos' in d) darAccesos();
    else if (d.mandar) mandarAcceso(d.mandar);
    else if ('avisarCitas' in d) Interno.avisarCitas(silencioso => silencioso ? Almacen.cargar().then(x => { datos = x; }) : recargar());
    else if (d.editarCo) editarCoordinador(d.editarCo);
    else if ('nuevaCa' in d) editarCarrera(null);
    else if (d.editarCa) editarCarrera(d.editarCa);
  });
  $('#principal').addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.asignar) {
      await Almacen.guardarCarrera({ id: t.dataset.asignar, coordinador: t.value });
      UI.aviso('Asignado.', 'ok'); recargar();
    } else if (t.dataset.activa) {
      await Almacen.guardarCarrera({ id: t.dataset.activa, activa: t.checked });
      recargar();
    }
  });

  (async () => {
    if (Almacen.necesitaSesion) {
      if (!Almacen.sesion()) {
        $('#pestanas').classList.add('oculto');
        await Interno.pantallaEntrar($('#principal'), 'Admin de entrevistas', 'Para Admisiones. Con el usuario y la clave de la agenda.');
        $('#pestanas').classList.remove('oculto');
      }
      if (Almacen.sesion().rol !== 'admin') {
        $('#pestanas').classList.add('oculto');
        $('#principal').innerHTML = '<div class="tarjeta entrar"><h2>Esta parte es de Admisiones</h2>' +
          '<p class="meta">Entraste como coordinador. Tu agenda está en otra página.</p>' +
          '<a class="btn primario" href="coordinador.html">Ir a mi agenda</a></div>';
        return;
      }
      const salir = document.createElement('button');
      salir.className = 'btn fantasma chico';
      salir.textContent = 'Salir';
      salir.onclick = async () => { await Almacen.salir(); location.reload(); };
      $('.barra-app .dentro').appendChild(salir);
    }
    try { datos = await Almacen.cargar(); }
    catch (e) { if (e.message === 'SIN_SESION') return location.reload(); throw e; }
    pintar();
    UI.etiquetaPrueba();
    /* el prospecto agenda en otra pestaña → aquí aparece solo */
    Almacen.alCambiar(() => { if (!document.querySelector('.velo') && vista !== 'ajustes') recargar(); });
    if (!datos.importado) ultimoResumen = null;
  })();
})();
