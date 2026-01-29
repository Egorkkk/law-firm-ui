#!/usr/bin/env python3
import csv
import json
import argparse
from pathlib import Path
from datetime import datetime

CSV_COLUMNS = [
    "lastName", "firstName", "middleName", "dob",
    "phone", "address", "email", "status", "responsible"
]

def parse_dob(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    # поддержка "YYYY-MM-DD" и "DD.MM.YYYY"
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    # если формат неизвестен — вернём как есть (лучше, чем потерять)
    return s

def make_id(prefix: str, n: int, pad: int) -> str:
    return f"{prefix}{str(n).zfill(pad)}"

def main():
    ap = argparse.ArgumentParser(description="Convert clients CSV to clients.json for offline UI")
    ap.add_argument("csv_path", help="Input CSV (UTF-8, with header or exact 9 columns)")
    ap.add_argument("--out-json", default="public/assets/clients/clients.json", help="Output clients.json path")
    ap.add_argument("--public-dir", default="public", help="Public dir root (where assets/ live)")
    ap.add_argument("--id-prefix", default="c", help="Client id prefix")
    ap.add_argument("--id-start", type=int, default=1, help="Start number for ids")
    ap.add_argument("--id-pad", type=int, default=3, help="Zero pad for ids (c001)")
    ap.add_argument("--make-dossiers", action="store_true", help="Create empty dossier HTML files")
    ap.add_argument("--make-transcripts", action="store_true", help="Create empty transcript TXT files")
    args = ap.parse_args()

    csv_path = Path(args.csv_path)
    out_json = Path(args.out_json)
    public_dir = Path(args.public_dir)

    # читаем CSV
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        raise SystemExit("CSV пустой")

    # если первая строка похожа на заголовок — пропускаем
    header_like = [c.strip().lower() for c in rows[0]]
    has_header = "фамилия" in header_like or "lastname" in header_like
    if has_header:
        rows = rows[1:]

    clients = []
    next_id_num = args.id_start

    for r in rows:
        # допускаем лишние колонки справа, но минимум 9
        if len(r) < 9:
            continue

        data = dict(zip(CSV_COLUMNS, [x.strip() for x in r[:9]]))

        cid = make_id(args.id_prefix, next_id_num, args.id_pad)
        next_id_num += 1

        dob = parse_dob(data.get("dob", ""))

        client = {
            "id": cid,
            "firstName": data.get("firstName", ""),
            "lastName": data.get("lastName", ""),
            "middleName": data.get("middleName", ""),
            "dob": dob,
            "phone": data.get("phone", ""),
            "address": data.get("address", ""),
            "email": data.get("email", ""),
            "status": data.get("status", ""),
            "responsible": data.get("responsible", ""),

            # ресурсы UI
            "photo": "assets/clients/photos/placeholder.svg",
            "dossier": f"assets/clients/dossiers/{cid}.html",
            "audio": "",  # пусто => waveform перейдёт в demo-режим
            "transcript": f"assets/clients/transcripts/{cid}.txt",
        }
        clients.append(client)

        # опционально создаём пустые файлы, чтобы UI не показывал "не удалось загрузить"
        if args.make_dossiers:
            p = public_dir / client["dossier"]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                f"<h2>Досье: {client['lastName']} {client['firstName']} {client['middleName']}</h2>\n"
                "<p class=\"muted\">Пусто. Заполни вручную.</p>\n",
                encoding="utf-8"
            )

        if args.make_transcripts:
            p = public_dir / client["transcript"]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("Адвокат: \nКлиент: \n", encoding="utf-8")

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(clients, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"OK: wrote {len(clients)} clients -> {out_json}")

if __name__ == "__main__":
    main()
