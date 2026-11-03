/* ═══════════════════════════════════════════════════════════
   Datos de ejemplo · sólo en modo prueba

   Las 11 licenciaturas se llaman como en el Excel de control de
   Admisiones. Coordinadores, solicitantes, matrículas y correos
   son INVENTADOS. En cuanto Marysol carga su Excel desde el Admin,
   todo esto se reemplaza por lo real.
   Las citas se acomodan alrededor del día de hoy, así la demo
   siempre tiene pasado (realizadas) y futuro (agendadas).
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Ejemplo = (() => {
  const CARRERAS = [
    ['Arquitectura', 0, 'Mtra.', 'Daniela Robles'],
    ['Ingeniería Mecatrónica', 0, 'Ing.', 'Ricardo Salinas'],
    ['Ingeniería Industrial', 0, 'Ing.', 'Ricardo Salinas'],
    ['Comunicación', 1, 'Mtra.', 'Paola Cervantes'],
    ['Derecho', 1, 'Lic.', 'Fernando Iturbide'],
    ['Administración de Negocios Internacionales', 1, 'Mtra.', 'Lucía Ortega'],
    ['Administración de Empresas', 1, 'Mtra.', 'Lucía Ortega'],
    ['Enfermería', 2, 'Mtra.', 'Gabriela Montes'],
    ['Nutrición y Ciencia de los Alimentos', 2, 'Mtra.', 'Claudia Arellano'],
    ['Psicología', 2, 'Dra.', 'Mariana Esquivel'],
    ['Medicina', 2, 'Dr.', 'Héctor Palacios'],
  ];

  /* Horario tipo de cada coordinador: [días, desde, hasta, tipo] */
  const HORARIOS = {
    'Daniela Robles':   [[['lun', 'mie', 'vie'], '09:00', '12:00', 'a'], [['mar'], '16:00', '18:00', 'l']],
    'Ricardo Salinas':  [[['mar', 'jue'], '10:00', '13:00', 'a'], [['vie'], '09:00', '11:00', 'p']],
    'Paola Cervantes':  [[['lun', 'mar', 'mie', 'jue'], '11:00', '13:00', 'a'], [['vie'], '10:00', '12:00', 'l']],
    'Fernando Iturbide': [[['mar', 'jue'], '17:00', '19:00', 'l'], [['mie'], '10:00', '12:00', 'p']],
    'Lucía Ortega':     [[['lun', 'jue'], '09:00', '11:00', 'a'], [['mie', 'vie'], '12:00', '14:00', 'a']],
    'Gabriela Montes':  [[['lun', 'mar', 'mie'], '08:00', '10:00', 'p'], [['jue'], '16:00', '18:00', 'l']],
    'Claudia Arellano': [[['mar', 'vie'], '10:00', '12:30', 'a']],
    'Mariana Esquivel': [[['lun', 'mie', 'vie'], '13:00', '15:00', 'a']],
    'Héctor Palacios':  [],   // sin horarios: así se ve la alerta del Admin
  };
  const OFICINAS = ['Edificio A · cubículo 14', 'Edificio B · cubículo 3', 'Edificio C · Coordinación de Comunicación',
    'Edificio A · cubículo 9', 'Edificio C · cubículo 2', 'Edificio de Salud · oficina 101',
    'Edificio de Salud · oficina 104', 'Edificio de Salud · oficina 110', 'Edificio de Salud · oficina 115'];

  /* Apellidos primero y en mayúsculas, como vienen en el Excel. */
  const SOLICITANTES = [
    ['GOMEZ RUIZ VALERIA', 0], ['HERNANDEZ SOTO DIEGO', 3], ['CASTRO LARA XIMENA', 9], ['MENDEZ RIOS SANTIAGO', 1],
    ['FLORES NAVARRO REGINA', 4], ['TORRES VEGA EMILIANO', 7], ['IBARRA LUNA CAMILA', 3], ['AGUILAR PINEDA MATEO', 0],
    ['RAMIREZ DUARTE SOFIA', 0], ['CRUZ BELTRAN LEONARDO', 3], ['SALAZAR OCHOA RENATA', 9], ['NUÑEZ GARZA SEBASTIAN', 1],
    ['MEDINA FUENTES ISABELLA', 5], ['ROJAS CARDENAS ANDRES', 8], ['VARGAS PAZ FERNANDA', 6], ['ORTIZ MOLINA DANIEL', 4],
    ['DE LA TORRE SAENZ ANA PAULA', 10], ['LEON IBARRA JOSE MARIA', 10], ['QUINTERO MORA ALEJANDRA', 10], ['PEÑA SOLIS RODRIGO', 10],
    ['ESPINOZA CANO MARIA JOSE', 9], ['VILLA REYES PABLO', 7], ['MORALES TAPIA NATALIA', 5], ['GUZMAN ARCE LUIS FERNANDO', 2],
    ['ROSAS LEYVA PAULINA', 8], ['CARRILLO NIETO EMILIO', 4], ['DOMINGUEZ OSUNA VALENTINA', 3],
  ];
  /* [índice, resultado] para los que no son «Aprobado» */
  const RESULTADOS = { 16: 'Pase directo', 17: 'A consideración del coordinador', 18: 'Pendiente', 19: 'No aprobado',
    20: 'A consideración del coordinador', 21: 'Pendiente', 2: 'Pase directo' };

  function pintar(semana, dias, desde, hasta, tipo) {
    dias.forEach(d => {
      semana[d] = semana[d] || {};
      for (let m = Agenda.aMin(desde); m < Agenda.aMin(hasta); m += Agenda.CELDA) semana[d][Agenda.aHora(m)] = tipo;
    });
  }
  function habil(n) {
    let f = Agenda.hoy(), paso = n < 0 ? -1 : 1, faltan = Math.abs(n);
    while (faltan > 0) { f = Agenda.sumar(f, paso); if (!['dom', 'sab'].includes(Agenda.clave(f))) faltan--; }
    return f;
  }
  const sinAcentos = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function datos() {
    const d = { origen: 'ejemplo', ajustes: Object.assign({}, CONFIG.ajustes), carreras: [], coordinadores: [], citas: [], solicitantes: [] };
    const coDe = {};
    CARRERAS.forEach(([nombre, dep, titulo, persona], i) => {
      if (!coDe[persona]) {
        const semana = {};
        (HORARIOS[persona] || []).forEach(h => pintar(semana, ...h));
        const k = d.coordinadores.length;
        coDe[persona] = 'co-ej' + k;
        d.coordinadores.push({
          id: coDe[persona], titulo, nombre: persona,
          correo: sinAcentos(persona).replace(' ', '.') + '@tijuana.ibero.mx',
          oficina: OFICINAS[k], liga: 'https://teams.microsoft.com/l/meetup-join/ejemplo-' + (k + 1),
          foto: '', semana, bloqueos: [], activo: true,
        });
      }
      d.carreras.push({ id: 'ca-ej' + i, nombre, departamento: CONFIG.departamentos[dep], coordinador: coDe[persona], activa: true });
    });

    SOLICITANTES.forEach(([nombre, ci], i) => {
      const pila = (Agenda.pila(nombre) || nombre.split(' ').pop()).toLowerCase();
      d.solicitantes.push({
        matricula: String(1530100 + i * 37), nombre, licenciatura: CARRERAS[ci][0], ciclo: 'Primavera 2027',
        correo: sinAcentos(pila + '.' + nombre.split(' ')[0]).replace(/\s/g, '') + '@correo.com',
        resultado: RESULTADOS[i] || 'Aprobado', promedio: i === 22 ? 'No cumple' : 'Cumple',
        observaciones: i === 16 ? 'Falta constancia de 5to semestre' : '', escuela: 'Preparatoria de ejemplo',
        tipo: RESULTADOS[i] === 'Pase directo' ? 'Pase directo' : 'Examen', oportunidad: '1ª', habilitado: false, fuera: false,
      });
    });

    /* [solicitante, días hábiles desde hoy, cuál horario libre, estado, modalidad, resultado] */
    const PLAN = [
      [0, -4, 0, 'realizada', 'presencial', 'admitido'], [1, -4, 1, 'realizada', 'linea', 'admitido'],
      [2, -3, 0, 'no_asistio', 'presencial', ''], [3, -2, 2, 'realizada', 'presencial', 'admitido'],
      [4, -2, 0, 'realizada', 'linea', 'no_admitido'], [5, -1, 1, 'no_asistio', 'presencial', ''],
      [6, -1, 0, 'realizada', 'presencial', 'admitido'],
      [7, 2, 0, 'agendada', 'presencial', ''], [8, 2, 2, 'agendada', 'linea', ''],
      [9, 2, 1, 'agendada', 'presencial', ''], [10, 3, 0, 'agendada', 'linea', ''],
      [11, 3, 1, 'agendada', 'presencial', ''], [12, 4, 0, 'agendada', 'presencial', ''],
      [13, 5, 2, 'agendada', 'linea', ''], [14, 6, 0, 'cancelada', 'presencial', ''],
      [15, 7, 1, 'agendada', 'linea', ''],
    ];
    PLAN.forEach(([si, dias, k, estado, modalidad, resultado], i) => {
      const s = d.solicitantes[si];
      const carrera = d.carreras.find(c => c.nombre === s.licenciatura);
      const co = d.coordinadores.find(c => c.id === carrera.coordinador);
      let fecha = habil(dias), libres = [];
      for (let intento = 0; intento < 10; intento++) {
        libres = Agenda.espacios(co, fecha, d, { todo: true }).filter(e => e.modalidades.includes(modalidad));
        if (libres.length) break;
        fecha = Agenda.sumar(fecha, dias < 0 ? -1 : 1);
      }
      if (!libres.length) return;
      const e = libres[Math.min(k, libres.length - 1)];
      const creado = new Date(Agenda.aFecha(fecha).getTime() - (5 + i % 4) * 864e5).toISOString();
      d.citas.push({
        id: 'EJ' + String(1000 + i * 37).slice(-4),
        matricula: s.matricula, nombre: Agenda.titulo(s.nombre), correo: s.correo,
        telefono: '664 ' + (100 + i * 17) + ' ' + String((1000 + i * 271) % 9000).padStart(4, '0'),
        carrera: carrera.id, coordinador: co.id,
        fecha, hora: e.hora, duracion: d.ajustes.duracion, modalidad, estado, resultado,
        nota: estado === 'realizada' ? 'Buena actitud; viene con perfil afín a la carrera.' : '',
        creado,
        historial: [{ cuando: creado, que: 'Agendó su cita', quien: 'Prospecto' }],
      });
    });
    return d;
  }

  return { datos };
})();
