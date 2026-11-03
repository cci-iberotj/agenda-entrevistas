# -*- coding: utf-8 -*-
"""Publica la agenda de entrevistas: sube la versión, guarda y empuja.

    python publicar.py "qué cambió"

QUÉ HACE, EN ORDEN
  1. Sube el número de versión (1.2 → 1.3) en config.js, y lo estampa
     en index.html, coordinador.html y admin.html como ?v=1.3 detrás de cada archivo propio.
     Con eso el navegador de cualquiera pide los archivos nuevos en
     cuanto abre la página, en vez de quedarse diez minutos con los
     viejos (GitHub Pages los manda con caché de diez minutos).
  2. git add -A y git commit con el mensaje que le pases.
  3. empujar.py, que sube los commits por la API de GitHub.

ANTES DE PUBLICAR: config.js debe traer modoPrueba: false; este
script se niega si está en true.
"""

import io
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
ESTAMPADOS = ['index.html', 'coordinador.html', 'admin.html']


def leer(n):
    return io.open(os.path.join(RAIZ, n), encoding='utf-8').read()


def escribir(n, s):
    io.open(os.path.join(RAIZ, n), 'w', encoding='utf-8', newline='\n').write(s)


def main():
    mensaje = ' '.join(sys.argv[1:]).strip()
    if not mensaje:
        print('\n  Dime qué cambió:\n\n    python publicar.py "qué cambió"\n')
        sys.exit(1)

    conf = leer('config.js')
    if re.search(r"modoPrueba:\s*true", conf):
        print('')
        print('  config.js trae modoPrueba: true. Ponlo en false antes de publicar:')
        print('  la página saldría con datos de ejemplo y sin la base de verdad.')
        sys.exit(1)
    m = re.search(r"version:\s*'(\d+)\.(\d+)'", conf)
    if not m:
        print('  config.js no trae la versión (version: \'2.1\').')
        sys.exit(1)
    mayor, menor = int(m.group(1)), int(m.group(2))
    nueva = '%d.%d' % (mayor, menor + 1)
    escribir('config.js', conf.replace(m.group(0), "version: '%s'" % nueva))
    for n in ESTAMPADOS:
        s = leer(n)
        s2 = re.sub(r"\?v=\d+\.\d+", '?v=' + nueva, s)
        if s2 == s:
            print('  ojo: %s no tenía ningún ?v= que estampar' % n)
        escribir(n, s2)
    print('\n  versión %s' % nueva)

    def git(*a):
        r = subprocess.run(['git'] + list(a), cwd=RAIZ, capture_output=True,
                           text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            print(r.stdout, r.stderr)
            sys.exit(1)
        return r.stdout

    git('add', '-A')
    git('-c', 'core.safecrlf=false', 'commit', '-q', '-m', '%s\n\nv%s' % (mensaje, nueva))
    print('  commit: %s' % mensaje[:60])
    r = subprocess.run([sys.executable, os.path.join(RAIZ, 'empujar.py')], cwd=RAIZ)
    sys.exit(r.returncode)


if __name__ == '__main__':
    main()
