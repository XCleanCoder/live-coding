from decimal import Decimal
from typing import Any


class OrderBook:
    def __init__(self) -> None:
        # TODO: choose your internal data structures
        pass

    def load_snapshot(self, snapshot: dict[str, Any]) -> None:
        """Load a full book snapshot and set the current sequence."""
        raise NotImplementedError

    def apply_update(self, update: dict[str, Any]) -> None:
        """
        Apply one incremental update.

        Reject duplicates. Detect missing sequence numbers.
        Quantity 0 removes the price level.
        """
        raise NotImplementedError

    def best_bid(self) -> tuple[Decimal, Decimal] | None:
        """Return (price, quantity) for the highest bid, or None."""
        raise NotImplementedError

    def best_ask(self) -> tuple[Decimal, Decimal] | None:
        """Return (price, quantity) for the lowest ask, or None."""
        raise NotImplementedError

    def mid_price(self) -> Decimal | None:
        """Return (best_bid + best_ask) / 2, or None if either side is missing."""
        raise NotImplementedError

    def spread(self) -> Decimal | None:
        """Return best_ask - best_bid, or None if either side is missing."""
        raise NotImplementedError
