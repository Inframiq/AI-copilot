from abc import ABC, abstractmethod
from pydantic import BaseModel


class AIProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        """model_tier: 'fast' | 'pro'"""

    @abstractmethod
    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        """Returns a validated instance of schema."""
