"""The real Burp Suite MCP tool catalog.

The PortSwigger ``mcp-server`` extension derives each tool name from its Kotlin
data class via ``toLowerSnakeCase()``.  Parameter names are serialized as the
camelCase property names (no ``@SerialName`` renaming).  This module encodes
that ground truth so the client does not guess.

The extension is *send-oriented* plus *history read-back*:

* ``send_http_1_request`` / ``send_http_2_request`` send a **raw** HTTP request
  and return the response text.
* ``create_repeater_tab`` opens a Repeater tab from raw content (returns void).
* ``get_proxy_http_history`` returns a paginated list of serialized history
  items (each with ``id``, ``status``, ``request``, ``response``, …).
* ``get_scanner_issues`` returns serialized audit issues.

There is **no** site-map tool, **no** session tool, **no** message-compare tool,
and **no** "get request by id" — the adapter synthesizes those on the
ChainsawRecon side from history read-back.
"""
from __future__ import annotations

# Every tool the installed extension can expose, grouped by function.
# Names are exact snake_case derivations of the Kotlin data-class names.

SEND_TOOLS: tuple[str, ...] = (
    "send_http_1_request",
    "send_http_2_request",
    "create_repeater_tab",
    "create_repeater_tab_http_2",
    "send_to_intruder",
)

READ_TOOLS: tuple[str, ...] = (
    "get_proxy_http_history",
    "get_proxy_http_history_regex",
    "get_organizer_items",
    "get_organizer_items_regex",
    "get_proxy_websocket_history",
    "get_proxy_websocket_history_regex",
    "get_scanner_issues",
)

ENCODE_TOOLS: tuple[str, ...] = (
    "url_encode",
    "url_decode",
    "base64_encode",
    "base64_decode",
    "generate_random_string",
)

CONFIG_TOOLS: tuple[str, ...] = (
    "output_project_options",
    "output_user_options",
    "set_project_options",
    "set_user_options",
    "set_task_execution_engine_state",
    "set_proxy_intercept_state",
    "set_active_editor_contents",
    "get_active_editor_contents",
)

COLLABORATOR_TOOLS: tuple[str, ...] = (
    "generate_collaborator_payload",
    "get_collaborator_interactions",
)

ALL_BURP_TOOLS: tuple[str, ...] = (
    SEND_TOOLS + READ_TOOLS + ENCODE_TOOLS + CONFIG_TOOLS + COLLABORATOR_TOOLS
)

# Tools ChainsawRecon requires for its captured-request workflow.  Without the
# history reader there is no way to find a captured request, and without the
# HTTP/1.1 sender there is no way to replay one.  Everything else is optional.
CORE_BURP_CAPABILITIES: tuple[str, ...] = (
    "get_proxy_http_history",
    "send_http_1_request",
)

# Optional but preferred tools.  Their absence degrades the workflow gracefully
# rather than disabling it.
OPTIONAL_BURP_CAPABILITIES: tuple[str, ...] = (
    "get_proxy_http_history_regex",
    "create_repeater_tab",
    "get_scanner_issues",
    "generate_collaborator_payload",
    "get_collaborator_interactions",
)

# camelCase parameter schemas for the primitives the adapter invokes directly.
# These names must match the extension's serialized JSON keys exactly.

HTTP_SERVICE_PARAMS: tuple[str, ...] = (
    "targetHostname",
    "targetPort",
    "usesHttps",
)

SEND_HTTP_1_PARAMS: tuple[str, ...] = ("content",) + HTTP_SERVICE_PARAMS
CREATE_REPEATER_TAB_PARAMS: tuple[str, ...] = ("tabName", "content") + HTTP_SERVICE_PARAMS
HISTORY_PARAMS: tuple[str, ...] = ("count", "offset")
HISTORY_REGEX_PARAMS: tuple[str, ...] = ("regex", "count", "offset")
SCANNER_PARAMS: tuple[str, ...] = ("count", "offset")

# The model-facing semantic action names.  These stay stable even if the
# underlying extension renames its primitives; the client maps them.
SEMANTIC_ACTIONS: tuple[str, ...] = (
    "search_captured_requests",
    "get_captured_request",
    "get_captured_response",
    "replay_captured_request",
    "compare_captured_responses",
    "create_repeater_experiment",
)

# Default read-back window for history.  Kept small so a single model turn
# does not pull thousands of raw bodies into context.
DEFAULT_HISTORY_LIMIT = 20
MAX_HISTORY_LIMIT = 100