"""
Rewrite engine.duckdb into a fresh, compact file.

DuckDB frees blocks on DELETE but never shrinks the file, so pruning
`features_daily` (see `prune_derived_history`) reclaims nothing on disk — the
2.7GB file stayed 2.7GB while holding ~50MB of live rows. The only way down is
to write a new database and swap it in.

Usage:
    python -m engine.compact_db            # compact, keeping a .bak
    python -m engine.compact_db --no-backup # compact, replacing in place

Safety: the new file's per-table row counts are verified against the old one
before anything is moved. On any mismatch the original is left untouched.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import duckdb

from engine.data.loader import DB_PATH, prune_derived_history


def table_counts(conn: duckdb.DuckDBPyConnection) -> dict[str, int]:
    tables = [r[0] for r in conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
    ).fetchall()]
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in sorted(tables)}


def compact(db_path: Path, keep_backup: bool = True) -> int:
    if not db_path.exists():
        print(f"No database at {db_path}")
        return 1

    new_path = db_path.with_suffix(".duckdb.compact")
    bak_path = db_path.with_suffix(".duckdb.bak")
    for stale in (new_path,):
        stale.unlink(missing_ok=True)

    size_before = db_path.stat().st_size

    src = duckdb.connect(str(db_path))
    print("Pruning derived rows no reader consumes...")
    pruned = prune_derived_history(src)
    for table, n in pruned.items():
        if n:
            print(f"  {table}: -{n} rows")

    before = table_counts(src)
    print(f"Copying {len(before)} tables into {new_path.name}...")
    # The source catalog is named after the file ("engine"), not "main".
    source_db = src.execute("SELECT current_database()").fetchone()[0]
    # ATTACH does not accept a bind parameter for the path.
    src.execute(f"ATTACH '{new_path}' AS compacted")
    # COPY FROM DATABASE copies schema + data for every table in one statement.
    src.execute(f"COPY FROM DATABASE {source_db} TO compacted")
    src.execute("DETACH compacted")
    src.close()

    dst = duckdb.connect(str(new_path), read_only=True)
    after = table_counts(dst)
    dst.close()

    missing = {t: (before[t], after.get(t)) for t in before if after.get(t) != before[t]}
    if missing:
        print("ROW COUNT MISMATCH — leaving the original in place:", file=sys.stderr)
        for t, (b, a) in missing.items():
            print(f"  {t}: {b} -> {a}", file=sys.stderr)
        new_path.unlink(missing_ok=True)
        return 2

    size_after = new_path.stat().st_size
    if keep_backup:
        bak_path.unlink(missing_ok=True)
        shutil.move(str(db_path), str(bak_path))
    else:
        db_path.unlink()
    shutil.move(str(new_path), str(db_path))

    print(f"Verified {len(before)} tables, {sum(before.values())} rows.")
    print(f"{size_before / 1e9:.2f} GB -> {size_after / 1e9:.3f} GB "
          f"({(1 - size_after / size_before) * 100:.1f}% smaller)")
    if keep_backup:
        print(f"Previous file kept at {bak_path.name} — delete it once you are satisfied.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-backup", action="store_true",
                    help="replace in place instead of keeping a .bak (needs less free space)")
    args = ap.parse_args()
    raise SystemExit(compact(Path(DB_PATH), keep_backup=not args.no_backup))
