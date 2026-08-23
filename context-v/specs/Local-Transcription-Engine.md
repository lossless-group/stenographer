---
title: "A local transcription engine for Stenographer"
lede: "Stenographer routes every job to a paid API, which is correct for public YouTube and wrong for a founder call. A third engine speaking the OpenAI transcription API against a user-supplied base URL covers whisper.cpp, Speaches and MLX in one integration — but it forces the pipeline's first real change: from URL-in to source-in."
date_created: 2026-08-22
date_modified: 2026-08-22
authors:
  - Michael Staton
augmented_with:
  - Claude Code on Claude Opus 5
semantic_version: 0.0.0.1
status: Draft
tags:
  - Specification
  - Stenographer
  - Transcription
  - Whisper
  - Self-Hosting
  - Obsidian-Plugin
site_uuid: ed094ea9-dd06-4a9f-a327-53ab19c70ce1
hex_code: uw0hs6
publish: true
---

# A local transcription engine for Stenographer

## Why care?

Stenographer v0.1.0 has two engines and both are paid SaaS: **Supadata** for
platform links, **AssemblyAI** for direct audio. That is the right choice for
what the plugin was built to do — turning a public YouTube talk into a vault
note leaks nothing, because the talk is already public, and Supadata pulling
existing captions is cheaper and faster than running inference ever would be.

It is the wrong choice for the other half of the job. A recording of a founder
call, a partner meeting, or an LP conversation cannot be posted to AssemblyAI.
Not because AssemblyAI is untrustworthy, but because the material isn't ours to
hand over — the other party consented to a conversation, not to a vendor
holding a transcript of it. This is the same reasoning that put **Meetily** at
the top of the self-host-stack's transcription category, whose catalogue note
reads: *"most AI notetakers dial into the meeting as a participant, which means
a vendor is sitting in your partner meetings and diligence calls."*

So the goal is not to replace the SaaS engines. It is to make the plugin able
to tell the two cases apart and route accordingly:

| Material | Engine | Rationale |
|---|---|---|
| Public platform link (YouTube, TikTok, podcast page) | Supadata | already public; captions are cheap and instant |
| Public direct audio needing speaker labels | AssemblyAI | diarization, and the file is already on the open web |
| **Anything confidential, or any file on disk** | **local** | must never leave the machine |

## What this changes architecturally

The engine dispatch itself is easy — `EngineId` is a union in
`src/types/stenographer.ts:7`, `chooseEngine()` in `src/utils/urls.ts:120`
picks by URL shape, and `resolveEngine()` in `src/services/pipeline.ts:236`
layers settings on top. Adding a third member is a small diff.

**The hard part is that the whole pipeline assumes a URL.** Every path from the
modal down to `transcribeVia()` carries a `string` that is an `http(s)` address,
and AssemblyAI's contract reinforces it — `assemblyAiService.ts:83` posts
`{ audio_url }`, meaning the provider fetches the media itself. Nothing in the
plugin has ever held bytes.

A local engine inverts that. The input is a file — either a path inside the
vault or an absolute path on disk — and the plugin must read it and send the
bytes somewhere. That is the real work, and it is worth doing deliberately
rather than smuggling a second meaning into the existing `url: string`.

### The proposed contract

Introduce a `TranscriptionSource` discriminated union and thread it where
`url: string` currently flows:

```ts
export type TranscriptionSource =
  | { kind: 'url'; url: string }
  | { kind: 'vaultFile'; path: string }   // TFile path, read via Vault.readBinary
  | { kind: 'localFile'; path: string };  // absolute, desktop only
```

`chooseEngine()` becomes total over that union rather than parsing strings, and
the "unknown shape" fallback at `urls.ts:130` — which currently guesses
Supadata — gains an honest third answer instead of guessing.

## The engine: one integration, many backends

**Do not bundle or shell out to a binary.** Do not add `child_process`, do not
manage model downloads, do not ship platform-specific paths. That path leads to
maintaining a Whisper installer inside an Obsidian plugin, which is a different
product than the one this is.

Instead: **speak the OpenAI transcription API to a base URL the user supplies.**

```
POST {baseUrl}/v1/audio/transcriptions
Content-Type: multipart/form-data
  file:            <bytes>
  model:           <configurable, e.g. whisper-large-v3>
  response_format: verbose_json      // segments with timestamps
  language:        <optional>
```

One integration then covers every local backend worth running:

| Backend | Notes |
|---|---|
| **Speaches** | Already a `candidate` in the self-host-stack catalogue, tier `extended`, MIT. Explicitly "OpenAI-compatible speech-to-text server". The natural pairing. |
| **whisper.cpp** (`whisper-server`) | Metal-accelerated on Apple Silicon — the fast option on the machines we actually use |
| **MLX Whisper** | Apple's framework; GPU on Apple Silicon |
| Anything else | LM Studio, faster-whisper-server, a future in-house service |

This also keeps the existing shape of the code: submit, receive structured
segments, map into `TranscriptResult`. It is closer to `assemblyAiService.ts`
than to anything new.

### Why not WhisperX directly

