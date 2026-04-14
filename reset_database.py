"""
Elimina la base de datos local y deja que la app la recree al arrancar.
Uso: python reset_database.py
"""
import os
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB = BASE / "gamecliphub.db"


def main() -> None:
    if not DB.exists():
        print(f"No existe {DB}; no hay nada que borrar.")
        return
    DB.unlink()
    print(f"Eliminado {DB}. Al ejecutar python app.py o npm start se creará de nuevo con database.sql.")


if __name__ == "__main__":
    main()
