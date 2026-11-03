# -*- coding: utf-8 -*-
"""Sube los commits pendientes de la agenda de entrevistas a GitHub por su API.

    python empujar.py

POR QUÉ EXISTE
La red de IBERO tiene bloqueado github.com en el puerto 443, pero
api.github.com sí responde. git push va por el primero; esto va por
el segundo y llega igual. Es el mismo arreglo que usa LA PIZARRA
(empujar.py), apuntado al repositorio de la agenda.

Reconstruye cada commit con la API de datos de Git -- blob, árbol,
commit y referencia -- así que el historial queda con sus commits
separados. Si el repositorio remoto está vacío (recién creado),
sube el primer commit sin padre.

LO QUE HAY QUE SABER
El sha del commit CAMBIA: se rehace del otro lado. Y como aquí
tampoco se puede hacer fetch, el repositorio local se queda diciendo
"ahead" para siempre. Es cosmético. Para no perder la cuenta, este
script anota en .git/ultimo-empujado-por-api hasta dónde llegó,
medido en shas LOCALES.

Cuando la red vuelva a la normalidad, esto lo arregla de una vez:
    git fetch origin && git reset --hard origin/main
"""

import base64
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

RAIZ = os.path.dirname(os.path.abspath(__file__))
REPO = 'cci-iberotj/agenda-entrevistas'
RAMA = 'main'
MARCA = os.path.join(RAIZ, '.git', 'ultimo-empujado-por-api')


def git(*args):
    r = subprocess.run(['git'] + list(args), cwd=RAIZ, capture_output=True,
                       text=True, encoding='utf-8', errors='replace')
    return r.stdout.strip()


def credencial():
    r = subprocess.run(['git', 'credential', 'fill'], cwd=RAIZ,
                       input='protocol=https\nhost=github.com\n\n',
                       capture_output=True, text=True)
    for l in r.stdout.splitlines():
        if l.startswith('password='):
            return l.split('=', 1)[1]
    raise SystemExit('  No hay credencial de GitHub guardada.')


TOKEN = credencial()


def api(ruta, metodo='GET', cuerpo=None, tolerar=()):
    d = json.dumps(cuerpo).encode() if cuerpo is not None else None
    r = urllib.request.Request(
        'https://api.github.com' + ruta, data=d, method=metodo,
        headers={'Authorization': 'Bearer ' + TOKEN,
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28',
                 'User-Agent': 'agenda-entrevistas'})
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            t = x.read().decode()
            return json.loads(t) if t.strip() else {}
    except urllib.error.HTTPError as e:
        if e.code in tolerar:
            return None
        print('  HTTP %d en %s' % (e.code, ruta))
        print('  ' + e.read().decode()[:400])
        sys.exit(1)


def desde_donde(remoto):
    """Desde qué commit LOCAL hay que empujar."""
    if remoto is None:
        return None                        # repositorio vacío: todo
    if git('cat-file', '-t', remoto) == 'commit':
        return remoto                      # la red está bien, hubo fetch
    if os.path.exists(MARCA):
        anotado = io.open(MARCA, encoding='utf-8').read().strip()
        if git('cat-file', '-t', anotado) == 'commit':
            print('  último empujado (sha local): %s' % anotado[:7])
            return anotado
    print('\n  No sé de dónde partir: el sha remoto no existe aquí y no')
    print('  hay marca previa. Escribe en este archivo el sha local del')
    print('  último commit que ya esté en GitHub:')
    print('    %s\n' % MARCA)
    sys.exit(1)


def archivos_de(sha, desde):
    """Qué rutas cambió el commit: (estado, ruta). Para el primer
    commit de un repositorio vacío, todo lo que contiene."""
    if desde is None:
        return [('A', r) for r in git('ls-tree', '-r', '--name-only', sha).splitlines()]
    out = []
    for linea in git('diff-tree', '--no-commit-id', '--name-status', '-r', sha).splitlines():
        partes = linea.split('\t')
        out.append((partes[0], partes[-1]))
    return out


def main():
    ref = api('/repos/%s/git/ref/heads/%s' % (REPO, RAMA), tolerar=(404, 409))
    remoto = ref['object']['sha'] if ref else None
    print('\n  remoto: %s' % (remoto[:7] if remoto else '(vacío)'))

    desde = desde_donde(remoto)
    rango = '%s..HEAD' % desde if desde else 'HEAD'
    pendientes = git('rev-list', '--reverse', rango).split()
    if not pendientes:
        print('  Nada pendiente.\n')
        return
    print('  pendientes: %d commit(s)\n' % len(pendientes))

    padre = remoto
    primero = desde is None
    if remoto is None:
        # Con el repositorio vacío la API de datos de Git no deja crear
        # blobs (409). Se siembra el primer archivo por la API de
        # contenidos, que sí inicializa el repositorio, y a partir de
        # ahí se reconstruyen los commits locales encima.
        with open(os.path.join(RAIZ, 'LEEME.md'), 'rb') as f:
            semilla = api('/repos/%s/contents/LEEME.md' % REPO, 'PUT',
                          {'message': 'Nace el repositorio', 'branch': RAMA,
                           'content': base64.b64encode(f.read()).decode()})
        padre = semilla['commit']['sha']
        remoto = padre
        print('  sembrado: %s' % padre[:7])
    for sha in pendientes:
        mensaje = git('log', '-1', '--format=%B', sha)
        arbol = []
        for estado, ruta in archivos_de(sha, None if primero else 'x'):
            if estado.startswith('D'):
                arbol.append({'path': ruta, 'mode': '100644', 'type': 'blob', 'sha': None})
                print('    - %s' % ruta)
                continue
            with open(os.path.join(RAIZ, ruta), 'rb') as f:
                datos = f.read()
            blob = api('/repos/%s/git/blobs' % REPO, 'POST',
                       {'content': base64.b64encode(datos).decode(), 'encoding': 'base64'})
            arbol.append({'path': ruta, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
            print('    + %s (%.0f KB)' % (ruta, len(datos) / 1024))

        cuerpo = {'tree': arbol}
        if padre and not primero:
            cuerpo['base_tree'] = api('/repos/%s/git/commits/%s' % (REPO, padre))['tree']['sha']
        nuevo = api('/repos/%s/git/trees' % REPO, 'POST', cuerpo)
        commit = api('/repos/%s/git/commits' % REPO, 'POST',
                     {'message': mensaje, 'tree': nuevo['sha'],
                      'parents': [padre] if padre else []})
        padre = commit['sha']
        primero = False
        print('    -> %s  %s\n' % (padre[:7], mensaje.splitlines()[0][:58]))

    api('/repos/%s/git/refs/heads/%s' % (REPO, RAMA), 'PATCH', {'sha': padre})
    io.open(MARCA, 'w', encoding='utf-8').write(git('rev-parse', 'HEAD'))

    print('  rama actualizada a %s' % padre[:7])
    print('  La publicación arranca sola; tarda cerca de un minuto.')
    print('  https://cci-iberotj.github.io/agenda-entrevistas/\n')


if __name__ == '__main__':
    main()