WhisperX is the best *engine* in the category — 70× realtime, word-level
timestamps, pyannote diarization, BSD-2-Clause and genuinely free. But it is a
Python package, not a server, and it has no Metal backend: `faster-whisper` sits
on CTranslate2, which is CUDA-or-CPU. On the Apple Silicon machines this plugin
runs on, WhisperX is CPU-bound and slow.

It remains the right thing to point at from a Linux box with an NVIDIA card. The
`baseUrl` design means that is a configuration choice, not a code change — wrap
WhisperX in any OpenAI-compatible shim and this engine talks to it unmodified.

## Diarization is a known gap

The OpenAI transcription API has no concept of speakers. `verbose_json` returns
timestamped segments and nothing about who is talking, so **the local engine
ships without speaker labels** while `assemblyai` keeps them.

That matters, because `includeSpeakers` is an existing setting and the LFM
`:::transcript` block renders speaker-attributed lines. The honest options, in
preference order:

1. **Ship without diarization.** Emit timestamped segments, leave speaker fields
   null, and have the modal say so before the user spends the time — the same
   courtesy the modal already extends about which engine will run.
2. **Detect a richer backend.** Some servers expose diarization behind a
   non-standard parameter. Probe capabilities once and use them when present,
   rather than assuming.
3. **Two-pass with a local diarizer.** Correct and considerably more work; out
   of scope for a first cut.

Start at (1). Do not let diarization block the feature, and do not let the note
format silently imply speakers that were never detected.

## Files this touches

| File | Change |
|---|---|
| `src/types/stenographer.ts` | add `'local'` to `EngineId`; add `TranscriptionSource` |
| `src/services/localService.ts` | **new** — multipart POST, `verbose_json` → `TranscriptSegment[]` |
| `src/services/pipeline.ts` | `transcribeVia()` gains a `local` branch (~line 106); `resolveEngine()` learns the new key check (~line 236) |
| `src/utils/urls.ts` | `chooseEngine()` becomes total over `TranscriptionSource` |
| `src/settings/settings.ts` | `localBaseUrl`, `localModel`, `localEnabled` |
| `src/settings/settings-tab.ts` | the three fields, plus a **Test connection** button |
| `src/modals/StenographerModal.ts` | accept a file, not only a URL; keep the which-engine-and-why line accurate |

### Settings

```ts
localBaseUrl: string;   // e.g. http://127.0.0.1:8000  — no trailing slash
localModel: string;     // e.g. 'Systran/faster-whisper-large-v3'
localEnabled: boolean;  // presence of a baseUrl is not consent to route to it
```

`localEnabled` is deliberate rather than inferring from a non-empty URL. A
half-configured server should not silently start receiving confidential audio.

**Test connection matters more here than for the SaaS engines.** A wrong API key
fails immediately and legibly; a local server that is merely *not running* fails
as a connection refused in the middle of a job. Let the user find out in
settings.

## Dispatch rules

1. `localEnabled` and the source is a file → **local**, always. A file on disk is
   the confidential case by default; never route it off-machine implicitly.
2. Platform link → **supadata** (unchanged).
3. Direct media URL → **assemblyai** if keyed, else supadata (unchanged).
4. `defaultEngine === 'local'` → local for everything it can handle, and refuse
   platform links honestly rather than silently falling back. A user who chose
   local chose it for a reason.

Rule 1 is the important one and should not be softened into a preference.

## Non-goals

- Bundling models or binaries; managing downloads; any `child_process`
- Real-time or live-meeting capture — that is Meetily's job, not this plugin's
- Replacing Supadata. It is the only engine that ingests a YouTube page
  directly, and public content has no reason to be transcribed locally
- Mobile support. Obsidian mobile has no local server to talk to; the engine
  should be absent rather than broken

## Verification

- A vault audio file transcribes end-to-end against a local `whisper-server`
  with **no network requests leaving the machine** — verified by watching
  traffic, not by trusting configuration
- The generated note is byte-identical in structure to a SaaS-engine note, with
  `engineFieldName` reading `local` and speaker fields absent rather than empty
- Test connection reports failure clearly when the server is down
- With `localEnabled: false`, a file source produces a legible refusal rather
  than a fallback to AssemblyAI

## Open questions

- **Does Speaches implement `verbose_json` faithfully?** The segment shape is
  the integration's whole contract. Verify against a running instance before
  writing the mapper.
- **Where does the vault get large files from?** A two-hour recording is a
  hundred-plus MB multipart POST from Electron. Chunking may be necessary, and
  if so it belongs in this spec before implementation, not after.
- **Should the local engine also accept a URL** (download, then post)? It would
  let a user keep confidential *links* off SaaS too. Probably yes, eventually;
  not in the first cut.
- **Is there a shared future with the self-host-stack's Speaches deployment?**
  If Speaches lands as a real service on a client stack, this plugin becomes its
  first consumer, and `localBaseUrl` stops meaning "localhost".

## Related

- `self-host-stack/hubs/lossless-at/src/data/stack-tools.json` — the
  `transcription` category: Meetily, Scriberr, Speaches, Speakr, Whishper,
  WhisperX
- `README.md` — the two-engine routing this extends
- `changelog/2026-08-08_01.md` — v0.1.0, where the current shape was set
