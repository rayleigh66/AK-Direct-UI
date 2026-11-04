#!/usr/bin/env python3
"""Validate the resolved Compose model before any smoke container starts."""

import argparse
import json
import os
import sys
from urllib.parse import unquote, urlparse

PRODUCTION_VOLUME = "aoking-direct_postgres_data"


def fail(message: str) -> None:
    print(f"Smoke Compose config validation failed: {message}", file=sys.stderr)
    sys.exit(1)


def load_env(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def service_env(service: dict) -> dict[str, str]:
    env = service.get("environment") or {}
    if isinstance(env, list):
        parsed: dict[str, str] = {}
        for item in env:
            key, _, value = str(item).partition("=")
            parsed[key] = value
        return parsed
    return {str(key): str(value) for key, value in env.items()}


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def check_database_url(value: str, expected_url: str, label: str) -> None:
    try:
        actual = urlparse(value)
        expected = urlparse(expected_url)
    except ValueError:
        fail(f"{label} is not a valid URL")

    require(actual.scheme in ("postgres", "postgresql"), f"{label} must use postgres")
    require(actual.hostname == "db", f"{label} must target the smoke db service")
    require((actual.port or 5432) == (expected.port or 5432), f"{label} port mismatch")
    require(
        unquote(actual.username or "") == unquote(expected.username or ""),
        f"{label} user mismatch",
    )
    require(
        unquote(actual.password or "") == unquote(expected.password or ""),
        f"{label} password mismatch",
    )
    require(actual.path == expected.path, f"{label} database mismatch")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--production-backup-dir", required=True)
    parser.add_argument("--production-volume", default=PRODUCTION_VOLUME)
    args = parser.parse_args()

    expected = load_env(args.env_file)
    required_keys = [
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "DATABASE_URL",
        "WEB_PORT",
        "BACKUP_HOST_DIR",
        "BACKUP_RETENTION_DAYS",
        "API_IMAGE",
        "MIGRATE_IMAGE",
        "WEB_IMAGE",
    ]
    for key in required_keys:
        require(bool(expected.get(key)), f"smoke env file is missing {key}")

    config = json.load(sys.stdin)
    require(config.get("name") == args.project, "resolved project name is not the smoke project")
    services = config.get("services") or {}

    db = services.get("db") or {}
    migrate = services.get("migrate") or {}
    api = services.get("api") or {}
    web = services.get("web") or {}
    backup = services.get("backup") or {}

    db_env = service_env(db)
    require(db_env.get("POSTGRES_DB") == expected["POSTGRES_DB"], "db POSTGRES_DB mismatch")
    require(db_env.get("POSTGRES_USER") == expected["POSTGRES_USER"], "db POSTGRES_USER mismatch")
    require(
        db_env.get("POSTGRES_PASSWORD") == expected["POSTGRES_PASSWORD"],
        "db POSTGRES_PASSWORD mismatch",
    )

    for label, service in (("migrate", migrate), ("api", api)):
        check_database_url(service_env(service).get("DATABASE_URL", ""), expected["DATABASE_URL"], label)

    backup_env = service_env(backup)
    require(backup_env.get("PGHOST") == "db", "backup PGHOST must be db")
    require(backup_env.get("PGPORT") == "5432", "backup PGPORT must be 5432")
    require(backup_env.get("PGDATABASE") == expected["POSTGRES_DB"], "backup PGDATABASE mismatch")
    require(backup_env.get("PGUSER") == expected["POSTGRES_USER"], "backup PGUSER mismatch")
    require(backup_env.get("PGPASSWORD") == expected["POSTGRES_PASSWORD"], "backup PGPASSWORD mismatch")
    require(
        str(backup_env.get("BACKUP_RETENTION_DAYS")) == expected["BACKUP_RETENTION_DAYS"],
        "backup retention mismatch",
    )

    require(api.get("image") == expected["API_IMAGE"], "api image mismatch")
    require(web.get("image") == expected["WEB_IMAGE"], "web image mismatch")
    require(migrate.get("image") == expected["MIGRATE_IMAGE"], "migrate image mismatch")

    backup_dir = os.path.realpath(expected["BACKUP_HOST_DIR"])
    production_backup_dir = os.path.realpath(args.production_backup_dir)
    require(backup_dir != production_backup_dir, "smoke backup dir equals the production backup dir")
    backup_mounts = [
        volume
        for volume in (backup.get("volumes") or [])
        if str(volume.get("target", "")).rstrip("/") == "/backups"
    ]
    require(len(backup_mounts) == 1, "backup must mount exactly one /backups directory")
    backup_mount = backup_mounts[0]
    require(backup_mount.get("type") == "bind", "backup /backups must be a bind mount")
    require(
        os.path.realpath(str(backup_mount.get("source", ""))) == backup_dir,
        "backup /backups source is not the isolated smoke directory",
    )

    data_mounts = [
        volume
        for volume in (db.get("volumes") or [])
        if str(volume.get("target", "")).rstrip("/") == "/var/lib/postgresql/data"
    ]
    require(len(data_mounts) == 1, "db must mount exactly one data volume")
    require(data_mounts[0].get("type") == "volume", "db data mount must be a named volume")
    data_source = str(data_mounts[0].get("source", ""))
    volume_defs = config.get("volumes") or {}
    resolved_volume = str((volume_defs.get(data_source) or {}).get("name", data_source))
    require(resolved_volume != args.production_volume, "db uses the production volume")
    require(
        args.project in resolved_volume or resolved_volume.startswith(args.project),
        "db data volume is not project-scoped",
    )

    web_ports = web.get("ports") or []
    port_80 = [port for port in web_ports if str(port.get("target")) == "80"]
    require(len(port_80) == 1, "web must publish exactly port 80")
    published = port_80[0]
    require(published.get("host_ip") == "127.0.0.1", "web host IP must be loopback")
    require(str(published.get("published")) == str(expected["WEB_PORT"]), "web port mismatch")

    print(f"Smoke Compose config validation passed for {args.project}.")


if __name__ == "__main__":
    main()
