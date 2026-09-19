from dataclasses import dataclass
from decimal import Decimal
from typing import Literal


@dataclass
class Order:
    order_id: str
    symbol: str
    side: Literal["BUY", "SELL"]
    quantity: Decimal
    limit_price: Decimal
    reduce_only: bool = False


@dataclass
class Account:
    available_quote: Decimal
    base_position: Decimal
    max_order_notional: Decimal
    max_position: Decimal


MAX_PRICE_DEVIATION = Decimal("0.05")  # 5%


def validate_order(
    order: Order,
    account: Account,
    current_price: Decimal | None,
) -> tuple[bool, str]:
    """
    Return (True, "ACCEPTED") or (False, REASON_CODE).

    Reject when quantity/price invalid, notional too large, balances insufficient,
    position limits exceeded, price too far from market, or market price missing.
    """
    raise NotImplementedError
