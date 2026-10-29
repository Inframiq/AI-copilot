import logging
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.services.ai_engine.base import (
    AIEmptyResponseError,
    AIProvider,
    AIRefusalError,
    AITruncatedError,
)
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.ai_budget import WEB_SEARCH_MODEL, check_input_size, ensure_ai_budget, note_spend
from app.services.plain_text import plain_model

logger = logging.getLogger("app")


class OpenAIProvider(AIProvider):
    def __init__(
        self,
        api_key: str,
        fast_model: str,
        premium_model: str,
        max_output_tokens: int = 4096,
        standard_model: str | None = None,
        research_model: str | None = None,
    ):
        self._client = AsyncOpenAI(api_key=api_key)
        self._fast_model = fast_model
        self._premium_model = premium_model
        # The "standard" tier; the fast model when not set.
        self._standard_model = standard_model or fast_model
        # The model for live web research; the fast model when not set.
        self._research_model = research_model or fast_model
        self._max_output_tokens = max_output_tokens

    # "fast" and "pro" both resolve to the budget model — deliberate, not an
    # oversight. Real per-call token estimates (docs/ai-pipeline.md) showed
    # putting every "pro"-tier call (Agent 2, Agent 3, prep questions, cover
    # letter) on the pricier model blows a $5-for-100-generations budget by
    # 2.5x; putting only Agent 2 (the JD+resume semantic mapping — the call
    # that most determines whether the tailoring makes sense) on it lands
    # close to that budget while still upgrading the highest-leverage step.
    # So Agent 2 (tailoring.py's _agent2_semantic_map) requests "premium" —
    # and since then Agent 3 (_agent3_write) and interview prep questions
    # (_agent4_generate_interview_questions: screening-level on the budget
    # model, and one call per Save to JD rather than per run) do too.
    # Everything else keeps requesting "pro" and gets the budget model.
    # "standard" sits between them: interview follow-up answers.
    def _model_for(self, model_tier: str) -> str:
        if model_tier == "premium":
            return self._premium_model
        if model_tier == "standard":
            return self._standard_model
        return self._fast_model

    def _log_usage(self, call_name: str, model_tier: str, model: str, usage) -> None:
        if usage is None:
            return
        reasoning_tokens = getattr(
            getattr(usage, "output_tokens_details", None), "reasoning_tokens", None
        )
        input_tokens = getattr(usage, "input_tokens", None)
        output_tokens = getattr(usage, "output_tokens", None)
        total_tokens = getattr(usage, "total_tokens", None)
        note_spend(model, input_tokens, output_tokens)
        logger.info(
            "ai_usage call=%s tier=%s model=%s input_tokens=%s output_tokens=%s "
            "reasoning_tokens=%s total_tokens=%s",
            call_name, model_tier, model,
            input_tokens, output_tokens, reasoning_tokens, total_tokens,
        )
        # Persist to ai_usage_events when a record_ai_usage(...) block is
        # active (deferred import keeps this module free of an app.core dep
        # at import time).
        try:
            from app.core.usage import record_call

            record_call(
                call_name=call_name, model=model, model_tier=model_tier,
                input_tokens=input_tokens, output_tokens=output_tokens,
                reasoning_tokens=reasoning_tokens, total_tokens=total_tokens,
            )
        except Exception:
            logger.debug("record_call failed", exc_info=True)


    @staticmethod
    def _refusal_text(response) -> str:
        """The refusal string the Responses API tucks inside output content,
        or "" when the response isn't a refusal."""
        for item in getattr(response, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                refusal = getattr(part, "refusal", None)
                if isinstance(refusal, str) and refusal:
                    return refusal
        return ""

    def _raise_for_empty(self, response, call_name: str, model: str, budget: int) -> None:
        """Turn a missing result into a typed, diagnosable error.

        Only ever called when the result is absent — a response flagged
        incomplete that nevertheless carries usable output is left alone, so a
        status quirk never discards work already paid for.
        """
        details = getattr(response, "incomplete_details", None)
        reason = getattr(details, "reason", None) if details else None
        context = f"call={call_name} model={model} max_output_tokens={budget}"
        if reason == "max_output_tokens":
            raise AITruncatedError(
                f"model ran out of output budget mid-response ({context}); "
                "the structured output never closed"
            )
        refusal = self._refusal_text(response)
        if refusal:
            raise AIRefusalError(f"model refused ({context}): {refusal}")
        raise AIEmptyResponseError(
            f"model returned no usable output ({context}, "
            f"status={getattr(response, 'status', None)!r}, reason={reason!r})"
        )

    async def complete(
        self,
        system: str,
        user: str,
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> str:
        # Bounded before anything is sent (app.core.ai_budget): one call's
        # size, and the whole site's spend today.
        check_input_size(system, user)
        await ensure_ai_budget()
        model = self._model_for(model_tier)
        response = await self._client.responses.create(
            model=model,
            instructions=system,
            input=user,
            max_output_tokens=max_output_tokens or self._max_output_tokens,
            # Resume and job text: nothing here reads a response back later,
            # so OpenAI has no reason to keep it (the API stores by default).
            store=False,
        )
        self._log_usage(call_name, model_tier, model, getattr(response, "usage", None))
        budget = max_output_tokens or self._max_output_tokens
        if not response.output_text:
            self._raise_for_empty(response, call_name, model, budget)
        return response.output_text

    async def complete_structured_with_web(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> tuple[BaseModel, list[str]]:
        """Structured output from live web research: the model must search
        (tool_choice "required") before it answers, and the URLs it read come
        back with the result. Each search is a billed tool call, recorded as
        its own usage row so the daily spend ceiling sees it."""
        check_input_size(system, user)
        await ensure_ai_budget()
        model = self._research_model
        response = await self._client.responses.parse(
            model=model,
            instructions=system,
            input=user,
            tools=[{"type": "web_search"}],
            tool_choice="required",
            include=["web_search_call.action.sources"],
            text_format=schema,
            max_output_tokens=max_output_tokens or self._max_output_tokens,
            store=False,
        )
        self._log_usage(call_name, "research", model, getattr(response, "usage", None))
        searches = [i for i in (getattr(response, "output", None) or []) if getattr(i, "type", "") == "web_search_call"]
        if searches:
            self._log_search_calls(call_name, len(searches))
        budget = max_output_tokens or self._max_output_tokens
        if response.output_parsed is None:
            self._raise_for_empty(response, call_name, model, budget)
        # Every structured answer reaches the app as keyboard text: no
        # curly quotes, long dashes or odd spaces (see services/plain_text.py).
        return plain_model(response.output_parsed), self._sources(searches)

    def _log_search_calls(self, call_name: str, count: int) -> None:
        """Bill `count` web-search tool calls: a usage row whose input_tokens
        is the number of searches, priced per call in ai_budget."""
        note_spend(WEB_SEARCH_MODEL, count, 0)
        try:
            from app.core.usage import record_call

            record_call(
                call_name=f"{call_name}:web_search", model=WEB_SEARCH_MODEL, model_tier="research",
                input_tokens=count, output_tokens=0, reasoning_tokens=0, total_tokens=count,
            )
        except Exception:
            logger.debug("record_call failed", exc_info=True)

    @staticmethod
    def _sources(searches: list) -> list[str]:
        """The URLs the searches read, in order, de-duplicated, without the
        utm_* tracking parameters the tool appends."""
        out: list[str] = []
        for item in searches:
            for src in getattr(getattr(item, "action", None), "sources", None) or []:
                url = getattr(src, "url", None) or (src.get("url") if isinstance(src, dict) else None)
                if not url:
                    continue
                parts = urlsplit(url)
                query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith("utm_")])
                clean = urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
                if clean not in out:
                    out.append(clean)
        return out

    async def complete_structured(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
        model_tier: str = "fast",
        max_output_tokens: int | None = None,
        call_name: str = "unknown",
    ) -> BaseModel:
        # gpt-5.6-luna rejects the `temperature` param on the Responses API
        # (400 Unsupported parameter) — neither budget nor premium GPT-5.6
        # tiers expose a sampling knob to set here.
        check_input_size(system, user)
        await ensure_ai_budget()
        model = self._model_for(model_tier)
        response = await self._client.responses.parse(
            model=model,
            instructions=system,
            input=user,
            text_format=schema,
            max_output_tokens=max_output_tokens or self._max_output_tokens,
            store=False,
        )
        self._log_usage(call_name, model_tier, model, getattr(response, "usage", None))
        budget = max_output_tokens or self._max_output_tokens
        if response.output_parsed is None:
            self._raise_for_empty(response, call_name, model, budget)
        return plain_model(response.output_parsed)
