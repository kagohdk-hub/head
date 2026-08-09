#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ID_RE = re.compile(r"^[a-z0-9]{4}$")


def normalize_id(raw_id: Optional[str], used_ids: set[str]) -> str:
    if isinstance(raw_id, str) and ID_RE.fullmatch(raw_id):
        return raw_id
    for idx in range(1, 10000):
        candidate = f"a{idx:03d}"
        if candidate not in used_ids:
            return candidate
    raise ValueError("Could not generate a unique node ID")


def migrate_data(data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("Top-level JSON value must be an object")
    nodes = data.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("JSON must contain a 'nodes' array")

    migrated_nodes: List[Dict[str, Any]] = []
    old_to_new: Dict[str, str] = {}
    used_ids: set[str] = set()

    for node in nodes:
        if not isinstance(node, dict):
            continue
        original_id = node.get("id")
        new_id = normalize_id(original_id if isinstance(original_id, str) else None, used_ids)
        used_ids.add(new_id)
        if isinstance(original_id, str):
            old_to_new[original_id] = new_id

    for node in nodes:
        if not isinstance(node, dict):
            continue
        original_id = node.get("id")
        new_id = old_to_new.get(original_id, str(original_id)) if isinstance(original_id, str) else ""
        new_node = dict(node)
        new_node["id"] = new_id
        if "x" in new_node:
            del new_node["x"]
        if "y" in new_node:
            del new_node["y"]

        requires = new_node.get("requires")
        if isinstance(requires, list):
            migrated_groups = []
            for group in requires:
                if isinstance(group, list):
                    migrated_groups.append([old_to_new.get(dep, dep) for dep in group if isinstance(dep, str)])
            new_node["requires"] = migrated_groups

        migrated_nodes.append(new_node)

    node_positions: Dict[str, Dict[str, Any]] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        original_id = node.get("id")
        if not isinstance(original_id, str):
            continue
        next_id = old_to_new.get(original_id, original_id)
        pos: Dict[str, Any] = {}
        if "x" in node and isinstance(node.get("x"), (int, float)):
            pos["x"] = node["x"]
        if "y" in node and isinstance(node.get("y"), (int, float)):
            pos["y"] = node["y"]
        if pos:
            node_positions[next_id] = pos

    existing_positions = data.get("node_positions")
    if isinstance(existing_positions, dict):
        for key, value in existing_positions.items():
            if isinstance(value, dict) and isinstance(key, str):
                node_positions[key] = value

    migrated = dict(data)
    migrated["nodes"] = migrated_nodes
    migrated["node_positions"] = node_positions
    return migrated


def process_file(path: Path, out_path: Optional[Path] = None) -> Path:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    migrated = migrate_data(data)
    target = out_path or path
    with target.open("w", encoding="utf-8") as fh:
        json.dump(migrated, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate goal-network JSON files to the new node ID and node_positions format")
    parser.add_argument("paths", nargs="*", help="JSON files to migrate")
    args = parser.parse_args()

    if args.paths:
        targets = [Path(p) for p in args.paths]
    else:
        cwd = Path.cwd()
        targets = sorted([p for p in cwd.glob("*.json") if p.is_file()])

    if not targets:
        print("No JSON files found", file=sys.stderr)
        return 1

    for path in targets:
        if not path.exists():
            print(f"Missing file: {path}", file=sys.stderr)
            continue
        output = process_file(path)
        print(f"Migrated: {path} -> {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
