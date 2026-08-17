from abc import ABC, abstractmethod
from pydantic import BaseModel


class AIProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        """model_tier: 'fast' | 'pro' | 'premium'.

        'premium' is reserved for the single highest-leverage call in the
        pipeline (currently only tailoring.py's Agent 2, the JD+resume
        semantic mapper) — a deliberate cost/quality tradeoff, not a
        general-purpose upgrade tier. A provider that has no distinct
        premium model should fall back to its 'pro' model for it.
        """

    @abstractmethod
    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        """Returns a validated instance of schema."""
