# -*- coding: utf-8 -*-
"""
Agenda de entrevistas - correr SQL en la base sin copy-paste

    python supabase/correr.py supabase/esquema.sql
    python supabase/correr.py "select count(*) from admisiones.citas"

LA BASE
Es la de LA PIZARRA (proyecto wrezcukptrtmnhnlxmao): Leo eligió el
2-nov-2026 montar la agenda ahí, en su propio esquema «admisiones»,
para no ocupar el segundo lugar gratuito de Supabase. Nada de aquí
toca las tablas de LA PIZARRA.

EL TOKEN
Es el mismo token de cuenta que usa LA PIZARRA y se lee de SU carpeta
datos/ (fuera de cualquier repositorio). No se copia aquí.

LO QUE NO HACE SOLO
drop, delete, truncate... los detiene. Para correrlos a propósito:
--si-borra.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.path.join(AQUI, "..", "..", "..", "LA PIZARRA", "datos", "token_supabase.txt")
PROYECTO = "wrezcukptrtmnhnlxmao"
API = "https://api.supabase.com/v1/projects/{}/database/query"

PELIGROSAS = [r"\bdrop\s+table\b", r"\bdrop\s+schema\b", r"\btruncate\b",
              r"\bdelete\s+from\b", r"\bdrop\s+column\b"]


def salir(m):
    print("\n  " + m + "\n")
    sys.exit(1)


def token():
    with open(os.path.normpath(TOKEN), encoding="utf-8") as f:
        reales = [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]
    if not reales or not reales[0].startswith("sbp_"):
        salir("No encontré el token de cuenta en LA PIZARRA/datos/token_supabase.txt")
    return reales[0]


def ejecutar(sql):
    pet = urllib.request.Request(
        API.format(PROYECTO), data=json.dumps({"query": sql}).encode("utf-8"),
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json",
                 "User-Agent": "agenda-entrevistas/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(pet, timeout=120) as r:
            return json.loads(r.read().decode("utf-8") or "[]")
    except urllib.error.HTTPError as e:
        cuerpo = e.read().decode("utf-8", "replace")
        try:
            cuerpo = json.loads(cuerpo).get("message", cuerpo)
        except Exception:
            pass
        salir("Supabase respondió {}:\n\n  {}".format(e.code, cuerpo))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        salir('Uso: python supabase/correr.py archivo.sql  |  "select ..."')
    sql = open(args[0], encoding="utf-8").read() if os.path.exists(args[0]) else args[0]
    limpio = re.sub(r"--[^\n]*", "", sql).lower()
    if any(re.search(p, limpio) for p in PELIGROSAS) and "--si-borra" not in sys.argv:
        salir("Esto borra datos. Si es a propósito, agrega --si-borra.")
    r = ejecutar(sql)
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(r, ensure_ascii=False, indent=1)[:6000])


if __name__ == "__main__":
    main()
