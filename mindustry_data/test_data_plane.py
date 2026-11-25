"""Smoke tests for the probe read-only data plane."""

import json
import os
import struct
import tempfile
import unittest
import urllib.error
import urllib.request

from mindustry_data import EventDataset, MapDataset, open_dataset


def _discovery():
    path = os.environ.get(
        "MINDUSTRY_DATA_DISCOVERY",
        os.path.join(tempfile.gettempdir(), "mindustry-agent-probe", "bridge-info.json"),
    )
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


class DataPlaneTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.info = _discovery()
            cls.base = cls.info["dataBaseUrl"].rstrip("/")
            cls.token = cls.info["dataToken"]
            request = urllib.request.Request(cls.base + "/manifest/current")
            request.add_header("Authorization", f"Bearer {cls.token}")
            urllib.request.urlopen(request, timeout=2).close()
        except (OSError, KeyError, urllib.error.URLError) as error:
            raise unittest.SkipTest(f"data plane is not running: {error}") from error

    def _request(self, path, method="GET", auth=True):
        request = urllib.request.Request(self.base + path, method=method)
        if auth:
            request.add_header("Authorization", f"Bearer {self.token}")
        return urllib.request.urlopen(request, timeout=10)

    def test_map_dataset_decodes(self):
        dataset = open_dataset("obs://map/latest")
        if not isinstance(dataset, MapDataset):
            self.fail("expected a map dataset")
        self.assertGreater(dataset.width, 0)
        self.assertGreater(dataset.height, 0)
        self.assertIn("block_id", dataset.layers)
        self.assertIn("team", dataset.layers)

    def test_map_binary_header_and_read_only(self):
        manifest = json.loads(self._request("/manifest/current").read())
        revision = manifest["revision"]
        with self._request(f"/map/{revision}") as response:
            payload = response.read()
            self.assertEqual(response.status, 200)
        self.assertEqual(payload[:4], b"MND1")
        width, height, layers = struct.unpack_from("<iii", payload, 4)
        self.assertEqual(len(payload), 16 + width * height * layers * 2)

        with self._request(f"/map/{revision}/chunk/0/0") as response:
            chunk = response.read()
        self.assertEqual(chunk[:4], b"MNC1")
        chunk_width, chunk_height, chunk_layers = struct.unpack_from("<iii", chunk, 12)
        self.assertGreater(chunk_width, 0)
        self.assertGreater(chunk_height, 0)
        self.assertEqual(len(chunk), 24 + chunk_width * chunk_height * chunk_layers * 2)

        request = urllib.request.Request(self.base + f"/map/{revision}")
        request.add_header("Authorization", f"Bearer {self.token}")
        request.add_header("Range", "bytes=0-15")
        with urllib.request.urlopen(request, timeout=10) as response:
            ranged = response.read()
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers.get("Content-Range"), f"bytes 0-15/{len(payload)}")
        self.assertEqual(ranged, payload[:16])

        try:
            self._request(f"/map/{revision}", auth=False)
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code, 401)
        else:
            self.fail("unauthorized data-plane read unexpectedly succeeded")

        try:
            self._request(f"/map/{revision}", method="POST")
        except urllib.error.HTTPError as error:
            self.assertEqual(error.code, 405)
        else:
            self.fail("write method unexpectedly succeeded")

    def test_events_dataset(self):
        dataset = open_dataset("obs://events/latest")
        if not isinstance(dataset, EventDataset):
            self.fail("expected an event dataset")
        self.assertGreaterEqual(dataset.ref.revision, 0)
        self.assertIsInstance(dataset.events, list)

        with self._request(f"/events/{dataset.ref.revision}/page/0?limit=1") as response:
            page = [line for line in response.read().decode().splitlines() if line]
            self.assertEqual(response.status, 200)
            self.assertLessEqual(len(page), 1)
            self.assertIn("X-Next-Cursor", response.headers)
        if dataset.events:
            self.assertEqual(len(page), 1)
            self.assertEqual(json.loads(page[0])["id"], dataset.events[0]["id"])


if __name__ == "__main__":
    unittest.main()
