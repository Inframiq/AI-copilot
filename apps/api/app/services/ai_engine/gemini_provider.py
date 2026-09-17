import re
import json
import logging
import google.generativeai as genai
from pydantic import BaseModel
from app.services.ai_engine.base import (
    AIEmptyResponseError,
    AIProvider,
    AIRefusalError,
    AITruncatedError,
)

logger = logging.getLogger("app")


def _strip_fence(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


class GeminiProvider(AIProvider):
    def __init__(self, fast_model: str, pro_model: str, api_key: str):
        genai.configure(api_key=api_key)
        # Raise max_output_tokens high enough for a full resume rewrite
        # (Agent 3 must emit one JSON entry per bullet — easily 8–16k tokens).
        gen_cfg = genai.GenerationConfig(max_output_tokens=16384)
        self._fast = genai.GenerativeModel(fast_model, generation_config=gen_cfg)
        self._pro = genai.GenerativeModel(pro_model, generation_config=gen_cfg)

    def _model(self, tier: str):
        # No distinct premium model here — "premium" falls back to "pro"
        # (the best available), not "fast" (a silent downgrade for the one
        # call that's supposed to be getting an upgrade). See base.py.
        if tier in ("pro", "premium"):
            return self._pro
        return self._fast

    def _log_usage(self, call_name: str, model_tier: str, usage) -> None:
        if usage is None:
            return
        logger.info(
            "ai_usage call=%s tier=%s prompt_tokens=%s output_tokens=%s total_tokens=%s",
            call_name, model_tier,
            getattr(usage, "prompt_token_count", None),
            getattr(usage, "candidates_token_count", None),
            getattr(usage, "total_token_count", None),
        )


    @staticmethod
    def _finish_reason(response) -> str:
        """The first candidate's finish reason as a plain string. The SDK may
        hand back an enum, an int, or a string depending on version, so
        compare on the name rather than an identity check."""
        for candidate in getattr(response, "candidates", None) or []:
            reason = getattr(candidate, "finish_reason", None)
            if reason is None:
                continue
            return str(getattr(reason, "name", reason))
        return ""

    def _text_or_raise(self, response, call_name: str, budget: "int | None") -> str:
        """The response's text, or a typed error explaining why there isn't any.

        Truncation must be distinguishable from "the model emitted bad JSON":
        tailoring._agent3_write splits and retries on AITruncatedError, and
        splitting would not help a genuinely malformed response — it would
        just double the spend.
        """
        reason = self._finish_reason(response)
        context = f"call={call_name} finish_reason={reason or 'unknown'} max_output_tokens={budget}"
        try:
            text = response.text
        except Exception:  # the SDK raises when a candidate carries no text part
            text = None

        if reason == "MAX_TOKENS":
            raise AITruncatedError(
                f"model ran out of output budget mid-response ({context})"
            )
        if reason in ("SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"):
            raise AIRefusalError(f"model declined to answer ({context})")
        if not text:
            raise AIEmptyResponseError(f"model returned no usable output ({context})")
        return text

    async def complete(
        self,
        system: str,
        user: str,
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> str:
        prompt = f"{system}\n\n{user}"
        gen_cfg = genai.GenerationConfig(max_output_tokens=max_output_tokens) if max_output_tokens else None
        response = await self._model(model_tier).generate_content_async(prompt, generation_config=gen_cfg)
        self._log_usage(call_name, model_tier, getattr(response, "usage_metadata", None))
        return self._text_or_raise(response, call_name, max_output_tokens)

    async def complete_structured(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> BaseModel:
        prompt = (
            f"{system}\n\nRespond ONLY with valid JSON matching this schema: "
            f"{schema.model_json_schema()}\n\n{user}"
        )
        gen_cfg = genai.GenerationConfig(max_output_tokens=max_output_tokens) if max_output_tokens else None
        response = await self._model(model_tier).generate_content_async(prompt, generation_config=gen_cfg)
        self._log_usage(call_name, model_tier, getattr(response, "usage_metadata", None))
        text = _strip_fence(self._text_or_raise(response, call_name, max_output_tokens))
        return schema.model_validate(json.loads(text))
