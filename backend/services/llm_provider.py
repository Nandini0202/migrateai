"""Multi-provider LLM Layer for MigrateAI.

Supports:
- Ollama (Local inference, e.g. Qwen2.5-Coder, DeepSeek-Coder)
- Google Gemini API (Cloud inference: gemini-2.5-flash, gemini-2.5-pro, gemini-1.5-flash)
- OpenAI API (gpt-4o, gpt-4o-mini, o3-mini)
- Anthropic Claude API (claude-3-7-sonnet, claude-3-5-sonnet, claude-3-5-haiku)

Includes AST-guided prompt formulation, syntax verification, and self-correction retry loops.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple

import httpx
from schemas import AIConfig, AITestResponse


def clean_markdown_code_blocks(text: str) -> str:
    """Strip markdown code fence blocks if returned by the LLM."""
    text = text.strip()
    match = re.search(r"```(?:javascript|typescript|js|ts)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text


def verify_js_syntax(code: str) -> Tuple[bool, Optional[str]]:
    """Verify JavaScript/TypeScript syntax using node --check or bracket pairing fallback."""
    node = shutil.which("node")
    if node:
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as tf:
                tf.write(code)
                tf_path = tf.name
            try:
                proc = subprocess.run([node, "--check", tf_path], capture_output=True, text=True, timeout=5)
                if proc.returncode == 0:
                    return True, None
                err = proc.stderr.strip() or "Syntax error encountered during node compilation."
                return False, err
            finally:
                if os.path.exists(tf_path):
                    os.remove(tf_path)
        except Exception as e:
            # Fall back to bracket validation
            pass

    # Basic token bracket stack check
    stack: List[str] = []
    pairs = {")": "(", "}": "{", "]": "["}
    for char in code:
        if char in "({[":
            stack.append(char)
        elif char in ")}]":
            if not stack or stack[-1] != pairs[char]:
                return False, f"Mismatched bracket: '{char}'"
            stack.pop()

    if stack:
        return False, f"Unclosed bracket: '{stack[-1]}'"

    return True, None


class BaseLLMProvider(ABC):
    @abstractmethod
    def test_connection(self, config: AIConfig) -> AITestResponse:
        pass

    @abstractmethod
    def list_models(self, config: AIConfig) -> List[str]:
        pass

    @abstractmethod
    def execute_prompt(self, config: AIConfig, prompt: str, system_prompt: Optional[str] = None) -> str:
        pass


class OllamaProvider(BaseLLMProvider):
    def _get_host(self, config: AIConfig) -> str:
        host = config.base_url or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
        if "localhost" in host:
            host = host.replace("localhost", "127.0.0.1")
        return host.rstrip("/")

    def test_connection(self, config: AIConfig) -> AITestResponse:
        host = self._get_host(config)
        connect_to = min(0.3, float(config.timeout_seconds))
        timeout = httpx.Timeout(connect=connect_to, read=float(config.timeout_seconds), write=float(config.timeout_seconds), pool=1.0)
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(f"{host}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
                    is_model_present = any(config.model in m for m in models) if models else False
                    msg = f"Connected to Ollama at {host}."
                    if not is_model_present and models:
                        msg += f" Note: Configured model '{config.model}' was not found in local library. Available: {', '.join(models[:3])}"
                    return AITestResponse(
                        success=True,
                        provider="ollama",
                        model=config.model,
                        message=msg,
                        available_models=models,
                    )
                return AITestResponse(
                    success=False,
                    provider="ollama",
                    model=config.model,
                    message=f"Ollama returned HTTP status {resp.status_code}.",
                    available_models=[],
                )
        except Exception as e:
            return AITestResponse(
                success=False,
                provider="ollama",
                model=config.model,
                message=f"Could not connect to Ollama at {host}: {str(e)}",
                available_models=[],
            )

    def list_models(self, config: AIConfig) -> List[str]:
        host = self._get_host(config)
        timeout = httpx.Timeout(connect=0.3, read=1.0, write=1.0, pool=1.0)
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.get(f"{host}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        except Exception:
            pass
        return ["qwen2.5-coder:7b", "qwen2.5-coder:14b", "deepseek-coder:6.7b", "codellama:7b"]

    def execute_prompt(self, config: AIConfig, prompt: str, system_prompt: Optional[str] = None) -> str:
        host = self._get_host(config)
        payload: Dict[str, Any] = {
            "model": config.model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": config.temperature},
        }
        if system_prompt:
            payload["system"] = system_prompt

        with httpx.Client(timeout=float(config.timeout_seconds)) as client:
            resp = client.post(f"{host}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "")


class GeminiProvider(BaseLLMProvider):
    def _get_api_key(self, config: AIConfig) -> str:
        return config.api_key or os.environ.get("GEMINI_API_KEY", "")

    def test_connection(self, config: AIConfig) -> AITestResponse:
        key = self._get_api_key(config)
        if not key:
            return AITestResponse(
                success=False,
                provider="gemini",
                model=config.model,
                message="Gemini API Key is missing. Set GEMINI_API_KEY env var or provide it in AI configuration.",
                available_models=self.list_models(config),
            )
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.model}:generateContent?key={key}"
            payload = {
                "contents": [{"parts": [{"text": "Hello, respond with 'OK'"}]}],
                "generationConfig": {"temperature": 0.0, "maxOutputTokens": 10},
            }
            with httpx.Client(timeout=float(config.timeout_seconds)) as client:
                resp = client.post(url, json=payload)
                if resp.status_code == 200:
                    return AITestResponse(
                        success=True,
                        provider="gemini",
                        model=config.model,
                        message=f"Successfully authenticated with Google Gemini API ({config.model}).",
                        available_models=self.list_models(config),
                    )
                err_text = resp.text
                return AITestResponse(
                    success=False,
                    provider="gemini",
                    model=config.model,
                    message=f"Gemini API returned HTTP {resp.status_code}: {err_text[:200]}",
                    available_models=self.list_models(config),
                )
        except Exception as e:
            return AITestResponse(
                success=False,
                provider="gemini",
                model=config.model,
                message=f"Gemini connection failed: {str(e)}",
                available_models=self.list_models(config),
            )

    def list_models(self, config: AIConfig) -> List[str]:
        return [
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ]

    def execute_prompt(self, config: AIConfig, prompt: str, system_prompt: Optional[str] = None) -> str:
        key = self._get_api_key(config)
        if not key:
            raise ValueError("GEMINI_API_KEY is not set.")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.model}:generateContent?key={key}"
        contents = []
        if system_prompt:
            contents.append({"role": "user", "parts": [{"text": f"System context:\n{system_prompt}"}]})
            contents.append({"role": "model", "parts": [{"text": "Understood. Proceed with instructions."}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        payload = {
            "contents": contents,
            "generationConfig": {
                "temperature": config.temperature,
                "maxOutputTokens": 4096,
            },
        }
        with httpx.Client(timeout=float(config.timeout_seconds)) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise ValueError("No response candidates returned by Gemini API.")
            parts = candidates[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in parts)


class OpenAIProvider(BaseLLMProvider):
    def _get_api_key(self, config: AIConfig) -> str:
        return config.api_key or os.environ.get("OPENAI_API_KEY", "")

    def test_connection(self, config: AIConfig) -> AITestResponse:
        key = self._get_api_key(config)
        if not key:
            return AITestResponse(
                success=False,
                provider="openai",
                model=config.model,
                message="OpenAI API Key is missing. Set OPENAI_API_KEY env var or provide it in AI configuration.",
                available_models=self.list_models(config),
            )
        try:
            url = "https://api.openai.com/v1/models"
            with httpx.Client(timeout=float(config.timeout_seconds)) as client:
                resp = client.get(url, headers={"Authorization": f"Bearer {key}"})
                if resp.status_code == 200:
                    return AITestResponse(
                        success=True,
                        provider="openai",
                        model=config.model,
                        message=f"Successfully authenticated with OpenAI API.",
                        available_models=self.list_models(config),
                    )
                return AITestResponse(
                    success=False,
                    provider="openai",
                    model=config.model,
                    message=f"OpenAI returned HTTP {resp.status_code}: {resp.text[:200]}",
                    available_models=self.list_models(config),
                )
        except Exception as e:
            return AITestResponse(
                success=False,
                provider="openai",
                model=config.model,
                message=f"OpenAI connection error: {str(e)}",
                available_models=self.list_models(config),
            )

    def list_models(self, config: AIConfig) -> List[str]:
        return ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4-turbo"]

    def execute_prompt(self, config: AIConfig, prompt: str, system_prompt: Optional[str] = None) -> str:
        key = self._get_api_key(config)
        if not key:
            raise ValueError("OPENAI_API_KEY is not set.")
        url = "https://api.openai.com/v1/chat/completions"
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
        }
        with httpx.Client(timeout=float(config.timeout_seconds)) as client:
            resp = client.post(url, headers={"Authorization": f"Bearer {key}"}, json=payload)
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices", [])
            if not choices:
                raise ValueError("No completion choices returned by OpenAI.")
            return choices[0].get("message", {}).get("content", "")


class ClaudeProvider(BaseLLMProvider):
    def _get_api_key(self, config: AIConfig) -> str:
        return config.api_key or os.environ.get("ANTHROPIC_API_KEY", "")

    def test_connection(self, config: AIConfig) -> AITestResponse:
        key = self._get_api_key(config)
        if not key:
            return AITestResponse(
                success=False,
                provider="claude",
                model=config.model,
                message="Anthropic API Key is missing. Set ANTHROPIC_API_KEY env var or provide it in AI configuration.",
                available_models=self.list_models(config),
            )
        try:
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            payload = {
                "model": config.model,
                "max_tokens": 10,
                "messages": [{"role": "user", "content": "ping"}],
            }
            with httpx.Client(timeout=float(config.timeout_seconds)) as client:
                resp = client.post(url, headers=headers, json=payload)
                if resp.status_code == 200:
                    return AITestResponse(
                        success=True,
                        provider="claude",
                        model=config.model,
                        message="Successfully authenticated with Anthropic Claude API.",
                        available_models=self.list_models(config),
                    )
                return AITestResponse(
                    success=False,
                    provider="claude",
                    model=config.model,
                    message=f"Claude API returned HTTP {resp.status_code}: {resp.text[:200]}",
                    available_models=self.list_models(config),
                )
        except Exception as e:
            return AITestResponse(
                success=False,
                provider="claude",
                model=config.model,
                message=f"Claude connection error: {str(e)}",
                available_models=self.list_models(config),
            )

    def list_models(self, config: AIConfig) -> List[str]:
        return [
            "claude-3-7-sonnet-latest",
            "claude-3-5-sonnet-latest",
            "claude-3-5-haiku-latest",
        ]

    def execute_prompt(self, config: AIConfig, prompt: str, system_prompt: Optional[str] = None) -> str:
        key = self._get_api_key(config)
        if not key:
            raise ValueError("ANTHROPIC_API_KEY is not set.")
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        payload = {
            "model": config.model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            payload["system"] = system_prompt

        with httpx.Client(timeout=float(config.timeout_seconds)) as client:
            resp = client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            content_blocks = data.get("content", [])
            return "".join(b.get("text", "") for b in content_blocks if b.get("type") == "text")


_PROVIDERS: Dict[str, BaseLLMProvider] = {
    "ollama": OllamaProvider(),
    "gemini": GeminiProvider(),
    "openai": OpenAIProvider(),
    "claude": ClaudeProvider(),
}


def get_llm_provider(provider_name: str) -> BaseLLMProvider:
    provider = _PROVIDERS.get(provider_name.lower())
    if not provider:
        raise ValueError(f"Unsupported AI provider '{provider_name}'. Supported: {list(_PROVIDERS.keys())}")
    return provider


class LLMTransformationService:
    """Orchestrates LLM-powered code transformations with syntax verification and self-correction."""

    SYSTEM_PROMPT = (
        "You are an expert full-stack TypeScript and JavaScript migration engineer. "
        "Your task is to transform MongoDB/Mongoose database access code to PostgreSQL with Prisma ORM. "
        "Strict rules:\n"
        "1. Preserve the exact function signature, parameters, and return type.\n"
        "2. Replace Mongoose model calls (e.g. User.find(), doc.save()) with PrismaClient equivalents (e.g. prisma.user.findMany(), prisma.user.create()).\n"
        "3. Ensure queries match the target schema.prisma structure.\n"
        "4. Return ONLY valid, executable JavaScript/TypeScript code for the function replacement.\n"
        "5. Do NOT include markdown fences, conversational greetings, explanations, or commentary."
    )

    _reachability_cache: Dict[str, Tuple[bool, str, float]] = {}

    @classmethod
    def check_reachability(cls, config: AIConfig) -> Tuple[bool, str]:
        import time
        now = time.time()
        cache_key = f"{config.provider}:{config.base_url}:{config.model}"
        cached = cls._reachability_cache.get(cache_key)
        if cached and (now - cached[2]) < 30.0:
            return cached[0], cached[1]

        try:
            provider = get_llm_provider(config.provider)
            quick_cfg = config.model_copy(update={"timeout_seconds": 0.5})
            conn = provider.test_connection(quick_cfg)
            cls._reachability_cache[cache_key] = (conn.success, conn.message, now)
            return conn.success, conn.message
        except Exception as e:
            cls._reachability_cache[cache_key] = (False, str(e), now)
            return False, str(e)

    @classmethod
    def transform_function_with_retry(
        cls,
        config: AIConfig,
        source_code: str,
        source_operation: str,
        target_operation: str,
        model_name: str,
        file_path: str,
        prisma_schema: str = "",
    ) -> Tuple[Optional[str], List[str], bool]:
        """
        Transform a function using the configured LLM with automatic retry on syntax failure.
        Returns: (transformed_code, change_descriptions, review_required)
        """
        # Pre-flight check: verify provider is reachable (cached 30s) before attempting transformation
        is_reachable, reachability_msg = cls.check_reachability(config)
        if not is_reachable:
            return (
                None,
                [f"AI provider '{config.provider}' unreachable ({reachability_msg}). Fell back to deterministic rule engine."],
                False,
            )

        provider = get_llm_provider(config.provider)

        prompt = (
            f"Migrate the following function in '{file_path}' from Mongoose to Prisma.\n\n"
            f"Target Model: {model_name}\n"
            f"Source Operation: {source_operation}\n"
            f"Target Prisma Operation: {target_operation}\n\n"
            f"Target Prisma Schema:\n```prisma\n{prisma_schema or '// Default schema'}\n```\n\n"
            f"Original Function Code:\n```javascript\n{source_code}\n```\n\n"
            f"Output strictly the replacement code for this function:"
        )

        attempts = 0
        last_error = ""
        current_prompt = prompt

        while attempts <= config.max_retries:
            attempts += 1
            try:
                raw_response = provider.execute_prompt(
                    config=config,
                    prompt=current_prompt,
                    system_prompt=cls.SYSTEM_PROMPT,
                )
                cleaned_code = clean_markdown_code_blocks(raw_response)

                if not cleaned_code or len(cleaned_code) < 10:
                    last_error = "LLM returned empty or truncated response."
                    continue

                # Run syntax verification
                is_valid, syntax_err = verify_js_syntax(cleaned_code)
                if is_valid:
                    note = f"Migrated {source_operation or model_name} using {config.provider} ({config.model})"
                    if attempts > 1:
                        note += f" (self-corrected after {attempts - 1} retry)"
                    return cleaned_code, [note], False

                last_error = syntax_err or "Syntax validation failed."
                # Build self-correction prompt
                current_prompt = (
                    f"{prompt}\n\n"
                    f"PREVIOUS ATTEMPT FAILED SYNTAX CHECK:\n{last_error}\n\n"
                    f"Fix the syntax error and return strictly valid JavaScript code:"
                )
            except Exception as e:
                last_error = str(e)

        # Retries exhausted
        return None, [f"AI transformation failed with {config.provider}: {last_error}"], True
