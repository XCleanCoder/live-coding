/** Hardcoded offline exam pack — embedded from samples/*.txt at build time. */
export const OFFLINE_EXAM = {
  totalTimeboxMinutes: 90,
  security: {
    blockClipboard: true as boolean,
    blockMultiMonitor: true as boolean,
    blockFocusSwitch: true as boolean,
    cameraRequired: false as boolean,
    showCameraPreview: true as boolean,
  },
  problems: [
  {
    "id": "order-book",
    "title": "Build a crypto order book",
    "order": 1,
    "timeboxMinutes": 45,
    "languages": [
      "py"
    ],
    "summary": "Aggregated order book with snapshot, incremental updates, and best bid/ask.",
    "prompt": "Problem 1: Build a crypto order book\n\nImplement an aggregated order book for a crypto trading pair such as BTC/USDT.\n\nThe order book receives a snapshot and incremental updates.\n\nsnapshot = {\n    \"sequence\": 100,\n    \"bids\": [\n        (\"100.00\", \"1.50\"),\n        (\"99.50\", \"2.00\")\n    ],\n    \"asks\": [\n        (\"100.50\", \"1.00\"),\n        (\"101.00\", \"3.00\")\n    ]\n}\n\nupdates = [\n    {\n        \"sequence\": 101,\n        \"side\": \"bid\",\n        \"price\": \"100.00\",\n        \"quantity\": \"2.00\"\n    },\n    {\n        \"sequence\": 102,\n        \"side\": \"ask\",\n        \"price\": \"100.50\",\n        \"quantity\": \"0\"\n    }\n]\n\nImplement:\n\nclass OrderBook:\n    def load_snapshot(self, snapshot):\n        pass\n\n    def apply_update(self, update):\n        pass\n\n    def best_bid(self):\n        pass\n\n    def best_ask(self):\n        pass\n\n    def mid_price(self):\n        pass\n\n    def spread(self):\n        pass\n\nRequirements:\n- Bids must be ordered from highest to lowest price.\n- Asks must be ordered from lowest to highest price.\n- Quantity 0 removes the price level.\n- Reject duplicate updates.\n- Detect missing sequence numbers.\n- Do not use floating-point arithmetic for prices or quantities.\n- Return None if a best bid or ask is unavailable.\n\nPython's decimal module is suitable for exact decimal calculations.\n\nNotes:\nThis is a write-only exercise. You do not need to run the code in this platform.\nFocus on correctness, sequence handling, and clear structure.\n",
    "starters": {
      "py": "from decimal import Decimal\nfrom typing import Any\n\n\nclass OrderBook:\n    def __init__(self) -> None:\n        # TODO: choose your internal data structures\n        pass\n\n    def load_snapshot(self, snapshot: dict[str, Any]) -> None:\n        \"\"\"Load a full book snapshot and set the current sequence.\"\"\"\n        raise NotImplementedError\n\n    def apply_update(self, update: dict[str, Any]) -> None:\n        \"\"\"\n        Apply one incremental update.\n\n        Reject duplicates. Detect missing sequence numbers.\n        Quantity 0 removes the price level.\n        \"\"\"\n        raise NotImplementedError\n\n    def best_bid(self) -> tuple[Decimal, Decimal] | None:\n        \"\"\"Return (price, quantity) for the highest bid, or None.\"\"\"\n        raise NotImplementedError\n\n    def best_ask(self) -> tuple[Decimal, Decimal] | None:\n        \"\"\"Return (price, quantity) for the lowest ask, or None.\"\"\"\n        raise NotImplementedError\n\n    def mid_price(self) -> Decimal | None:\n        \"\"\"Return (best_bid + best_ask) / 2, or None if either side is missing.\"\"\"\n        raise NotImplementedError\n\n    def spread(self) -> Decimal | None:\n        \"\"\"Return best_ask - best_bid, or None if either side is missing.\"\"\"\n        raise NotImplementedError\n"
    }
  },
  {
    "id": "risk-engine",
    "title": "Implement a pre-trade risk engine",
    "order": 2,
    "timeboxMinutes": 25,
    "languages": [
      "py"
    ],
    "summary": "Validate orders against balances, position limits, notional caps, and price bands.",
    "prompt": "Problem 2: Implement a pre-trade risk engine\n\nCreate a risk-checking service that decides whether an order can be submitted.\n\nfrom dataclasses import dataclass\nfrom decimal import Decimal\nfrom typing import Literal\n\n@dataclass\nclass Order:\n    order_id: str\n    symbol: str\n    side: Literal[\"BUY\", \"SELL\"]\n    quantity: Decimal\n    limit_price: Decimal\n    reduce_only: bool = False\n\n@dataclass\nclass Account:\n    available_quote: Decimal\n    base_position: Decimal\n    max_order_notional: Decimal\n    max_position: Decimal\n\nImplement:\n\ndef validate_order(\n    order: Order,\n    account: Account,\n    current_price: Decimal,\n) -> tuple[bool, str]:\n    ...\n\nRules — reject the order when:\n- Quantity is zero or negative.\n- Price is zero or negative.\n- The order notional exceeds max_order_notional.\n- A buy order requires more quote currency than available.\n- A sell order exceeds the available position.\n- The resulting position exceeds max_position.\n- The order price is too far from the current market price (reject if more than 5% away from current_price).\n- The market price is stale or unavailable (current_price is None or <= 0).\n\nReturn:\n- (True, \"ACCEPTED\") on success\n- (False, \"<REASON_CODE>\") on rejection\n\nSuggested reason codes:\n- INVALID_QUANTITY\n- INVALID_PRICE\n- MAX_ORDER_NOTIONAL_EXCEEDED\n- INSUFFICIENT_QUOTE_BALANCE\n- INSUFFICIENT_BASE_POSITION\n- MAX_POSITION_EXCEEDED\n- PRICE_BAND_EXCEEDED\n- STALE_OR_MISSING_MARKET_PRICE\n\nNotes:\nThis is a write-only exercise. You do not need to run the code in this platform.\nPrefer clear reason codes and safe defaults (deny when information is missing).\n",
    "starters": {
      "py": "from dataclasses import dataclass\nfrom decimal import Decimal\nfrom typing import Literal\n\n\n@dataclass\nclass Order:\n    order_id: str\n    symbol: str\n    side: Literal[\"BUY\", \"SELL\"]\n    quantity: Decimal\n    limit_price: Decimal\n    reduce_only: bool = False\n\n\n@dataclass\nclass Account:\n    available_quote: Decimal\n    base_position: Decimal\n    max_order_notional: Decimal\n    max_position: Decimal\n\n\nMAX_PRICE_DEVIATION = Decimal(\"0.05\")  # 5%\n\n\ndef validate_order(\n    order: Order,\n    account: Account,\n    current_price: Decimal | None,\n) -> tuple[bool, str]:\n    \"\"\"\n    Return (True, \"ACCEPTED\") or (False, REASON_CODE).\n\n    Reject when quantity/price invalid, notional too large, balances insufficient,\n    position limits exceeded, price too far from market, or market price missing.\n    \"\"\"\n    raise NotImplementedError\n"
    }
  }
] as Array<{
    id: string;
    title: string;
    order: number;
    timeboxMinutes: number | null;
    languages: string[];
    summary: string;
    prompt: string;
    starters: Record<string, string>;
  }>,
};

export type OfflineProblem = (typeof OFFLINE_EXAM.problems)[number];
