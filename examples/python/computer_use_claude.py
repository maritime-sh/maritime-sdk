"""Claude drives a Maritime desktop.

Creates (or reuses) a computer for one end user, prints a live viewer link you
can open or screen-record, then lets Claude's computer-use toolset work on the
desktop until it answers. The session is always closed at the end.

    export MARITIME_API_KEY=mk_xxxxxxxxxxxx
    export ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
    pip install -r requirements.txt
    python computer_use_claude.py ["your task"]

Claude's computer toolset uses the same 17 action names as Maritime's canonical
actions, so translating a call is mostly snake_case -> camelCase key renames.

Sample run (claude-opus-5-5, 1200x750 desktop): first wake 18.2 s, then 12
actions in 33 s; Claude answered "an Agent Box costs $1 per month per 2 GB".
"""
import sys
import time

import anthropic
from maritime import Maritime

TASK = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "Open a web browser, go to https://maritime.sh and tell me the price of an Agent Box."
)
MAX_TURNS = 30

maritime = Maritime()  # reads MARITIME_API_KEY
claude = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY

# Claude input key -> Maritime canonical key. Everything else passes through.
RENAME = {
    "start_coordinate": "startCoordinate",
    "scroll_direction": "scrollDirection",
    "scroll_amount": "scrollAmount",
}
# For these, Claude's `text` holds the modifier keys to press during the action.
MODIFIER_IN_TEXT = {
    "left_click", "right_click", "middle_click", "double_click", "triple_click",
    "left_click_drag", "scroll",
}
IMAGE_ACTIONS = {"screenshot", "zoom"}


def to_maritime(name: str, args: dict) -> dict:
    """One Claude computer-toolset call -> one Maritime canonical action."""
    action = {"action": name}
    for k, v in args.items():
        if k == "text" and name in MODIFIER_IN_TEXT:
            action["modifier"] = v
        else:
            action[RENAME.get(k, k)] = v
    if name not in IMAGE_ACTIONS:
        action["noScreenshot"] = True  # Claude asks for a screenshot when it wants one
    return action


def to_tool_result(block, result: dict) -> dict:
    """Maritime ActionResult -> Claude tool_result (echoing toolset_name)."""
    if result.get("imageB64"):
        content = [{
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": result.get("mime", "image/png"),
                "data": result["imageB64"],
            },
        }]
    elif block.name == "cursor_position":
        content = [{"type": "text", "text": str(result.get("coordinate"))}]
    else:
        content = [{"type": "text", "text": result.get("error") or "OK"}]
    return {
        "type": "tool_result",
        "tool_use_id": block.id,
        "toolset_name": "computer",
        "content": content,
        "is_error": bool(result.get("isError") or result.get("ok") is False),
    }


def main() -> None:
    computer = maritime.computers.create(external_user_id="demo-user", name="claude-demo")
    cid = computer["id"]
    woke = maritime.computers.wake(cid)
    print(f"computer {cid} awake (wakeMs={woke.get('wakeMs')})")
    print("watch live:", maritime.computers.viewer(cid, mode="watch")["url"])

    actions = 0
    started = time.time()
    try:
        shot = maritime.computers.act(cid, {"action": "screenshot"})
        print(f"screen {shot['width']}x{shot['height']}")
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": TASK},
                {"type": "image", "source": {
                    "type": "base64",
                    "media_type": shot.get("mime", "image/png"),
                    "data": shot["imageB64"],
                }},
            ],
        }]

        for _ in range(MAX_TURNS):
            response = claude.beta.messages.create(
                model="claude-opus-5-5",
                max_tokens=16000,
                output_config={"effort": "low"},
                tools=[{"type": "computer_toolset_20260801"}],
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",  # retry on another model if a safety classifier declines
                messages=messages,
            )
            messages.append({"role": "assistant", "content": response.content})
            for block in response.content:
                if block.type == "text" and block.text.strip():
                    print("claude:", block.text.strip())

            calls = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason != "tool_use" or not calls:
                if response.stop_reason == "refusal":
                    print("claude declined the task")
                break

            results = []
            for block in calls:
                action = to_maritime(block.name, dict(block.input))
                print("  ->", action)
                results.append(to_tool_result(block, maritime.computers.act(cid, action)))
                actions += 1
            messages.append({"role": "user", "content": results})
    finally:
        session = maritime.computers.close_session(cid)
        print(f"done: {actions} actions in {time.time() - started:.0f}s; session closed:",
              bool(session))


if __name__ == "__main__":
    main()
