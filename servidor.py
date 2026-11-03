# -*- coding: utf-8 -*-
"""
Agenda de entrevistas - servidor local del prototipo

    python servidor.py          → abre http://localhost:8794/

Sólo sirve los archivos de esta carpeta (no guarda nada: en el
prototipo los datos viven en el navegador). Hace falta porque las
tres vistas comparten el mismo localStorage sólo si salen del
mismo origen (localhost), no abriendo los archivos desde el disco.
"""

import os
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.abspath(__file__))
PUERTO = int(os.environ.get('PORT') or (sys.argv[sys.argv.index('--puerto') + 1] if '--puerto' in sys.argv else 8794))


class Manejador(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def end_headers(self):
        # Que al corregir algo se vea al recargar, sin pelearse con la caché.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "--callado" not in sys.argv:
            super().log_message(fmt, *args)


def main():
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    url = "http://localhost:{}/".format(PUERTO)
    print("\n  Agenda de entrevistas")
    print("  prospecto:   {}".format(url))
    print("  coordinador: {}coordinador.html".format(url))
    print("  admin:       {}admin.html".format(url))
    print("  Ctrl+C para cerrar.\n")
    if "--sin-navegador" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
