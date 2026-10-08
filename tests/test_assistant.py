import json
from datetime import date
from types import SimpleNamespace

from app.services import assistant

from .conftest import API, category_id, h, make_user


def _fake_client(responses, captured):
    class FakeCompletions:
        def create(self, **kw):
            captured.append(json.loads(json.dumps(kw["messages"], default=lambda o: o.__dict__)))
            return responses.pop(0)

    class FakeClient:
        def __init__(self, **_):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    return FakeClient


class _Message(SimpleNamespace):
    def model_dump(self, exclude_none=False):
        return {"role": "assistant", "content": self.content,
                "tool_calls": [{"id": c.id, "type": "function",
                                "function": {"name": c.function.name, "arguments": c.function.arguments}}
                               for c in self.tool_calls or []]}


def _response(message, finish_reason):
    return SimpleNamespace(choices=[SimpleNamespace(message=message, finish_reason=finish_reason)])


def _text(text):
    return _response(_Message(content=text, tool_calls=None, refusal=None), "stop")


def _tool_call(name, args, id_="call_1"):
    call = SimpleNamespace(id=id_, type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args)))
    return _response(_Message(content=None, tool_calls=[call], refusal=None), "tool_calls")


def test_assistant_unavailable_without_api_key(client, user):
    assert client.get(f"{API}/assistant/status", headers=h(user)).json() == {"available": False}
    r = client.post(f"{API}/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=h(user))
    assert r.status_code == 200 and r.json()["available"] is False


def test_assistant_requires_auth(client):
    assert client.post(f"{API}/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 401


def test_assistant_runs_tool_loop_scoped_to_user(client, user, monkeypatch):
    today = date.today().isoformat()
    groceries = category_id(client, user, "Groceries")
    client.post(f"{API}/transactions", json={"kind": "expense", "amount": "42.50", "date": today,
                                             "category_id": groceries, "description": "Corner market"}, headers=h(user))
    other = make_user(client)
    client.post(f"{API}/transactions", json={"kind": "expense", "amount": "999", "date": today,
                                             "description": "Not yours"}, headers=h(other))

    captured = []
    responses = [_tool_call("search_transactions", {"category": "groceries"}), _text("You spent **42.50** on groceries.")]
    monkeypatch.setattr(assistant.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(assistant.openai, "OpenAI", _fake_client(responses, captured))

    r = client.post(f"{API}/assistant/chat", headers=h(user),
                    json={"messages": [{"role": "user", "content": "How much on groceries?"}]})
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == "You spent **42.50** on groceries."
    tool_result = captured[1][-1]
    assert tool_result["role"] == "tool" and tool_result["tool_call_id"] == "call_1"
    data = json.loads(tool_result["content"])
    assert data["total_matches"] == 1 and data["transactions"][0]["description"] == "Corner market"
    assert "Not yours" not in tool_result["content"]


def test_assistant_tool_errors_are_reported_to_model(client, user, monkeypatch):
    captured = []
    responses = [_tool_call("search_transactions", {"start_date": "not-a-date"}), _text("ok")]
    monkeypatch.setattr(assistant.settings, "llm_api_key", "test-key")
    monkeypatch.setattr(assistant.openai, "OpenAI", _fake_client(responses, captured))
    r = client.post(f"{API}/assistant/chat", headers=h(user), json={"messages": [{"role": "user", "content": "x"}]})
    assert r.status_code == 200
    assert captured[1][-1]["content"].startswith("Error:")


def test_assistant_tools_return_data(client, user, db):
    from app.models import User
    u = db.get(User, user["_id"])
    tools = assistant.Tools(db, u)
    for t in assistant.TOOLS:
        json.dumps(tools.run(t["name"], {}), default=str)


def test_assistant_rejects_conversation_not_ending_with_user(client, user, monkeypatch):
    monkeypatch.setattr(assistant.settings, "llm_api_key", "test-key")
    r = client.post(f"{API}/assistant/chat", headers=h(user),
                    json={"messages": [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}]})
    assert r.status_code == 400


def test_llm_client_picks_provider_from_settings(monkeypatch):
    from app.services import llm

    monkeypatch.setattr(llm.settings, "llm_base_url", "")
    monkeypatch.setattr(llm.settings, "llm_api_key", "gsk_test")
    assert str(llm.client().base_url).rstrip("/") == llm.GROQ_BASE_URL
    monkeypatch.setattr(llm.settings, "llm_api_key", "sk-test")
    assert "api.openai.com" in str(llm.client().base_url)
    monkeypatch.setattr(llm.settings, "llm_base_url", "http://localhost:11434/v1")
    assert str(llm.client().base_url).startswith("http://localhost:11434/v1")
