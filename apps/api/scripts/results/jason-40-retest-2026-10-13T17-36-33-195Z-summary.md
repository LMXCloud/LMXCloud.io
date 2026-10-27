# Jason 40-request retest, 13 October 2026

Source file: `jason-40-retest-2026-10-13T17-36-33-195Z.jsonl`. One production run. Failed requests were kept. None were repeated.

## Run conditions

- Deployed commit: `40502726b2b42bd0ee6890efa253bd852c87ebc0` (merge of PR #3). The harness recorded origin/main at run time. Confirmed separately: Railway shows this merge as the active production deployment and the only deploy since `ab388dd`, and all 40 responses carried the `x-lmx-model-requested`/`x-lmx-model-resolved` headers that first shipped in PR #3.
- Time: 13 October 2026, 1:36:33 PM–1:38:48 PM ET.
- Endpoint: `https://api.lmxcloud.io/v1/chat/completions`.
- 40 requests. One attempt each. No retries and no replacement calls.
- `max_tokens`: 400.
- Pacing: the harness waited 2.5 seconds after each response completed, not between request starts. Measured from the recorded start times, the achieved rate was 17.4 requests per minute (40 starts over 134.8 s; mean start gap 3.46 s), below the ~24 per minute target. Corrected 14 October 2026; the harness now schedules starts every 2.5 s and reports the achieved rate.
- Requests did not set `reasoning_effort`, `enable_thinking`, or `chat_template_kwargs`. Thinking stays at the server default (off for hybrid Qwen).
- No provider preference was sent. `provider_preference` is null on every request.

A plain request passes when the assistant content is non-empty. A `json_object` request passes when that content parses as a JSON object, with no markdown fence stripped. A tool call passes when `finish_reason` is `tool_calls`, the function name is `get_weather`, and the arguments parse as a JSON object whose `city` is a string. A stream passes when it includes `data: [DONE]`. A later `event: lmx.meta` or `event: lmx.error` trailer does not undo that terminator; another completion chunk after `[DONE]` does. Empty output and truncated output (`finish_reason` `length`, or a stream that closed before `[DONE]`) fail the pass even when the mode check would otherwise hold. HTTP errors fail the pass.

## Passes by model and mode

| Model | plain | json_object | tool_call | streaming |
| --- | --- | --- | --- | --- |
| llama-3.3-70b | 5/5 | 5/5 | 5/5 | 5/5 |
| qwen-3.6-35b | 5/5 | 5/5 | 5/5 | 5/5 |

40 of 40 requests passed.

## Requests

Request ID is the completion ID returned in the response (UUID for non-streaming, `gen-…` for streaming); no `x-request-id` header was returned.

| Model | Mode | Run | Request ID | Provider | Preference | Fallback | HTTP | Returned model | Stream model IDs | Substitution | finish_reason | Stream end | Empty | Truncated | Mode valid | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| llama-3.3-70b | plain | 1 | 01a13656-5d72-dd52-ab5a-5c6a3f9958c9 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | plain | 2 | 01a13656-6a62-fa4b-e5ef-8570c6535080 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | plain | 3 | 01a13656-7771-65e0-62a9-cfde71eb8ad6 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | plain | 4 | 01a13656-83e7-4b97-ae8a-46700ba39c65 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | plain | 5 | 01a13656-9319-cf00-70b7-8db79cce28f2 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | json_object | 1 | 01a13656-9f80-0cf7-c5a4-0850d8c41eaf | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | json_object | 2 | 01a13656-ac53-35df-9017-68418140513d | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | json_object | 3 | 01a13656-b8f7-bff9-b0dd-57a9f486b335 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | json_object | 4 | 01a13656-c5ef-0d00-e495-bf0bca7d92a8 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | json_object | 5 | 01a13656-d31e-e3ac-45d7-c0731579e2aa | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | stop | not_applicable | no | no | yes | yes |
| llama-3.3-70b | tool_call | 1 | 01a13656-dff3-1869-1250-f32243712a27 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | tool_calls | not_applicable | no | no | yes | yes |
| llama-3.3-70b | tool_call | 2 | 01a13656-ed14-eef7-cbc6-dbd41e98bc64 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | tool_calls | not_applicable | no | no | yes | yes |
| llama-3.3-70b | tool_call | 3 | 01a13657-0175-6caf-5ac2-adbda001c12c | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | tool_calls | not_applicable | no | no | yes | yes |
| llama-3.3-70b | tool_call | 4 | 01a13657-1105-ff63-3d52-0177a97f4a4e | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | tool_calls | not_applicable | no | no | yes | yes |
| llama-3.3-70b | tool_call | 5 | 01a13657-1e21-1320-2ddc-e46d8df33ffc | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | - | no | tool_calls | not_applicable | no | no | yes | yes |
| llama-3.3-70b | streaming | 1 | gen-1791913044-FJOFJ4dce5vRzbjIznW1 | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | meta-llama/Llama-3.3-70B-Instruct | no | stop | done | no | no | yes | yes |
| llama-3.3-70b | streaming | 2 | gen-1791913048-K4kKFK7zV8ZV3kjn0FIn | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | meta-llama/Llama-3.3-70B-Instruct | no | stop | done | no | no | yes | yes |
| llama-3.3-70b | streaming | 3 | gen-1791913051-iS0jeqWDEq8Mly7hUriF | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | meta-llama/Llama-3.3-70B-Instruct | no | stop | done | no | no | yes | yes |
| llama-3.3-70b | streaming | 4 | gen-1791913054-CFdbVLEmAJAKDbsyapbf | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | meta-llama/Llama-3.3-70B-Instruct | no | stop | done | no | no | yes | yes |
| llama-3.3-70b | streaming | 5 | gen-1791913057-RuGHI0dyDcVjqt1ibOmZ | ionet | - | false | 200 | meta-llama/Llama-3.3-70B-Instruct | meta-llama/Llama-3.3-70B-Instruct | no | stop | done | no | no | yes | yes |
| qwen-3.6-35b | plain | 1 | 01a13657-68a3-b5d4-4714-f1713d1c76a5 | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | plain | 2 | 01a13657-75ab-ef8b-6da1-a606eed7463a | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | plain | 3 | 01a13657-824f-4900-195a-a05faf53f70c | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | plain | 4 | 01a13657-8efa-88c5-e1e5-015378545520 | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | plain | 5 | 01a13657-9bbf-6a72-9eb7-8fe015aaa015 | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | json_object | 1 | 01a13657-a880-3ab8-104a-a7c23d64e79d | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | json_object | 2 | 01a13657-b631-fc15-b14b-e8152644638f | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | json_object | 3 | 01a13657-c578-081f-a5dc-1a3b91554f7e | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | json_object | 4 | 01a13657-d3b4-4bcf-4ef7-b0c64447096d | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | json_object | 5 | 01a13657-e0ec-33db-7a11-1d8d2afcc7ea | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | stop | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | tool_call | 1 | 01a13657-ee18-24ff-50b2-e094e624fec3 | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | tool_calls | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | tool_call | 2 | 01a13657-fcf8-d5b5-1151-29b64a75090a | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | tool_calls | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | tool_call | 3 | 01a13658-0b5f-b4e7-c7b7-58e44def4731 | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | tool_calls | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | tool_call | 4 | 01a13658-196a-9898-302d-6172cb950bab | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | tool_calls | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | tool_call | 5 | 01a13658-27a5-0bbd-e509-ae4033704e5a | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | - | no | tool_calls | not_applicable | no | no | yes | yes |
| qwen-3.6-35b | streaming | 1 | gen-1791913113-OSmMJ4UQCtKCRYv4FiFO | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | Qwen/Qwen3.6-35B-A3B | no | stop | done | no | no | yes | yes |
| qwen-3.6-35b | streaming | 2 | gen-1791913116-BcW92SgNYkIbNfwUAxgn | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | Qwen/Qwen3.6-35B-A3B | no | stop | done | no | no | yes | yes |
| qwen-3.6-35b | streaming | 3 | gen-1791913119-4pkjHz04dja3yAs97wBN | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | Qwen/Qwen3.6-35B-A3B | no | stop | done | no | no | yes | yes |
| qwen-3.6-35b | streaming | 4 | gen-1791913123-K6ifxbUtIM7GaeA3zjCX | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | Qwen/Qwen3.6-35B-A3B | no | stop | done | no | no | yes | yes |
| qwen-3.6-35b | streaming | 5 | gen-1791913126-JH8FvtkvdREFV6Exgo0q | ionet | - | false | 200 | Qwen/Qwen3.6-35B-A3B | Qwen/Qwen3.6-35B-A3B | no | stop | done | no | no | yes | yes |

## Failures

None.

## Substitution

No returned model id differed from the expected upstream id.

## Usage and model headers

Every request included a usage object.
`x-lmx-model-requested` was present on 40 of 40 requests. `x-lmx-model-resolved` was present on 40 of 40 requests.
