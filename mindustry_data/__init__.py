"""Read-only client for the Mindustry probe data plane.

This is deliberately small: it resolves a DatasetRef to the local probe
discovery file (or MINDUSTRY_DATA_BASE/TOKEN), downloads the immutable map
snapshot, and decodes it into layers. It never writes to the game.
"""

from __future__ import annotations

import json
import os
import struct
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

try:  # optional; the pure-Python fallback still works
    import numpy as np
except ImportError:  # pragma: no cover
    np = None


def _discovery_path() -> str:
    return os.environ.get(
        "MINDUSTRY_DATA_DISCOVERY",
        os.path.join(tempfile.gettempdir(), "mindustry-ai-probe", "bridge-info.json"),
    )


def _discovery() -> dict[str, Any]:
    try:
        with open(_discovery_path(), encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


@dataclass
class DatasetRef:
    ref: str
    kind: str
    revision: int
    manifest: dict[str, Any]


class MapDataset:
    def __init__(self, ref: DatasetRef, width: int, height: int, layers: dict[str, Any]):
        self.ref = ref
        self.width = width
        self.height = height
        self.layers = layers

    def layer(self, name: str):
        if name not in self.layers:
            raise KeyError(f"unknown layer {name!r}; available: {', '.join(self.layers)}")
        return self.layers[name]

    def summary(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "ref": self.ref.ref,
            "revision": self.ref.revision,
            "width": self.width,
            "height": self.height,
            "layers": list(self.layers),
        }
        if np is not None:
            result["non_air_tiles"] = int((self.layer("block_id") != 0).sum())
            result["solid_tiles"] = int((self.layer("solid") != 0).sum())
        return result


class EventDataset:
    def __init__(self, ref: DatasetRef, events: list[dict[str, Any]]):
        self.ref = ref
        self.events = events

    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for event in self.events:
            event_type = str(event.get("type", "unknown"))
            counts[event_type] = counts.get(event_type, 0) + 1
        return {"ref": self.ref.ref, "revision": self.ref.revision, "events": len(self.events), "by_type": counts}


def _parse_ref(ref: str) -> tuple[str, str]:
    if not ref.startswith("obs://"):
        raise ValueError(f"unsupported dataset ref: {ref!r}")
    rest = ref[len("obs://") :]
    if rest.startswith("map/"):
        return "map", rest[len("map/") :]
    if rest.startswith("events/"):
        return "events", rest[len("events/") :]
    raise ValueError(f"unsupported dataset ref: {ref!r}")


def _revision_id(value: str) -> str:
    if value.startswith("rev/"):
        return value[len("rev/") :]
    if value == "latest":
        return "current"
    return value


def _request(base: str, token: str | None, path: str) -> bytes:
    request = urllib.request.Request(base.rstrip("/") + path)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"data plane HTTP {error.code}: {body}") from error


def _decode_map(payload: bytes, manifest: dict[str, Any]) -> MapDataset:
    if len(payload) < 16 or payload[:4] != b"MND1":
        raise RuntimeError("bad map snapshot header")
    width, height, layer_count = struct.unpack_from("<iii", payload, 4)
    expected = 16 + width * height * layer_count * 2
    if len(payload) != expected:
        raise RuntimeError(f"map snapshot length mismatch: {len(payload)} != {expected}")
    names = list(manifest.get("schema", {}).get("layers", []))
    if len(names) != layer_count:
        names = ["block_id", "team", "drop_id", "solid"][:layer_count]
    if np is not None:
        raw = np.frombuffer(payload, dtype="<i2", count=width * height * layer_count, offset=16)
        layers = {name: raw[index * width * height : (index + 1) * width * height].reshape(height, width)
                  for index, name in enumerate(names)}
    else:
        values = list(struct.unpack_from(f"<{width * height * layer_count}h", payload, 16))
        layers = {}
        for index, name in enumerate(names):
            flat = values[index * width * height : (index + 1) * width * height]
            layers[name] = [flat[row * width : (row + 1) * width] for row in range(height)]
    return MapDataset(
        DatasetRef(
            ref=str(manifest.get("ref", "obs://map/latest")),
            kind="map",
            revision=int(manifest.get("revision", 0)),
            manifest=manifest,
        ),
        width,
        height,
        layers,
    )


def open_dataset(ref: str):
    """Open a map or event snapshot described by a DatasetRef."""
    kind, remainder = _parse_ref(ref)
    info = _discovery()
    base = os.environ.get("MINDUSTRY_DATA_BASE") or info.get("dataBaseUrl")
    token = os.environ.get("MINDUSTRY_DATA_TOKEN") or info.get("dataToken")
    if not base:
        raise RuntimeError("no data plane base URL; set MINDUSTRY_DATA_BASE or start probe")
    revision = _revision_id(remainder)

    if kind == "map":
        manifest_bytes = _request(base, token, f"/manifest/{revision}")
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        actual_revision = manifest.get("revision", revision)
        payload = _request(base, token, f"/map/{actual_revision}")
        return _decode_map(payload, manifest)

    payload = _request(base, token, f"/events/{revision}")
    events = [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]
    actual_revision = max((int(event.get("id", 0)) for event in events), default=0)
    return EventDataset(
        DatasetRef(ref=ref, kind="events", revision=actual_revision, manifest={}),
        events,
    )


__all__ = ["DatasetRef", "MapDataset", "EventDataset", "open_dataset"]
