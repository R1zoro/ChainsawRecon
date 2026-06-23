from io import BytesIO
from urllib import error

from bounty_agent.llm import ChatMessage, OpenAICompatibleClient


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self) -> bytes:
        return b'{"choices":[{"message":{"content":"{\\"action\\":\\"finish\\"}"}}]}'


def test_llm_retries_temporary_server_errors(monkeypatch) -> None:
    attempts = 0

    def fake_urlopen(req, timeout):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise error.HTTPError(req.full_url, 500, "Internal Server Error", {}, BytesIO(b'{"error":"loading"}'))
        return FakeResponse()

    monkeypatch.setattr("bounty_agent.llm.request.urlopen", fake_urlopen)
    monkeypatch.setattr("bounty_agent.llm.time.sleep", lambda seconds: None)
    client = OpenAICompatibleClient("http://localhost:11434/v1", "ollama", "test")

    result = client.complete([ChatMessage("user", "test")])

    assert result == '{"action":"finish"}'
    assert attempts == 3
