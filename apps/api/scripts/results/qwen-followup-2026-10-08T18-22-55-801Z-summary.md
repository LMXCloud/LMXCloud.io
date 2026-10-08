# Qwen follow-up, 8 October 2026

Source file: `qwen-followup-2026-10-08T18-22-55-801Z.jsonl`. One production run. No requests were repeated.

## Run conditions

- Deployed commit (`origin/main`): `a892addb4a4d362b2b2d2971e8b829164636a59a`.
- Time: 8 October 2026, 2:22:55 PM–2:24:01 PM ET (18:22:55.802Z–18:24:01.776Z).
- Endpoint: `https://api.lmxcloud.io/v1/chat/completions`.
- 20 requests. One attempt each. No retries.
- `max_tokens`: 400.
- Pacing: 2.5 seconds between requests (24 per minute).
- Requests did not set `reasoning_effort`, `enable_thinking`, or `chat_template_kwargs`.
- Preference was sent as `x-lmx-prefer: provider:akash` or `provider:ionet`. `x-lmx-fallback: false` means the gateway did not fall back.

| Block | Requests | Model requested | Provider requested | Shape |
| --- | --- | --- | --- | --- |
| A | 5 | qwen-3.5-35b | akash | streaming, plain text |
| B | 5 | qwen-3.5-35b | akash | non-streaming, `get_weather` tool |
| C | 5 | qwen-3.6-35b | ionet (io.net) | non-streaming, `get_weather` tool |
| D | 5 | qwen-3.5-35b | akash | non-streaming, plain text |

Expected upstream IDs for the serving provider: qwen-3.5-35b on Akash is `Qwen/Qwen3.5-35B-A3B`. qwen-3.6-35b on io.net is `Qwen/Qwen3.6-35B-A3B`.

A mismatch is any `model` value in the response that differs from that expected ID. A tool call is ok when `finish_reason` is `tool_calls`, the function name is `get_weather`, and the arguments parse as JSON with a `city`.

## Requests

| Block | Run | Model requested | Provider | Fallback | Models seen | finish_reason | Tool call ok | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1 | qwen-3.5-35b | akash | false | Qwen/Qwen3.6-35B-A3B | stop | n/a | mismatch |
| A | 2 | qwen-3.5-35b | akash | false | Qwen/Qwen3.6-35B-A3B | stop | n/a | mismatch |
| A | 3 | qwen-3.5-35b | akash | false | Qwen/Qwen3.6-35B-A3B | stop | n/a | mismatch |
| A | 4 | qwen-3.5-35b | akash | false | Qwen/Qwen3.6-35B-A3B | stop | n/a | mismatch |
| A | 5 | qwen-3.5-35b | akash | false | Qwen/Qwen3.6-35B-A3B | stop | n/a | mismatch |
| B | 1 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | tool_calls | yes | pass |
| B | 2 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | tool_calls | yes | pass |
| B | 3 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | tool_calls | yes | pass |
| B | 4 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | tool_calls | yes | pass |
| B | 5 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | tool_calls | yes | pass |
| C | 1 | qwen-3.6-35b | ionet | false | Qwen/Qwen3.6-35B-A3B | tool_calls | yes | pass |
| C | 2 | qwen-3.6-35b | ionet | false | Qwen/Qwen3.6-35B-A3B | tool_calls | yes | pass |
| C | 3 | qwen-3.6-35b | ionet | false | Qwen/Qwen3.6-35B-A3B | tool_calls | yes | pass |
| C | 4 | qwen-3.6-35b | ionet | false | Qwen/Qwen3.6-35B-A3B | tool_calls | yes | pass |
| C | 5 | qwen-3.6-35b | ionet | false | Qwen/Qwen3.6-35B-A3B | tool_calls | yes | pass |
| D | 1 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | stop | n/a | pass |
| D | 2 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | stop | n/a | pass |
| D | 3 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | stop | n/a | pass |
| D | 4 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | stop | n/a | pass |
| D | 5 | qwen-3.5-35b | akash | false | Qwen/Qwen3.5-35B-A3B | stop | n/a | pass |

Each streaming response contained one distinct `model` value.

## Per-block totals

| Block | Requests | Served by the requested provider, no fallback | Mismatches | Passes | Tool calls ok |
| --- | --- | --- | --- | --- | --- |
| A | 5 | 5 akash | 5 | 0 | n/a |
| B | 5 | 5 akash | 0 | 5 | 5 |
| C | 5 | 5 ionet | 0 | 5 | 5 |
| D | 5 | 5 akash | 0 | 5 | n/a |

## Akash streaming model

Reproduced in 5 of 5 Akash-served streams: models seen were `Qwen/Qwen3.6-35B-A3B`; the expected upstream ID is `Qwen/Qwen3.5-35B-A3B`.

The five non-streaming Akash requests for the same model (block D) returned `Qwen/Qwen3.5-35B-A3B`.

## Tool calls

Qwen 3.5 on Akash (block B): 5 of 5 tool calls were ok. Each was served by akash with fallback false, returned `Qwen/Qwen3.5-35B-A3B`, finished with `tool_calls`, and called `get_weather` with JSON arguments that included a city.

Qwen 3.6 on io.net (block C): 5 of 5 tool calls were ok. Each was served by ionet with fallback false, returned `Qwen/Qwen3.6-35B-A3B`, finished with `tool_calls`, and called `get_weather` with JSON arguments that included a city.

## Known open items

- Streaming substitutions are not yet logged server-side.
- There is no caller-visible substitution flag.
- Usage/cost reporting and per-model pricing are still open.
