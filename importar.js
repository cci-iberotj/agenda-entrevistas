/* ═══════════════════════════════════════════════════════════
   Importar · lee el Excel de control de Admisiones

   «Resultados_Admision_IBERO_Tijuana_2027.xlsx», el archivo que
   Admisiones comparte con las coordinaciones:
     · Especificaciones → tabla «Criterios por licenciatura»:
       licenciatura y quién la coordina
     · Base <ciclo>     → un renglón por solicitante: matrícula,
       nombre, licenciatura, resultado del examen, correo…
   Las columnas se buscan por su TÍTULO, no por su posición: si
   Admisiones agrega o mueve una columna, esto sigue leyendo bien.
   Usa SheetJS (xlsx.full.min.js), que se carga sólo en el Admin.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const Importar = (() => {
  const norm = t => String(t == null ? '' : t).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  const filas = hoja => XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: false });

  /* El renglón de títulos: el primero que trae todas las palabras pedidas. */
  function cabecera(rows, pedidas) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i].map(norm);
      if (pedidas.every(p => r.some(c => c === p || c.startsWith(p)))) return i;
    }
    return -1;
  }
  function columnas(fila, mapa) {
    const r = fila.map(norm), cols = {};
    Object.entries(mapa).forEach(([clave, titulo]) => {
      cols[clave] = r.findIndex(c => c === titulo || c.startsWith(titulo));
    });
    return cols;
  }

  function leer(libro) {
    const avisos = [];
    const hojas = libro.SheetNames;

    /* ── Coordinadores ── */
    const carreras = [];
    const nEsp = hojas.find(n => norm(n) === 'especificaciones');
    if (nEsp) {
      const rows = filas(libro.Sheets[nEsp]);
      const h = cabecera(rows, ['licenciatura', 'coordinador']);
      if (h >= 0) {
        const c = columnas(rows[h], { nombre: 'licenciatura', coordinador: 'coordinador' });
        for (let i = h + 1; i < rows.length; i++) {
          const nombre = String(rows[i][c.nombre] || '').trim();
          if (!nombre || /^margen/i.test(nombre)) break;
          carreras.push({ nombre, coordinador: String(rows[i][c.coordinador] || '').trim() });
        }
      }
    }
    if (!carreras.length) avisos.push('No encontré la tabla de coordinadores en la hoja «Especificaciones»; se quedan los que ya había.');

    /* ── Solicitantes ── */
    const solicitantes = [];
    const vistas = new Map();
    hojas.filter(n => /^base\s/i.test(n)).forEach(n => {
      const ciclo = n.replace(/^base\s+/i, '').trim();
      const rows = filas(libro.Sheets[n]);
      const h = cabecera(rows, ['matricula', 'licenciatura']);
      if (h < 0) { avisos.push('La hoja «' + n + '» no trae la columna Matrícula; la salté.'); return; }
      const c = columnas(rows[h], {
        matricula: 'matricula', nombre: 'nombre', licenciatura: 'licenciatura', escuela: 'escuela',
        tipo: 'tipo de ingreso', oportunidad: 'oportunidad', resultado: 'resultado examen',
        promedio: 'validacion promedio', observaciones: 'observaciones', correo: 'correo',
      });
      for (let i = h + 1; i < rows.length; i++) {
        const r = rows[i];
        const matricula = String(r[c.matricula] || '').trim().toUpperCase();
        if (!matricula) continue;
        const v = k => c[k] >= 0 ? String(r[c[k]] || '').trim() : '';
        if (vistas.has(matricula)) avisos.push('La matrícula ' + matricula + ' aparece dos veces (' + vistas.get(matricula) + ' y ' + ciclo + '); me quedé con la de ' + ciclo + '.');
        vistas.set(matricula, ciclo);
        solicitantes.push({
          matricula, ciclo,
          nombre: v('nombre'), licenciatura: v('licenciatura'), escuela: v('escuela'),
          tipo: v('tipo'), oportunidad: v('oportunidad'), resultado: v('resultado'),
          promedio: v('promedio'), observaciones: v('observaciones'), correo: v('correo').toLowerCase(),
        });
      }
    });
    if (!solicitantes.length) throw new Error('No encontré solicitantes. ¿Es el archivo de control de Admisiones (hojas «Base Primavera…», «Base Otoño…»)?');

    /* si una matrícula salió dos veces, la última manda */
    const unicos = [...new Map(solicitantes.map(s => [s.matricula, s])).values()];
    return { carreras, solicitantes: unicos, avisos };
  }

  async function archivo(file) {
    const buf = await file.arrayBuffer();
    return leer(XLSX.read(buf, { type: 'array' }));
  }

  return { archivo, norm };
})();
