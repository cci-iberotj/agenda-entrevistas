/* ═══════════════════════════════════════════════════════════
   Almacén · dónde vive todo

   Una sola puerta para las tres vistas (prospecto, coordinador y
   Admin). CONFIG.motor elige:
     'local' → el navegador (prototipo y modo prueba)
     'nube'  → la base de LA PIZARRA, esquema «admisiones», siempre a
               través de las funciones adm_* (supabase/esquema.sql).
   Los dos devuelven lo mismo; las páginas no saben cuál está detrás.

   Forma de los datos:
     ajustes:       ver CONFIG.ajustes
     carreras:      { id, nombre, departamento, coordinador, activa }
     coordinadores: { id, titulo, nombre, correo, oficina, liga, foto,
                      semana: { lun: { '09:00': 'a' | 'p' | 'l' } },
                      bloqueos: [{ id, fecha, desde?, hasta?, motivo }],
                      activo }
     solicitantes:  { matricula, nombre, licenciatura, ciclo, correo,
                      resultado, promedio, observaciones, escuela, tipo,
                      oportunidad, habilitado, fuera }   <- del Excel de Admisiones
     citas:         { id, matricula, nombre, correo, telefono, carrera,
                      coordinador, fecha, hora, duracion, modalidad,
                      estado: 'agendada'|'realizada'|'no_asistio'|'cancelada',
                      resultado: '' | 'admitido' | 'no_admitido',
                      nota, creado, historial: [{ cuando, que, quien }] }

   En la semana del coordinador cada celda es media hora:
   'a' = presencial y en línea · 'p' = sólo presencial · 'l' = sólo en línea.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Almacen = (() => {
  const LLAVE = 'agenda-entrevistas.datos';
  const LLAVE_SESION = 'agenda-entrevistas.sesion';
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sin 0/O/1/I/L

  function codigo(n = 6) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return Array.from(b, x => ABC[x % ABC.length]).join('');
  }
  const ahora = () => new Date().toISOString();
  function vacio() {
    return { ajustes: Object.assign({}, CONFIG.ajustes), carreras: [], coordinadores: [], citas: [], solicitantes: [] };
  }

  /* La carrera del solicitante, por el nombre de su licenciatura. */
  function carreraDe(d, s) {
    const n = Importar.norm(s.licenciatura);
    return d.carreras.find(x => x.activa && Importar.norm(x.nombre) === n) || null;
  }
  /* Departamento según el organigrama 2026, por palabra clave. */
  function departamentoDe(nombre) {
    const n = Importar.norm(nombre);
    if (/medicina|enfermer|nutricion|psicolog/.test(n)) return CONFIG.departamentos[2];
    if (/arquitect|ingenier/.test(n)) return CONFIG.departamentos[0];
    return CONFIG.departamentos[1];
  }

  /* Junta lo leído del Excel con lo que ya hay (la usan los dos motores).
     Si lo que hay son los datos de ejemplo, los reemplaza. Si no:
     · solicitantes por matrícula: se actualiza lo que viene del Excel
       y se conserva lo de aquí (habilitado, correo que dio el
       prospecto); los que ya no vienen se marcan «fuera»
     · carreras por nombre; coordinadores por nombre: horarios,
       oficina, liga y foto se conservan. */
  function fusionar(d, leido, nombreArchivo) {
    const norm = Importar.norm;
    const resumen = { nuevos: 0, actualizados: 0, fuera: 0, carrerasNuevas: 0, coordinadoresNuevos: 0 };
    if (d.origen === 'ejemplo') {
      const ajustes = d.ajustes;
      d = vacio();
      d.ajustes = ajustes;
      resumen.reemplazoEjemplo = true;
    }
    const coPorNombre = nombre => {
      const natural = Agenda.nombreNatural(nombre);
      let co = d.coordinadores.find(x => norm(x.nombre) === norm(natural));
      if (!co) {
        co = { id: 'co-' + codigo(5), titulo: '', nombre: natural, correo: '', oficina: '', liga: '', foto: '',
               semana: {}, bloqueos: [], activo: true };
        d.coordinadores.push(co);
        resumen.coordinadoresNuevos++;
      }
      return co;
    };
    const nuevaCarrera = nombre => {
      const ca = { id: 'ca-' + codigo(5), nombre, departamento: departamentoDe(nombre), coordinador: '', activa: true };
      d.carreras.push(ca);
      resumen.carrerasNuevas++;
      return ca;
    };
    leido.carreras.forEach(lc => {
      const ca = d.carreras.find(x => norm(x.nombre) === norm(lc.nombre)) || nuevaCarrera(lc.nombre);
      if (lc.coordinador) ca.coordinador = coPorNombre(lc.coordinador).id;
    });
    const vienen = new Set();
    leido.solicitantes.forEach(n => {
      vienen.add(n.matricula);
      const s = d.solicitantes.find(x => x.matricula === n.matricula);
      if (s) {
        const correoPropio = !n.correo && s.correo;     // lo dio el prospecto; el Excel no lo tiene
        Object.assign(s, n, { fuera: false });
        if (correoPropio) s.correo = correoPropio;
        resumen.actualizados++;
      } else {
        d.solicitantes.push(Object.assign({ habilitado: false, fuera: false }, n));
        resumen.nuevos++;
      }
      if (n.licenciatura && !d.carreras.some(x => norm(x.nombre) === norm(n.licenciatura))) nuevaCarrera(n.licenciatura);
    });
    d.solicitantes.forEach(s => {
      if (!vienen.has(s.matricula) && !s.fuera) { s.fuera = true; resumen.fuera++; }
    });
    d.origen = 'excel';
    d.importado = { cuando: ahora(), archivo: nombreArchivo || '', solicitantes: leido.solicitantes.length };
    resumen.porAgendar = d.solicitantes.filter(s => Agenda.permiso(s) === 'ok').length;
    return { d, resumen };
  }

  /* ════ Motor local: el navegador ═══════════════════════════ */
  const local = (() => {
    function leer() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(LLAVE) || 'null'); } catch (e) {}
      if (!d) {
        d = CONFIG.modoPrueba ? Ejemplo.datos() : vacio();
        escribir(d);
      }
      d.ajustes = Object.assign({}, CONFIG.ajustes, d.ajustes || {});
      d.solicitantes = d.solicitantes || [];
      return d;
    }
    function escribir(d) { localStorage.setItem(LLAVE, JSON.stringify(d)); }
    function cita(d, id) {
      const c = d.citas.find(x => x.id === id);
      if (!c) throw new Error('No encontramos esa cita.');
      return c;
    }
    function anotar(c, que, quien) {
      (c.historial = c.historial || []).push({ cuando: ahora(), que, quien: quien || '' });
    }
    /* Revisa en el momento de escribir que el horario siga libre:
       si dos personas eligieron lo mismo, sólo pasa la primera. */
    function verificarEspacio(d, coordId, fecha, hora, modalidad, ignorar, sinAnticipacion) {
      const co = d.coordinadores.find(x => x.id === coordId);
      if (!co || !co.activo) throw new Error('Ese coordinador ya no está disponible.');
      const e = Agenda.espacios(co, fecha, d, { ignorar, sinAnticipacion }).find(x => x.hora === hora);
      if (!e) throw new Error('OCUPADO');
      if (modalidad && !e.modalidades.includes(modalidad)) throw new Error('MODALIDAD');
    }

    return {
      necesitaSesion: false,
      sesion: () => ({ rol: 'admin', quien: '', nombre: 'Prueba local' }),
      async entrar() { return this.sesion(); },
      async salir() {},
      async miClave() {},
      async claveCoordinador() {},

      async cargar() { return leer(); },

      async guardarAjustes(cambios) {
        const d = leer();
        d.ajustes = Object.assign({}, d.ajustes, cambios);
        escribir(d);
        return d.ajustes;
      },
      async guardarCarrera(c) {
        /* acepta cambios parciales: { id, activa: false } basta */
        const d = leer();
        const i = d.carreras.findIndex(x => x.id === c.id);
        const r = Object.assign({ activa: true }, i >= 0 ? d.carreras[i] : {}, c);
        r.nombre = (r.nombre || '').trim();
        if (!r.nombre) throw new Error('Escribe el nombre de la carrera.');
        if (d.carreras.some(x => x.id !== r.id && x.nombre.toLowerCase() === r.nombre.toLowerCase()))
          throw new Error('Ya hay una carrera con ese nombre.');
        if (!r.id) r.id = 'ca-' + codigo(5);
        if (i >= 0) d.carreras[i] = r; else d.carreras.push(r);
        escribir(d);
        return r;
      },
      async borrarCarrera(id) {
        const d = leer();
        if (d.citas.some(x => x.carrera === id))
          throw new Error('Esta carrera ya tiene citas. Desactívala en vez de borrarla: deja de aparecer para los prospectos y el historial se conserva.');
        d.carreras = d.carreras.filter(x => x.id !== id);
        escribir(d);
      },
      async guardarCoordinador(c) {
        /* acepta cambios parciales: { id, semana } basta */
        const d = leer();
        const i = d.coordinadores.findIndex(x => x.id === c.id);
        const r = Object.assign({ activo: true, semana: {}, bloqueos: [], foto: '', titulo: '', oficina: '', liga: '', correo: '' },
          i >= 0 ? d.coordinadores[i] : {}, c);
        r.nombre = (r.nombre || '').trim();
        if (!r.nombre) throw new Error('Escribe el nombre del coordinador.');
        r.correo = (r.correo || '').trim().toLowerCase();
        if (r.correo && d.coordinadores.some(x => x.id !== r.id && x.correo === r.correo))
          throw new Error('Ese correo ya es de otro coordinador.');
        if (!r.id) r.id = 'co-' + codigo(5);
        if (i >= 0) d.coordinadores[i] = r; else d.coordinadores.push(r);
        escribir(d);
        return r;
      },
      async borrarCoordinador(id) {
        const d = leer();
        if (d.citas.some(x => x.coordinador === id))
          throw new Error('Este coordinador ya tiene citas. Desactívalo en vez de borrarlo: el historial se conserva.');
        d.coordinadores = d.coordinadores.filter(x => x.id !== id);
        d.carreras.forEach(x => { if (x.coordinador === id) x.coordinador = ''; });
        escribir(d);
      },

      /* El prospecto se identifica con matrícula + correo, los dos datos
         que Admisiones ya tiene en el Excel. */
      async identificar(matricula, correo) {
        const d = leer();
        const m = (matricula || '').trim().toUpperCase();
        const co = (correo || '').trim().toLowerCase();
        const s = d.solicitantes.find(x => x.matricula === m);
        if (!s) throw new Error('NO_EXISTE');
        if (s.correo && s.correo !== co) throw new Error('CORREO');
        const hoy = Agenda.hoy();
        const suyas = d.citas.filter(x => x.matricula === m && x.estado !== 'cancelada')
          .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
        const vigente = suyas.find(x => x.estado === 'agendada' && x.fecha >= hoy) || null;
        return { s, permiso: Agenda.permiso(s), cita: vigente || suyas[0] || null, vigente, carrera: carreraDe(d, s), datos: d };
      },
      async reservar(datos) {
        const d = leer();
        const m = (datos.matricula || '').trim().toUpperCase();
        const s = d.solicitantes.find(x => x.matricula === m);
        if (!s) throw new Error('NO_EXISTE');
        if (Agenda.permiso(s) !== 'ok') throw new Error('SIN_PERMISO');
        if (d.citas.some(x => x.matricula === m && x.estado === 'agendada' && x.fecha >= Agenda.hoy()))
          throw new Error('YA_TIENE');
        const carrera = carreraDe(d, s);
        if (!carrera || !carrera.coordinador) throw new Error('SIN_COORDINADOR');
        verificarEspacio(d, carrera.coordinador, datos.fecha, datos.hora, datos.modalidad);
        const correo = (datos.correo || '').trim().toLowerCase();
        if (!s.correo && correo) s.correo = correo;     // el Excel no lo traía: se queda el que dio
        const c = {
          id: codigo(6), matricula: m, correo: s.correo || correo,
          nombre: Agenda.titulo(s.nombre), telefono: (datos.telefono || '').trim(),
          carrera: carrera.id, coordinador: carrera.coordinador,
          fecha: datos.fecha, hora: datos.hora, duracion: d.ajustes.duracion,
          modalidad: datos.modalidad, estado: 'agendada', resultado: '', nota: '', whatsapp: !!datos.whatsapp,
          creado: ahora(), historial: [],
        };
        anotar(c, 'Agendó su cita', 'Prospecto');
        d.citas.push(c);
        escribir(d);
        return c;
      },
      async moverCita(id, fecha, hora, modalidad, quien) {
        const d = leer();
        const c = cita(d, id);
        verificarEspacio(d, c.coordinador, fecha, hora, modalidad, id, quien !== 'Prospecto');
        const antes = Agenda.fechaCorta(c.fecha) + ' ' + c.hora;
        /* al moverla toma la duración vigente: es la que usó el hueco nuevo */
        Object.assign(c, { fecha, hora, modalidad, estado: 'agendada', duracion: d.ajustes.duracion });
        delete c.avisada;   // el aviso anterior ya no vale
        anotar(c, 'Cambió de ' + antes + ' a ' + Agenda.fechaCorta(fecha) + ' ' + hora, quien);
        escribir(d);
        return c;
      },
      async cancelarCita(id, quien, motivo) {
        const d = leer();
        const c = cita(d, id);
        c.estado = 'cancelada';
        anotar(c, 'Canceló' + (motivo ? ': ' + motivo : ''), quien);
        escribir(d);
        return c;
      },
      /* Estado, resultado y nota: lo que marca el coordinador después de la entrevista. */
      async actualizarCita(id, cambios, quien) {
        const d = leer();
        const c = cita(d, id);
        if (cambios.estado && cambios.estado !== c.estado) anotar(c, 'Marcó: ' + Agenda.ESTADOS[cambios.estado], quien);
        if ('nota' in cambios && cambios.nota !== c.nota) anotar(c, 'Editó la nota', quien);
        if ('resultado' in cambios && cambios.resultado !== (c.resultado || ''))
          anotar(c, 'Resultado de la entrevista: ' + (Agenda.RESULTADOS[cambios.resultado] || 'sin definir'), quien);
        if (cambios.correo || cambios.telefono) anotar(c, 'Corrigió datos de contacto', quien);
        if ('avisada' in cambios) {
          if (cambios.avisada) { anotar(c, 'Marcó la cita como avisada', quien); cambios = Object.assign({}, cambios, { avisada: ahora() }); }
          else { if (c.avisada) anotar(c, 'Quitó la marca de avisada', quien); delete c.avisada; cambios = Object.assign({}, cambios); delete cambios.avisada; }
        }
        Object.assign(c, cambios);
        escribir(d);
        return c;
      },
      /* «A consideración del coordinador»: el coordinador (o Admisiones)
         decide entrevistarlo y lo deja agendar. */
      async kommoEstado() { return { conectado: false, error: 'Kommo sólo funciona con la base de verdad, no en la prueba local.', embudos: [] }; },
      async kommoGuardar() { throw new Error('Kommo sólo funciona con la base de verdad.'); },
      async kommoSincronizar() { return 0; },
      async kommoReintentar() { return 0; },
      async habilitar(matricula, si, quien) {
        const d = leer();
        const s = d.solicitantes.find(x => x.matricula === matricula);
        if (!s) throw new Error('No encontré esa matrícula.');
        s.habilitado = !!si;
        s.habilitadoPor = si ? quien + ' · ' + new Date().toLocaleDateString('es-MX') : '';
        escribir(d);
        return s;
      },
      async importar(leido, nombreArchivo) {
        const { d, resumen } = fusionar(leer(), leido, nombreArchivo);
        escribir(d);
        return resumen;
      },
      async reiniciar() {
        localStorage.removeItem(LLAVE);
        return leer();
      },
      /* Si otra pestaña cambia algo, avisa para pintar de nuevo. */
      alCambiar(fn) {
        addEventListener('storage', e => { if (e.key === LLAVE) fn(); });
      },
    };
  })();

  /* ════ Motor nube: la base, a través de las funciones adm_* ═══ */
  const nube = (() => {
    let prospecto = null;   // { matricula, correo } del que se identificó en esta página

    async function rpc(funcion, args = {}) {
      let r;
      try {
        r = await fetch(CONFIG.nube.url + '/rest/v1/rpc/' + funcion, {
          method: 'POST',
          headers: { apikey: CONFIG.nube.llave, Authorization: 'Bearer ' + CONFIG.nube.llave, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
      } catch (e) { throw new Error('No hay conexión. Revisa tu internet e intenta de nuevo.'); }
      const texto = await r.text();
      const d = texto ? JSON.parse(texto) : null;
      if (!r.ok) {
        const msg = (d && d.message) || 'Error ' + r.status;
        if (msg === 'SIN_SESION') { localStorage.removeItem(LLAVE_SESION); }
        throw new Error(msg);
      }
      return d;
    }
    function sesion() {
      try {
        const s = JSON.parse(localStorage.getItem(LLAVE_SESION) || 'null');
        return s && new Date(s.expira) > new Date() ? s : null;
      } catch (e) { return null; }
    }
    const token = () => { const s = sesion(); if (!s) throw new Error('SIN_SESION'); return s.token; };
    const conCredenciales = () => {
      if (!prospecto) throw new Error('Vuelve a escribir tu matrícula y tu correo.');
      return { p_matricula: prospecto.matricula, p_correo: prospecto.correo };
    };
    function completar(d) {
      d.ajustes = Object.assign({}, CONFIG.ajustes, d.ajustes || {});
      ['carreras', 'coordinadores', 'citas', 'solicitantes'].forEach(k => { d[k] = d[k] || []; });
      return d;
    }

    return {
      necesitaSesion: true,
      sesion,
      async entrar(usuario, clave) {
        try {
          const s = await rpc('adm_entrar', { p_usuario: usuario, p_clave: clave });
          localStorage.setItem(LLAVE_SESION, JSON.stringify(s));
          return s;
        } catch (e) {
          throw new Error(e.message === 'CLAVE' ? 'Usuario o clave incorrectos.' : e.message);
        }
      },
      async salir() {
        const s = sesion();
        localStorage.removeItem(LLAVE_SESION);
        if (s) await rpc('adm_salir', { p_token: s.token }).catch(() => {});
      },
      async miClave(actual, nueva) {
        await rpc('adm_mi_clave', { p_token: token(), p_actual: actual, p_nueva: nueva });
        const s = sesion();     // ya no es temporal: que no la vuelva a pedir
        if (s && s.cambiar) localStorage.setItem(LLAVE_SESION, JSON.stringify(Object.assign(s, { cambiar: false })));
      },
      async claveCoordinador(id, clave) { await rpc('adm_clave_coordinador', { p_token: token(), p_id: id, p_clave: clave }); },

      /* Con sesión: todo lo que esa sesión puede ver. Sin sesión: lo del
         prospecto que se identificó, o sólo los ajustes. */
      async cargar() {
        if (sesion()) return completar(await rpc('adm_datos', { p_token: token() }));
        if (prospecto) return (await this.identificar(prospecto.matricula, prospecto.correo)).datos;
        return completar(await rpc('adm_publico'));
      },

      async guardarAjustes(cambios) { return rpc('adm_guardar_ajustes', { p_token: token(), p_cambios: cambios }); },
      async guardarCarrera(c) { return rpc('adm_guardar_carrera', { p_token: token(), p_c: c }); },
      async borrarCarrera(id) { return rpc('adm_borrar_carrera', { p_token: token(), p_id: id }); },
      async guardarCoordinador(c) { return rpc('adm_guardar_coordinador', { p_token: token(), p_c: c }); },
      async borrarCoordinador(id) { return rpc('adm_borrar_coordinador', { p_token: token(), p_id: id }); },

      async identificar(matricula, correo) {
        const r = await rpc('adm_identificar', { p_matricula: matricula, p_correo: correo });
        prospecto = { matricula: r.s.matricula, correo: (correo || '').trim().toLowerCase() };
        r.datos = completar(r.datos);
        return r;
      },
      async reservar(datos) {
        return rpc('adm_reservar', { p_matricula: datos.matricula, p_correo: datos.correo, p_telefono: datos.telefono,
                                     p_fecha: datos.fecha, p_hora: datos.hora, p_modalidad: datos.modalidad,
                                     p_whatsapp: !!datos.whatsapp });
      },
      async moverCita(id, fecha, hora, modalidad, quien) {
        if (quien === 'Prospecto')
          return rpc('adm_mover_prospecto', Object.assign(conCredenciales(), { p_id: id, p_fecha: fecha, p_hora: hora, p_modalidad: modalidad }));
        return rpc('adm_mover_cita', { p_token: token(), p_id: id, p_fecha: fecha, p_hora: hora, p_modalidad: modalidad });
      },
      async cancelarCita(id, quien, motivo) {
        if (quien === 'Prospecto') return rpc('adm_cancelar_prospecto', Object.assign(conCredenciales(), { p_id: id }));
        return rpc('adm_cancelar_cita', { p_token: token(), p_id: id, p_motivo: motivo || '' });
      },
      async actualizarCita(id, cambios) { return rpc('adm_actualizar_cita', { p_token: token(), p_id: id, p_cambios: cambios }); },
      async habilitar(matricula, si) { return rpc('adm_habilitar', { p_token: token(), p_matricula: matricula, p_si: !!si }); },

      /* Kommo (CRM de Sergio): las citas se mandan solas desde la base
         (supabase/kommo.sql); aquí sólo se elige embudo y etapa. */
      async kommoEstado() { return rpc('adm_kommo_estado', { p_token: token() }); },
      async kommoGuardar(activo, embudo, etapa) {
        return rpc('adm_kommo_guardar', { p_token: token(), p_activo: !!activo, p_pipeline: embudo, p_status: etapa });
      },
      async kommoSincronizar() { return rpc('adm_kommo_sincronizar', { p_token: token() }); },
      async kommoReintentar() { return rpc('adm_kommo_reintentar', { p_token: token() }); },

      async importar(leido, nombreArchivo) {
        const { d, resumen } = fusionar(await this.cargar(), leido, nombreArchivo);
        await rpc('adm_importar', {
          p_token: token(), p_carreras: d.carreras, p_coordinadores: d.coordinadores,
          p_solicitantes: d.solicitantes, p_meta: { origen: d.origen, importado: d.importado },
        });
        return resumen;
      },
      async reiniciar() { return this.cargar(); },
      /* Lo de los demás llega cada 30 s, mientras la pestaña está a la vista. */
      alCambiar(fn) {
        setInterval(() => { if (!document.hidden) fn(); }, 30000);
      },
    };
  })();

  const motor = CONFIG.motor === 'nube' ? nube : local;
  return Object.assign({ modo: CONFIG.motor, codigo }, motor);
})();
