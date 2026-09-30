"""A FastAPI app that gives each of your users their own agent and proxies chat.

`provision` is idempotent, so the same handler serves a brand-new user and a
returning one.

    export MARITIME_API_KEY=mk_xxxxxxxxxxxx
    pip install -r requirements.txt
    uvicorn fastapi_app:app --reload
    curl -s localhost:8000/chat -H 'content-type: application/json' \
      -d '{"user_id":"user_42","message":"hello"}'
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from maritime import Maritime, MaritimePaymentRequiredError

client = Maritime()  # reads MARITIME_API_KEY
app = FastAPI()


class ChatIn(BaseModel):
    user_id: str
    message: str


@app.post("/chat")
def chat(body: ChatIn):
    try:
        agent = client.agents.provision(
            external_id=f"customer_{body.user_id}",
            name=f"assistant-{body.user_id}",
            template="openclaw",
        )
        result = client.agents.chat(agent["id"], body.message)
        if result.get("error"):
            raise HTTPException(status_code=502, detail=result["error"])
        return {"reply": result["response"]}
    except MaritimePaymentRequiredError as err:
        # A Maritime plan limit blocked the action; err.detail says which.
        raise HTTPException(status_code=402, detail=str(err.detail))
