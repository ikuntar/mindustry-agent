"""Minimal data-plane smoke test and usage example."""

from mindustry_data import MapDataset, open_dataset


def main() -> None:
    dataset = open_dataset("obs://map/latest")
    if not isinstance(dataset, MapDataset):
        raise RuntimeError("expected a map dataset")
    print(dataset.summary())
    blocks = dataset.layer("block_id")
    teams = dataset.layer("team")
    if hasattr(blocks, "shape"):
        print("shape:", blocks.shape)
    print("tiles:", int((teams != 1).sum()) if hasattr(teams, "sum") else "pure-python layer")

    events = open_dataset("obs://events/latest")
    print(events.summary())


if __name__ == "__main__":
    main()
