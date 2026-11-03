/* ═══════════════════════════════════════════════════════════
   Piezas compartidas por las vistas internas (coordinador y Admin)

   La ficha de una cita (estado, nota, cambiar, cancelar), el
   selector para moverla y la tabla de citas agrupada por día. Las
   dos vistas las usan igual; lo único que cambia es quién firma
   en el historial.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Interno = (() => {
  const { esc } = UI;
  const ICONO = {
    presencial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    linea: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/></svg>',
  };
  const modalidad = m => '<span class="mod">' + ICONO[m] + Agenda.MODALIDADES[m] + '</span>';
  const insignia = e => '<span class="insignia e-' + e + '">' + Agenda.ESTADOS[e] + '</span>';
  const resultado = r => '<span class="insignia r-' + r + '">' + Agenda.RESULTADOS[r] + '</span>';
  const tel = t => String(t || '').replace(/\D/g, '');

  /* ── Tabla de citas, agrupada por día ──────────────────── */
  function tabla(citas, datos, op = {}) {
    if (!citas.length) return '<div class="vacio"><b>' + (op.vacio || 'No hay citas.') + '</b></div>';
    const hoy = Agenda.hoy();
    const porDia = {};
    citas.forEach(c => (porDia[c.fecha] = porDia[c.fecha] || []).push(c));
    const fechas = Object.keys(porDia).sort();
    if (op.descendente) fechas.reverse();
    const cols = op.conCoordinador ? 6 : 5;
    return '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Hora</th><th>Prospecto</th><th>Carrera</th>' +
      (op.conCoordinador ? '<th>Coordinador</th>' : '') + '<th>Modalidad</th><th>Estado</th></tr></thead><tbody>' +
      fechas.map(f => {
        const etiqueta = (f === hoy ? 'Hoy · ' : f === Agenda.sumar(hoy, 1) ? 'Mañana · ' : '') + Agenda.mayus(Agenda.fechaLarga(f));
        return '<tr class="dia-grupo' + (f === hoy ? ' hoy-grupo' : '') + '"><td colspan="' + cols + '">' + etiqueta + '</td></tr>' +
          porDia[f].sort((a, b) => a.hora.localeCompare(b.hora)).map(c => {
            const carrera = datos.carreras.find(x => x.id === c.carrera) || { nombre: '—' };
            const co = datos.coordinadores.find(x => x.id === c.coordinador);
            return '<tr data-cita="' + c.id + '"><td><b>' + Agenda.horaBonita(c.hora) + '</b></td>' +
              '<td><b>' + esc(c.nombre) + '</b><span class="meta">' + esc(c.matricula) + '</span></td>' +
              '<td>' + esc(carrera.nombre) + '</td>' +
              (op.conCoordinador ? '<td>' + esc(co ? co.nombre : '—') + '</td>' : '') +
              '<td>' + modalidad(c.modalidad) + '</td><td>' + insignia(c.estado) +
              (c.resultado ? ' ' + resultado(c.resultado) : '') + '</td></tr>';
          }).join('');
      }).join('') + '</tbody></table></div>';
  }

  /* ── Ficha de una cita ─────────────────────────────────── */
  async function ficha(id, quien, alCambiar) {
    const datos = await Almacen.cargar();
    const c = datos.citas.find(x => x.id === id);
    if (!c) return UI.aviso('Esa cita ya no existe.', 'error');
    const co = datos.coordinadores.find(x => x.id === c.coordinador);
    const carrera = datos.carreras.find(x => x.id === c.carrera) || { nombre: '—' };
    const s = datos.solicitantes.find(x => x.matricula === c.matricula) || {};
    const v = UI.ventana(c.nombre,
      '<div class="detalle"><dl>' +
      '<dt>Cuándo</dt><dd>' + esc(Agenda.mayus(Agenda.fechaLarga(c.fecha))) + ', ' + Agenda.horaBonita(c.hora) + ' (' + c.duracion + ' min)</dd>' +
      '<dt>Modalidad</dt><dd>' + modalidad(c.modalidad) + '</dd>' +
      '<dt>Carrera</dt><dd>' + esc(carrera.nombre) + '</dd>' +
      '<dt>Coordinador</dt><dd>' + esc(Agenda.nombreCompleto(co)) + '</dd>' +
      '<dt>Matrícula</dt><dd>' + esc(c.matricula) + (s.ciclo ? ' · ' + esc(s.ciclo) : '') + '</dd>' +
      (s.resultado ? '<dt>Examen</dt><dd>' + esc(s.resultado) + (s.promedio ? ' · promedio: ' + esc(s.promedio) : '') +
        (s.habilitadoPor ? '<br><span class="meta">Habilitado por ' + esc(s.habilitadoPor) + '</span>' : '') + '</dd>' : '') +
      (s.escuela ? '<dt>Procedencia</dt><dd>' + esc(s.escuela) + '</dd>' : '') +
      (s.observaciones ? '<dt>Admisiones</dt><dd>' + esc(s.observaciones) + '</dd>' : '') +
      '<dt>Correo</dt><dd><a href="mailto:' + esc(c.correo) + '">' + esc(c.correo) + '</a></dd>' +
      '<dt>Celular</dt><dd>' + esc(c.telefono) + (tel(c.telefono) ? ' · <a href="https://wa.me/52' + tel(c.telefono).slice(-10) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') + '</dd>' +
      '<dt>Número</dt><dd>' + esc(c.id) + '</dd>' +
      '</dl></div>' +
      '<div class="campo"><span>¿Cómo fue?</span><div class="botones-estado">' +
      ['agendada', 'realizada', 'no_asistio'].map(e => '<button class="btn chico insignia e-' + e + (c.estado === e ? ' activo' : '') +
        '" data-estado="' + e + '">' + Agenda.ESTADOS[e] + '</button>').join('') +
      (c.estado === 'cancelada' ? insignia('cancelada') : '') + '</div></div>' +
      '<div class="campo"><span>Resultado de la entrevista <em>(lo que va al Excel de Admisiones)</em></span><div class="botones-estado">' +
      ['admitido', 'no_admitido'].map(r => '<button class="btn chico insignia r-' + r + (c.resultado === r ? ' activo' : '') +
        '" data-resultado="' + r + '">' + Agenda.RESULTADOS[r] + '</button>').join('') + '</div></div>' +
      '<label class="campo"><span>Nota de la entrevista <em>(sólo la ven coordinación y Admisiones)</em></span>' +
      '<textarea name="nota" placeholder="Impresiones, acuerdos, lo que haga falta recordar">' + esc(c.nota) + '</textarea></label>' +
      '<details><summary class="meta" style="cursor:pointer">Corregir datos de contacto</summary>' +
      '<div class="fila-campos" style="margin-top:12px">' +
      '<label class="campo"><span>Celular</span><input type="tel" name="telefono" value="' + esc(c.telefono) + '"></label>' +
      '<label class="campo"><span>Correo</span><input type="email" name="correo" value="' + esc(c.correo) + '"></label>' +
      '</div><p class="meta" style="margin-top:8px">Nombre y matrícula vienen del Excel de Admisiones; se corrigen allá.</p></details>' +
      '<details><summary class="meta" style="cursor:pointer">Historial</summary><ul class="historial" style="margin-top:8px">' +
      (c.historial || []).map(h => '<li>' + new Date(h.cuando).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) +
        ' · <b>' + esc(h.quien) + '</b> · ' + esc(h.que) + '</li>').join('') + '</ul></details>' +
      '<div class="pie">' +
      (c.estado !== 'cancelada' ? '<button class="btn peligro chico" data-cancelar>Cancelar cita</button>' : '') +
      '<button class="btn chico" data-mover>' + (c.estado === 'cancelada' ? 'Reagendar' : 'Cambiar horario') + '</button>' +
      '<span style="flex:1"></span><button class="btn primario" data-guardar>Guardar</button></div>', { sinFoco: true });

    let estado = c.estado, res = c.resultado || '';
    v.querySelectorAll('[data-estado]').forEach(b => b.onclick = () => {
      estado = b.dataset.estado;
      v.querySelectorAll('[data-estado]').forEach(x => x.classList.toggle('activo', x === b));
    });
    /* el resultado implica que la entrevista se hizo; tocar el activo lo quita */
    v.querySelectorAll('[data-resultado]').forEach(b => b.onclick = () => {
      res = res === b.dataset.resultado ? '' : b.dataset.resultado;
      v.querySelectorAll('[data-resultado]').forEach(x => x.classList.toggle('activo', x.dataset.resultado === res));
      if (res && estado !== 'cancelada') v.querySelector('[data-estado=realizada]').click();
    });
    v.querySelector('[data-guardar]').onclick = async () => {
      const campo = n => v.querySelector('[name=' + n + ']').value.trim();
      const cambios = { nota: campo('nota'), resultado: res };
      if (estado !== c.estado && c.estado !== 'cancelada') cambios.estado = estado;
      ['telefono', 'correo'].forEach(n => {
        const val = n === 'correo' ? campo(n).toLowerCase() : campo(n);
        if (val && val !== c[n]) cambios[n] = val;
      });
      await Almacen.actualizarCita(c.id, cambios, quien);
      UI.cerrarVentana(); UI.aviso('Guardado.', 'ok');
      alCambiar && alCambiar();
    };
    const cancelar = v.querySelector('[data-cancelar]');
    if (cancelar) cancelar.onclick = () => {
      const w = UI.ventana('¿Cancelar la cita de ' + c.nombre.split(' ')[0] + '?',
        '<p>El horario se libera para otro prospecto. Avísale a ' + esc(c.nombre.split(' ')[0]) + ' por correo o WhatsApp.</p>' +
        '<label class="campo"><span>Motivo <em>(opcional, queda en el historial)</em></span><input type="text" name="motivo"></label>' +
        '<div class="pie"><button class="btn fantasma" data-no>No</button><button class="btn primario" data-si>Sí, cancelar</button></div>');
      w.querySelector('[data-no]').onclick = () => ficha(id, quien, alCambiar);
      w.querySelector('[data-si]').onclick = async () => {
        await Almacen.cancelarCita(c.id, quien, w.querySelector('[name=motivo]').value.trim());
        UI.cerrarVentana(); UI.aviso('Cita cancelada.');
        alCambiar && alCambiar();
      };
    };
    v.querySelector('[data-mover]').onclick = () => mover(c, quien, alCambiar);
  }

  /* ── Mover una cita ────────────────────────────────────────
     Desde dentro no se exige la anticipación: si coordinación
     acuerda con el prospecto verse mañana, se puede. */
  async function mover(c, quien, alCambiar) {
    const datos = await Almacen.cargar();
    const co = datos.coordinadores.find(x => x.id === c.coordinador);
    let mod = c.modalidad, fecha = null, hora = null;
    const v = UI.ventana('Nuevo horario para ' + c.nombre.split(' ')[0],
      '<div class="centro" style="margin:0"><div class="selector" data-mods></div></div>' +
      '<div class="dias" data-dias style="margin-top:0"></div><div class="horas" data-horas></div>' +
      '<p class="meta">Sólo aparecen los horarios libres de ' + esc(Agenda.nombreCompleto(co)) +
      '. Si no ves el que acordaron, primero ábrelo en su horario.</p>' +
      '<div class="pie"><button class="btn fantasma" data-volver>Volver</button><button class="btn primario" data-ok disabled>Mover aquí</button></div>',
      { ancha: true, sinFoco: true });
    function pintar() {
      v.querySelector('[data-mods]').innerHTML = ['presencial', 'linea'].map(m =>
        '<button data-mod="' + m + '" class="' + (m === mod ? 'activo' : '') + '">' + ICONO[m] + Agenda.MODALIDADES[m] + '</button>').join('');
      const dias = Agenda.proximos(co, datos, { modalidad: mod, ignorar: c.id, sinAnticipacion: true, dias: 35 });
      if (!fecha || !dias.some(d => d.fecha === fecha && d.espacios.length)) {
        const p = dias.find(d => d.espacios.length); fecha = p ? p.fecha : null; hora = null;
      }
      v.querySelector('[data-dias]').innerHTML = dias.map(d => '<button class="dia' + (d.fecha === fecha ? ' activo' : '') +
        '" data-fecha="' + d.fecha + '"' + (d.espacios.length ? '' : ' disabled') + '><small>' + Agenda.fechaCorta(d.fecha).split(' ')[0] +
        '</small><b>' + Agenda.aFecha(d.fecha).getDate() + '</b><small>' + Agenda.fechaCorta(d.fecha).split(' ')[2] + '</small></button>').join('');
      const dia = dias.find(d => d.fecha === fecha);
      v.querySelector('[data-horas]').innerHTML = dia ? dia.espacios.map(e => '<button class="hora' + (e.hora === hora ? ' activo' : '') +
        '" data-hora="' + e.hora + '">' + Agenda.horaBonita(e.hora) + '</button>').join('') :
        '<div class="vacio">No hay horarios libres en esta modalidad.</div>';
      v.querySelector('[data-ok]').disabled = !hora;
    }
    v.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.mod) { mod = b.dataset.mod; hora = null; pintar(); }
      else if (b.dataset.fecha) { fecha = b.dataset.fecha; hora = null; pintar(); }
      else if (b.dataset.hora) { hora = b.dataset.hora; pintar(); }
      else if ('volver' in b.dataset) ficha(c.id, quien, alCambiar);
      else if ('ok' in b.dataset) {
        try {
          await Almacen.moverCita(c.id, fecha, hora, mod, quien);
          UI.cerrarVentana(); UI.aviso('Cita movida al ' + Agenda.fechaCorta(fecha) + ', ' + Agenda.horaBonita(hora) + '.', 'ok');
          alCambiar && alCambiar();
        } catch (err) { UI.aviso(err.message === 'OCUPADO' ? 'Ese horario se acaba de ocupar.' : err.message, 'error'); }
      }
    });
    pintar();
  }

  /* ── Solicitantes del Excel que aún no tienen cita ─────────
     «Por agendar» = pueden y no han agendado (o faltaron).
     «A consideración» = el coordinador decide si los entrevista. */
  const norm = t => Importar.norm(t);
  function deCarreras(datos, idsCarrera) {
    const nombres = datos.carreras.filter(c => idsCarrera.includes(c.id)).map(c => norm(c.nombre));
    return datos.solicitantes.filter(s => !s.fuera && nombres.includes(norm(s.licenciatura)));
  }
  function sinCita(s, datos) {
    const hoy = Agenda.hoy();
    return !datos.citas.some(c => c.matricula === s.matricula &&
      (c.estado === 'realizada' || (c.estado === 'agendada' && c.fecha >= hoy)));
  }
  function porAgendar(lista, datos) { return lista.filter(s => Agenda.permiso(s) === 'ok' && sinCita(s, datos)); }
  function aConsideracion(lista) {
    return lista.filter(s => /^a consideraci/i.test(norm(s.resultado)));
  }
  function tablaSolicitantes(lista, op = {}) {
    if (!lista.length) return '<div class="vacio"><b>' + (op.vacio || 'Nadie en esta lista.') + '</b></div>';
    return '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Solicitante</th><th>Licenciatura</th><th>Examen</th><th>Correo</th><th></th></tr></thead><tbody>' +
      lista.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(s => {
        const consid = /^a consideraci/i.test(norm(s.resultado));
        return '<tr style="cursor:default"><td><b>' + esc(Agenda.titulo(s.nombre)) + '</b><span class="meta">' + esc(s.matricula) +
          (s.ciclo ? ' · ' + esc(s.ciclo) : '') + '</span></td>' +
          '<td>' + esc(s.licenciatura) + '</td>' +
          '<td>' + esc(s.resultado || '—') + (s.promedio && s.promedio !== 'Cumple' ? '<span class="meta">Promedio: ' + esc(s.promedio) + '</span>' : '') +
          (s.observaciones ? '<span class="meta">' + esc(s.observaciones) + '</span>' : '') + '</td>' +
          '<td>' + (s.correo ? '<a href="mailto:' + esc(s.correo) + '">' + esc(s.correo) + '</a>' : '<span class="meta">Sin correo</span>') + '</td>' +
          '<td style="text-align:right">' + (consid
            ? '<button class="btn chico' + (s.habilitado ? ' fantasma' : ' primario') + '" data-habilitar="' + esc(s.matricula) + '" data-si="' + (s.habilitado ? '' : '1') + '">' +
              (s.habilitado ? 'Quitar permiso' : 'Lo entrevisto') + '</button>' +
              (s.habilitado ? '<span class="meta">Ya puede agendar</span>' : '')
            : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ── Entrar (sólo con la base de verdad) ───────────────────
     Coordinadores con su correo; Admisiones con su usuario. La clave
     es propia de la agenda y la da Admisiones. */
  function pantallaEntrar(contenedor, titulo, ayuda) {
    return new Promise(listo => {
      contenedor.innerHTML = '<form class="tarjeta entrar" novalidate>' +
        '<span class="rotulo" style="justify-content:center"><b>IBERO Tijuana</b><span class="barra">/</span>Admisiones</span>' +
        '<h2>' + esc(titulo) + '</h2><p class="meta">' + ayuda + '</p>' +
        '<label class="campo" style="text-align:left"><span>Correo o usuario</span><input type="text" name="usuario" autocomplete="username"></label>' +
        '<label class="campo" style="text-align:left"><span>Clave</span><input type="password" name="clave" autocomplete="current-password"></label>' +
        '<p class="aviso-campo oculto" data-error></p>' +
        '<button class="btn primario">Entrar</button></form>';
      const f = contenedor.querySelector('form');
      setTimeout(() => f.usuario.focus(), 30);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const err = f.querySelector('[data-error]');
        const boton = f.querySelector('button');
        boton.disabled = true;
        try {
          const s = await Almacen.entrar(f.usuario.value, f.clave.value);
          listo({ sesion: s, clave: f.clave.value });
        } catch (x) {
          err.textContent = x.message; err.classList.remove('oculto');
          f.clave.select();
        } finally { boton.disabled = false; }
      });
    });
  }

  /* La primera vez que un coordinador entra con la clave temporal que
     le dio Admisiones, pone la suya antes de ver su agenda. Si recién
     la escribió al entrar, no se le vuelve a pedir. */
  function pantallaClaveNueva(contenedor, temporal) {
    return new Promise(listo => {
      contenedor.innerHTML = '<form class="tarjeta entrar" novalidate>' +
        '<span class="rotulo" style="justify-content:center"><b>IBERO Tijuana</b><span class="barra">/</span>Admisiones</span>' +
        '<h2>Pon tu propia clave</h2><p class="meta">La que te mandaron es temporal. Escoge una que sólo tú sepas; con ella entrarás de aquí en adelante.</p>' +
        (temporal ? '' : '<label class="campo" style="text-align:left"><span>Clave que te mandaron</span><input type="password" name="actual" autocomplete="current-password"></label>') +
        '<label class="campo" style="text-align:left"><span>Tu clave nueva <em>(mínimo 6 caracteres)</em></span><input type="password" name="nueva" autocomplete="new-password"></label>' +
        '<label class="campo" style="text-align:left"><span>Escríbela otra vez</span><input type="password" name="otra" autocomplete="new-password"></label>' +
        '<p class="aviso-campo oculto" data-error></p>' +
        '<button class="btn primario">Guardar y entrar</button></form>';
      const f = contenedor.querySelector('form');
      setTimeout(() => (f.actual || f.nueva).focus(), 30);
      f.addEventListener('submit', async e => {
        e.preventDefault();
        const err = f.querySelector('[data-error]');
        const decir = t => { err.textContent = t; err.classList.remove('oculto'); };
        if (f.nueva.value.length < 6) return decir('La clave nueva debe tener al menos 6 caracteres.');
        if (f.nueva.value !== f.otra.value) return decir('Las dos no coinciden. Escríbela igual en ambos campos.');
        const boton = f.querySelector('button');
        boton.disabled = true;
        try {
          await Almacen.miClave(temporal || f.actual.value, f.nueva.value);
          UI.aviso('Listo, ya tienes tu clave.', 'ok');
          listo();
        } catch (x) {
          decir(x.message === 'La clave actual no coincide.' ? 'La clave que te mandaron no coincide. Revísala en el mensaje.' : x.message);
        } finally { boton.disabled = false; }
      });
    });
  }

  /* Cambiar la clave propia */
  function cambiarClave() {
    const v = UI.ventana('Cambiar mi clave',
      '<label class="campo"><span>Clave actual</span><input type="password" name="actual" autocomplete="current-password"></label>' +
      '<label class="campo"><span>Clave nueva <em>(mínimo 6 caracteres)</em></span><input type="password" name="nueva" autocomplete="new-password"></label>' +
      '<div class="pie"><button class="btn fantasma" data-no>Cancelar</button><button class="btn primario" data-si>Cambiar</button></div>');
    v.querySelector('[data-no]').onclick = UI.cerrarVentana;
    v.querySelector('[data-si]').onclick = async () => {
      try {
        await Almacen.miClave(v.querySelector('[name=actual]').value, v.querySelector('[name=nueva]').value);
        UI.cerrarVentana(); UI.aviso('Listo, ya cambió tu clave.', 'ok');
      } catch (e) { UI.aviso(e.message, 'error'); }
    };
  }

  /* Clave legible para dar a un coordinador: sin 0/O ni 1/l */
  function claveNueva() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const b = new Uint8Array(8); crypto.getRandomValues(b);
    const t = Array.from(b, x => abc[x % abc.length]).join('');
    return t.slice(0, 4) + '-' + t.slice(4);
  }

  return { tabla, ficha, mover, modalidad, insignia, resultado, ICONO,
           deCarreras, sinCita, porAgendar, aConsideracion, tablaSolicitantes,
           pantallaEntrar, pantallaClaveNueva, cambiarClave, claveNueva };
})();
