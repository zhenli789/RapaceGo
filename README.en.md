# RapaceGo (玄清围弈)

> A Windows desktop Go (weiqi) tool: **play against KataGo, read objective numbers,
> and hear a local language model explain the moves in plain Chinese.**
> Everything runs on your own machine — no cloud, no uploading your games.

[简体中文](README.md) · English

> ## 📥 [Download · installation steps (about 5 minutes)](README.en.md#option-1-download-the-ready-to-run-build-recommended)
>
> Windows 10 / 11 only. **If you don't want to read the whole thing, just click that link** —
> it starts at the download step and walks you through to a running app.

![Main window](docs/screenshots/main-with-coach.png)

---

## What it is

The goal isn't "another Go GUI" — it's a narrow one: **after a game, know where you went wrong and why.**

So it pairs two things and keeps their roles strictly separate:

| Component | Role |
|---|---|
| **KataGo** (engine) | The numbers — winrate, score lead, candidate moves, territory, points lost per move. Objective, never flatters you. |
| **LoGos** (local 7B model) | The words — explains *why* a move was good or bad, and what the engine preferred at that moment. |

**Verdicts come from KataGo's numbers; explanations come from LoGos.**
This split is deliberate: tested against obviously bad moves, the language model happily
invents a justification for them. So it never gets to judge — only to explain.

---

## Features

**Play** — human-style opponents rated by amateur rank (20k–9d, plus "pre-AI era" and
"pro style by year"); **KATAGO vs KATAGO** (tick it in the new-game panel and both colours
are played automatically at the same rank, with a pause/resume button — it never resigns,
so you get to see the endgame); **per-move analysis** — while playing, the "commentary" box
shows the move's score, win rate, **points lost**, best move with its expected lead, PV and
**policy ("intuition") ranking**, for whichever move you are looking at; exported records
**keep that analysis as SGF comments** (reopening one shows it again), are named
`P1 vs AI(3d)-202610190823.sgf` (players joined by "vs", the rank in brackets after the AI; both
sides get it in AI-vs-AI), and the record library lists the
filename only; handicap done the
standard way; free-placement / two-player mode;
tsumego practice (set up a problem, or **import an SGF puzzle collection** — one file may
hold hundreds of problems, paged through with ‹ ›; **reopening a collection jumps straight
back to the problem you were last on**; fixed local frame and a "show the solution" button —
KATAGO takes either colour, and the opponent has **three settings**: **follow the solution**
(default for imported collections — it replays the SGF's main line, never tenukis; if you
deviate it falls back to KATAGO; **SGF variations are now parsed too**, so an alternative
correct branch is followed instead of being treated as a deviation), **KATAGO** (search
restricted to **within 2 lines of a stone** — the same band for both sides; it cannot land
**on the dashed frame line** itself: at frame distance ≥3 that line is
excluded outright, and at 1–2 only the points hugging a stone are kept),
and **play both sides** (you alternate colours yourself)); in tsumego mode the rules are fixed
(Chinese), the engine's **analysis scope defaults to "inside the frame only"** — the board sent
to KataGo is literally cropped to the frame (a corner problem becomes roughly 9×9), so nothing
outside it is computed at all: faster, and the ownership fog only covers the frame; switch it to
"full board" for the old behaviour (19×19 search with a legal-move whitelist). ★ Cropping does
**not** make the suggested moves better (8-problem A/B, both balanced: top move identical on
5/8, solution match 0/8 either way) — move choice is dominated by the policy net, and the points
outside the frame were already excluded as legal moves; cropping only saves compute.
The **komi is balanced per problem** — the engine first measures how many points
the problem already favours Black, then hands that over to White as komi so both sides start
near 50%. Two hard facts learned from measurement: KataGo's `komi` **only accepts integers or
half-integers** (asking for 38.9 fails the whole query), and on a cropped board "1 komi point
= 1 point of lead recovered" does **not** hold (measured ratio 1.0–1.15), so the first guess
overshoots by 7–9 points (2.4 on large-lead full-board problems). The program therefore
re-corrects on the **measured score lead** for up to 6 rounds: the conversion rate is
**measured** from two consecutive rounds instead of assumed 1:1, once two samples straddle 50%
it only **bisects** between them (extrapolating across the narrow neck always overshoots),
the step halves when close, and a round that got worse is rolled back (unless it was the
bisection midpoint). Measured: cropped 8×9 settles 44 → 38 (45.3%), full-board 19×19
43.5 → 43 (54.6%), and a 31-stone full-board problem 65 → 70.5 (65.4%, limited by the 500-visit
reading noise, ±25pp on the same komi). The cap scales with the board
the engine actually sees (178 on 19×19, 65 on a cropped 8×9): initial leads on 19×19 problems
routinely reach 50–150 points (sampled from the 347 Xuan Xuan Qi Jing problems: median 50.5,
max 148), and a fixed 40-point cap left **six out of ten problems unbalanced**. A fixed komi of
0 is why KataGo used to drift inside one-sided life-and-death problems: every candidate sat at
99.x%, so ranking collapsed into sampling. After balancing, the win-rate bar reads "**is this
group alive right now**" instead of "who wins this game". Knowing the boundary: on a cropped
board the **komi lands right but the win-rate reading may still sit at 30–45% or 55–70%** —
with the frame's points alone, komi has to cover half the board, and half a point of komi
swings 30–60 percentage points (measured 72.7% at 37, ≈40% at 38, 10.7% at 38.5). Switch the
scope to "full board" if you want a flatter curve. Changing the frame distance or the scope
re-balances automatically (the engine is looking at a different board). Switching to another
problem also re-balances (komi shows "balancing…" first); flipping back to a problem you already
balanced reuses its value instead of recomputing.
**Opening a problem set starts warming the engine in the background** — while you read the problem
and tweak the frame, the engine is already analysing its initial position, so by the time you hit
"Start solving" the komi is usually ready (measured: cold start "click to komi" drops from 21–48 s
to 6–14 s). Balanced values are **saved locally**, so practising the same problem after restarting
the app reuses them (measured: 0 s).
It is an engine-side setting only: it never touches the record, scoring or
review;
scratch-play ("what if") board; 9/13/19 lines; Chinese / Japanese / Korean / Ming-Qing rules;
5 time-control presets with byo-yomi beeps and **loss on time**.
The **mode button** in the top bar (it shows the current mode; click it for a drop-down:
human-vs-AI / free placement / tsumego practice) always opens the **New Game** dialog with that
type pre-selected; pressing Cancel changes nothing. Tick **"continue from this position"** in that
dialog to switch mode while keeping the current board and move history.

**Numbers** — winrate bar & score, recommended moves, move previews, ownership map
(fog or blocks), winrate/score graph (it **follows the branch you are on** — switching branches
redraws it, and the title tags `· N branches` or `· not reviewed`), per-move loss list, and a **review report**
(black/white split: average loss, blunder counts, agreement with AI's top choice). The review
progress bar keeps moving (the engine reports its in-hand progress every second) and shows a
**measured** "seconds per move / time left" for this machine. You can **stop at any time** —
moves already computed are kept, the dialog switches to "review paused" with a **Resume**
button right there (it only computes the remainder), and a partial
run never overwrites the previous saved report.
**One report per branch** — every branch lives in the **same** `<record>.review.json`.
**Choose the scope**: the "AI review" dialog (when the record has branches) offers three buttons —
**this line** / **the N not reviewed yet** / **all M branches**. Multi-line runs show "branch N / M"
in the progress window and **reuse the shared prefix** instead of recomputing it (two lines that
diverge at move 120 cost only that one extra move for the second line).
**Switching to an unreviewed branch asks first**: the dialog says the line has not been reviewed,
**where it diverges** and that the shared opening will be reused; buttons "review this branch" /
"not now". It asks once per line, and "don't ask again" is remembered.
**Exported records carry no analysis report**: "export" writes the game itself (moves, players, date,
plus the per-move **commentary**). The numbers gathered while playing are **not** saved — their visit
count per move ranges from a few to several hundred, so win rates and losses are not comparable; **run
"AI review" on the record in the library** for one uniform pass. **Per-branch commentary is still written
per node**: every move on every branch carries its own analysis in `C[]`, so switching branches shows
that branch's commentary instead of only the last one's.
**One record per game**: the first export creates `black vs white-<time>.sgf`; pressing "export" again
**overwrites that same file** instead of piling up `…-2055.sgf` / `…-2058.sgf` copies. Exporting a record
you opened from the library writes back into it when the file was produced by this app; a foreign record
(another program, a downloaded classic) is saved as a copy instead — rebuilding it would drop its event /
date / title properties.
Per-move numbers appear **only once the search has settled** (a "…" placeholder shows
while it is still computing), so a number never changes after you have seen it.

**Variations** — when a record contains SGF variations, the move-list card draws them as a
**tree of stone circles**: each move is a black/white circle with its number inside (no
coordinates — hover for them), the main line runs straight down, and an alternative moves
**one column to the right**, joined to the branch point by an **elbow** (down → across → down);
a branch of a branch goes one more column right. **Clicking a circle** jumps to that move
(switching lines when needed). **Alt+←/→** cycles through siblings too. Exporting a record
keeps the branches instead of flattening them to one line. You can also **play while
reviewing** — a move played on an earlier position starts a **new branch**, and the old
continuation stays in the tree.

**Recovery** — a **Refresh** button next to the engine lamps in the top bar. If the
recommended moves stop appearing, or the "computing… N" line above the board freezes,
press it: it releases the stuck analysis, re-queues it, re-checks the engine, and
restarts the engine if it is actually dead.

**Explanation** — one card in the left column holds both panels: "explain this move" on top,
"explain candidates" below it behind a dashed divider, sharing a single scrollbar. The three
actions are buttons at the **bottom of the card**: whole-game / this move / candidates.
- **Explain this move** — verdict from KataGo, reasoning from LoGos. Stored per move.
  The "what did the AI want to play here" point **comes from the saved review when there is
  one** (the same number the whole-game pass uses), and only falls back to a live KataGo
  analysis (500 visits/move) when it isn't.
- **Explain candidates** — several recommended points, each explained. **Stored per position**: step to another move and this page switches to that move's (it says so when there is none), so it never keeps showing the previous move's text; explaining a position once means a second click just shows the result. Works while replaying records too.
- **Explain whole game** — narrates every move of an SGF once; **the result is saved
  next to the SGF**, so reopening it shows the commentary instantly (a record that already
  has commentary opens straight into the whole-game page). When it finishes, the whole game
  is laid out as one scrollable page (click a move to jump to it; the "whole game / back"
  link by the title switches at any time). **If the game has already been reviewed, the
  KataGo pass reuses that review instead of recomputing it** — even when the visit count
  differs (old review files are 100 visits/move, the default is 500; that mismatch alone
  used to force a full recompute). The whole game then uses the review's own visit count,
  so nothing mixes coarse and fine numbers. **Commentary is stored per branch**: each line
  keeps its own, switching branches swaps it instantly, an un-narrated branch says so, and
  a run interrupted by a branch switch saves what it finished to the original line.

![Whole-game commentary](docs/screenshots/batch-progress.png)

**Game library** — import / export / rename / delete / search SGFs, with badges for
"reviewed" and "has commentary".

**Commentary stored inside the SGF** (many downloaded records carry it, especially pro games
and problem collections): the **Commentary** box (bottom right) shows the note for the move
you are looking at. Click **Edit** to change it and it is **written back into the original
file** (the first edit leaves a `.bak` backup).

- The block of text at the **very start** of a record (collection source, "diagram 55",
  who compiled it) shows up in the **“(before the game · notes)”** slot — go to the first
  move and it is there. It can be edited and saved back too.
- Only the one note you edited changes; everything else in the file stays byte-for-byte
  identical.
- **Blank lines inside commentary are collapsed**: pro commentary is usually one sentence
  per line, and the blank lines are leftovers from the exporting tool.
- For problem collections (one file holding several problems) the top bar shows
  **“problem N of M”** — it only *labels* the position, it does **not** jump between
  problems (that would touch the move range, engine requests, history and caches).

**Manual engine loading** — the app starts with **no engine loaded** (zero VRAM).
Click the indicator in the top bar when you want AI:

![Engine indicators](docs/screenshots/engine-menu.png)

---

## Hardware requirements

**VRAM is the real constraint** — both KataGo and the commentary model live in it.

| | Minimum | Recommended |
|---|---|---|
| OS | **Windows 10 / 11 (64-bit)** | same |
| RAM | 8 GB | 16 GB |
| GPU | 4 GB VRAM (or integrated graphics — KataGo alone is fine) | **8 GB VRAM** (RTX 3060 / 4060 or better) |
| Disk | ~2 GB | ~8 GB (if you want the commentary model) |

> ### 🍎 macOS users, read this first (it works now — but you build it yourself)
>
> **The code supports macOS as of 2026-10-09, but we do not ship a prebuilt Mac app.**
> Straight reason: **the developer has no Mac**, so any binary we produced would go out
> untested — and we don't ship untested binaries. Apple code signing + notarization also
> costs a $99/year developer account, which isn't on the table right now.
>
> **So on macOS: you build it, and you install the engines.** It's a handful of commands.
>
> #### Step 1 — install the two engines
>
> ```bash
> # (a) KataGo — Homebrew build uses the Metal backend, native on Apple Silicon
> brew install katago
> katago version          # should print "Using Metal backend"
>
> # (b) llama.cpp for the commentary engine — two options:
> #
> #     [easier] Homebrew — recommended; it skips the hassle in step 3-②
> brew install llama.cpp
> #     lands at /opt/homebrew/bin/llama-server — point the app there
> #
> #     [specific version] official macOS build (~11 MB)
> #       Apple Silicon: llama-bXXXXX-bin-macos-arm64.tar.gz
> #       Intel Mac    : llama-bXXXXX-bin-macos-x64.tar.gz
> #       https://github.com/ggml-org/llama.cpp/releases
> #     Keep the whole unpacked folder — llama-server needs the .dylibs next to it.
> #
> # (c) The commentary model (~4.4 GB, same file Windows users download)
> #     LoGos-7B-Q4_K_M.gguf — also needs step 3-②
> ```
>
> ⚠️ **★ Important (learned the hard way)**: **every file you download from a browser
> must go through step 3-②.** Doing `xattr` on `RapaceGo.app` alone is **not enough** —
> the engines (llama-server, KataGo, the LoGos `.gguf`) are **separate downloads** and
> each carries macOS's quarantine flag. A quarantined binary **cannot be executed**,
> which shows up as "the app sees the program but it just won't run".
> (The first version of this page omitted that line; a user hit it and reported back.)
>
> #### Step 2 — build
>
> ```bash
> git clone https://github.com/Rapace7/RapaceGo.git
> cd RapaceGo
> npm install
> npm run dist:mac        # produces dist/RapaceGo-mac-arm64.zip (Intel: -x64)
> ```
>
> ★ **The app bundle does not contain KataGo, the weights, or the LoGos model** —
> `build.files` is an allowlist of app code only (318 MB unpacked, 122 MB zipped).
> Engines and models are installed in step 1 and pointed at from inside the app.
> Build just your own arch (faster): `node_modules/.bin/electron-builder --mac --arm64`.
>
> ★ **Your data does not live inside the .app**: settings, records, puzzles, engines and
> models all go to `~/Library/Application Support/RapaceGo/` (`settings.json`, `KataGo/`,
> `LoGos/`, `records/`, `puzzles/`). Replacing the .app on upgrade therefore keeps
> everything; do not put engines under `Contents/MacOS/` — they survive only until the
> next upgrade.
>
> #### Step 3 — get past Gatekeeper once
>
> **① For the app itself**
>
> The build is **unsigned**, so macOS will say *"is damaged and can't be opened"* —
> **that's the normal unsigned-app behaviour, not a broken download.** Either:
>
> ```bash
> xattr -cr /Applications/RapaceGo.app     # recommended: strip the quarantine flag
> ```
>
> or **right-click the app → Open → Open** (only needed the first time).
>
> **② ★ For the engine files you downloaded (easy to miss, and a real user hit it)**
>
> ```bash
> # Using the official llama.cpp build: do the whole unpacked folder
> xattr -cr ~/Downloads/llama-bXXXXX-bin-macos-arm64/
>
> # And the model too (the 4.4 GB .gguf)
> xattr -cr ~/Downloads/LoGos-7B-Q4_K_M.gguf
> ```
>
> **Why this is required**: macOS tags **every file downloaded by a browser** with the
> quarantine flag, and a tagged binary **will not execute**. The symptom is "the app
> recognises the program but can't run it" — not something you'd naturally blame on
> a quarantine flag.
>
> **Installed via `brew install katago` / `brew install llama.cpp`? Skip this step** —
> Homebrew files carry no quarantine flag. That's another reason to prefer Homebrew.
>
> #### Step 4 — point the app at three files
>
> In **Settings**:
>
> | Field | What to put |
> |---|---|
> | KataGo program | `/opt/homebrew/bin/katago` (Intel Mac: `/usr/local/bin/katago`) |
> | llama-server | `/opt/homebrew/bin/llama-server`, or the `llama-server` you unpacked |
> | Commentary weight | the `LoGos-7B-Q4_K_M.gguf` from step 1 |
>
> **Point both `katago` and `llama-server` at the Homebrew paths** — that skips
> step 3-② entirely, and brew keeps them updated.
>
> #### Known limitations (honestly)
>
> - **Apple Silicon (M-series) is what we promise.** Homebrew has arm64 bottles.
>   There is **no x86_64 macOS bottle**, so on an Intel Mac `brew install katago`
>   **compiles from source and takes a long time**; Intel users may prefer the
>   CPU-only `eigen` build.
> - **None of the Mac path has been tested on real hardware** (no Mac available).
>   The code changes are complete (no more hardcoded `.exe`, proper macOS app menu)
>   and the full Windows test suite passes, but **real-world results depend on your
>   feedback** — please open an [issue](https://github.com/Rapace7/RapaceGo/issues)
>   and paste your terminal output.
> - **Don't want to build it?** Run Windows in a VM (Parallels/UTM) or remote into a
>   Windows box — or use another Go GUI with the same KataGo:
>   [KaTrain](https://github.com/sanderland/katrain),
>   [Lizzie](https://github.com/featurecat/lizzie),
>   [Sabaki](https://sabaki.yichuanshen.de/), or
>   [q5Go](https://github.com/bernds/q5Go).
>
> ### GPU brands (NVIDIA / AMD / Intel all work)
>
> The app doesn't care about your GPU brand, but **KataGo ships several
> mutually-incompatible builds** and the wrong one simply fails to start:
>
> | Your GPU | KataGo build (filename prefix) |
> |---|---|
> | **NVIDIA** | `cuda…` or `trt…` (fastest) |
> | **AMD** | `opencl…` (works on any brand), or `rocm7.13-gfx???…` (faster; match your GPU: RDNA2=`gfx103X`, RDNA3=`gfx110X`, RDNA3.5=`gfx1151`, RDNA4=`gfx120X`) |
> | **Intel iGPU / Arc** | `opencl…` or `onnx-openvino…` |
> | Any brand (cross-vendor) | `onnx-directml…` |
> | CPU only | `eigen…` / `eigenavx2…` |
>
> Unsure? Use `opencl` — it works on every brand, just a bit slower than a
> vendor-specific build. Then verify in
> **Settings → engine compatibility self-check → Check**, which reads the backend the
> engine reports and compares it against your GPU.
>
> ⚠️ **Honest note**: development and testing happen on an **NVIDIA RTX 4070**, so the
> **AMD / Intel paths are not machine-verified here**. The table above comes from
> KataGo's official release assets. If an AMD card still won't start after those steps,
> paste the self-check result into an issue.

Measured VRAM usage (RTX 4070 Laptop / 8 GB, read with `nvidia-smi`):

| Component | Usage |
|---|---|
| KataGo analysis engine (winrate, candidates, territory, review) | ≈ **350 MB** |
| KataGo play engine (AI moves) | ≈ **170 MB** |
| LoGos commentary model (Q4_K_M, 7B) | ≈ **4.9 GB** |
| **All three at once** | ≈ **5.5 GB** |

- **6 GB VRAM works**, but don't load all three at once (unload one first)
- **4 GB / integrated graphics**: KataGo features only — commentary will keep saying
  "commentary model not loaded"
- **To run all three at once you want 8 GB**

> This is exactly why the app **loads no engine at all by default** — if you're not using
> AI, nothing occupies VRAM. Click the indicator in the top bar when you need it, and
> unload when you're done.

**No discrete GPU?** KataGo can run CPU-only — slow, but playable. Download the `eigen`
build (`katago-v?…-eigen-windows-x64.zip`) and point **Settings → KataGo program** at it.

> ⚠️ There is **no "switch to CPU" toggle in Settings** — the panel only sets file paths.
> Which device is used is decided by **which build of `katago.exe` you put there**
> (see the GPU table above). The old README said "changeable in Settings"; that was wrong
> (fixed 2026-10-09).

The commentary model also runs on CPU but drops to a few characters per second, which is
effectively unusable.

---

## ⚠️ Neither the repo nor the download bundles the engines or the model

Only the application code is here (about 600 KB). To actually run it you must provide
your own copies — they are third-party projects with their own licenses:

| What | Where from | Put it at |
|---|---|---|
| **KataGo** binary | [lightvector/KataGo](https://github.com/lightvector/KataGo/releases) (Windows) | `<app>\KataGo\engine\katago.exe` |
| **KataGo weights** (two) | [katagotraining.org](https://katagotraining.org/) — one strong, one `human` | `<app>\KataGo\weights\*.bin.gz` |
| **llama.cpp** runtime | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp/releases), CUDA build (**the official zip does NOT bundle the CUDA runtime — grab the matching `cudart` zip too**) | `<app>\LoGos\llama-server.exe` |
| **LoGos-7B** weights | [YichuanMa/LoGos-7B](https://huggingface.co/YichuanMa/LoGos-7B), converted to GGUF (Q4_K_M ≈ 4.4 GB) | `<app>\LoGos\LoGos-7B-Q4_K_M.gguf` |

Lay them out like this and it just works (the app looks **next to itself**):

```
RapaceGo/
├─ RapaceGo.exe
├─ KataGo/
│  ├─ engine/katago.exe
│  └─ weights/b11c768nbt.bin.gz, b18c384nbt-humanv0.bin.gz
└─ LoGos/                        ← optional: skip it entirely if you don't want commentary
   ├─ llama-server.exe
   └─ LoGos-7B-Q4_K_M.gguf
```

> ### `.bin.gz` or plain `.bin`? **Both work.**
> `katagotraining.org` hands out gzipped weights (`.bin.gz`) — use them as-is, no unpacking.
> But some file hosts (Quark, for one) **refuse to share archives**, so people unzip the
> `.bin.gz` into a plain `.bin` before uploading. The app accepts **both** (tested: KataGo
> loads a plain `.bin` fine — it is just bigger, ~270 MB vs ~200 MB).
> If your downloaded weight doesn't show up in the file picker, its extension was probably
> mangled on the way — switch the dialog to "All files".

> **Already grabbed `LoGos-7B-Q4_K_M.gguf.part01 / .part02 / .part03` yourself?**
> Then the .bat is unnecessary — see the **▶ Click to expand** section just below,
> it merges them with one command.

<details>
<summary><b>▶ Click to expand: already downloaded the three .part files? Merge them yourself instead of using the .bat</b></summary>

If you grabbed `LoGos-7B-Q4_K_M.gguf.part01 / .part02 / .part03` from the Releases page,
join them into a single `LoGos-7B-Q4_K_M.gguf` (same folder). Either way works:

**① One line in the command prompt**

```bat
copy /b LoGos-7B-Q4_K_M.gguf.part01+LoGos-7B-Q4_K_M.gguf.part02+LoGos-7B-Q4_K_M.gguf.part03 LoGos-7B-Q4_K_M.gguf
```

**② PowerShell (streamed, low memory use)**

```powershell
$out = [System.IO.File]::Create("LoGos-7B-Q4_K_M.gguf")
foreach ($p in "part01","part02","part03") {
  $i = [System.IO.File]::OpenRead("LoGos-7B-Q4_K_M.gguf.$p")
  $i.CopyTo($out); $i.Close()
}
$out.Close()
```

**③ 7-Zip / WinRAR — no.** Archive tools have no "join split files" function.

**⚠️ Always check the result**: it should be **4,466,xxx,xxx bytes (about 4.36 GB)**.
If it's smaller, a part did not finish downloading — delete them and download again.
Then delete the three `.part` files to reclaim 4.4 GB, and point the app's Settings at
`llama-server.exe` and the merged `.gguf`.

> Why split files at all? GitHub refuses any single file over 2 GB, and this model is
> 4.4 GB. The parts are plain binary chunks — joining them reproduces the original file
> byte for byte (verified with sha256 during development).

</details>

**Just want to play, no commentary?** Prepare only the KataGo files — the commentary
features simply stay unused. Anywhere else works too: set it in the app's Settings, or
via the `RAPACEGO_KATAGO` / `RAPACEGO_LOGOS` environment variables.

### Option 1: download the ready-to-run build (recommended)

> ## ⬇️ [Go straight to the newest download list (Assets)](https://github.com/Rapace7/RapaceGo/releases/latest#assets)
>
> That link **always lands on the newest release** (no version number to remember), and drops
> you right at the file list. `RapaceGo.zip` in there is the one you want.

Grab it from the **[download list](https://github.com/Rapace7/RapaceGo/releases/latest#assets)** —
the link above always points at the newest release, so you never have to look up a version
number. (For the full history and changelogs, the
**[Releases page](https://github.com/Rapace7/RapaceGo/releases)** lists every version, newest
at the top.)

| File | Size | Notes |
|---|---|---|
| `RapaceGo.zip` | ~146 MB | unzip it once, then launch from the folder — **fastest startup** ⭐ |

That is the only download: the build ships as a single archive so that **everything lives
in one folder** — the engines, your game records, the settings. Copy that folder anywhere and
it still works; delete it and nothing is left behind.

Drop the two engine folders next to `RapaceGo.exe` and you're done.

> ✅ **Unzipping into a nested folder (e.g. `D:\Games\RapaceGo\RapaceGo\`) is fine.**
> The app looks for `KataGo/` and `LoGos/` in **the folder the .exe itself lives in**,
> so the path and the nesting depth do not matter — verified against the packaged build
> on 2026-10-09. The only requirement is that `KataGo/` sits in the **same folder**
> as `RapaceGo.exe`.

### Option 2: run from source (to change the code)

```
git clone https://github.com/Rapace7/RapaceGo.git
cd RapaceGo
npm install
start.bat            (double-click)
```

In source mode the engines go **one level above** the project folder, or you point at
them in Settings. `.npmrc` already carries Chinese mirrors so `npm install` is fast
domestically.

### Configure the paths

Open **Settings** (top-left) and point it at your files. Every field has a `?`
you can hover for what it is and where to find it:

![Settings](docs/screenshots/settings-help.png)

> **The classic mistake**: the *opponent* weight must be the one with `human` in its
> filename. Using a normal weight there makes the engine exit immediately.

---

## Updating to a newer version

**In one sentence: unzip the new build over your existing folder and let it overwrite. Your
game records and settings are not touched.**

### Three steps

1. **Check which version you have** — open the app → **Help** (top-left) → the version is
   shown next to the title (e.g. `v0.1.10`).
   (The download is always named `RapaceGo.zip` **without** a version number, so the filename
   can't tell you what you have — this is the only way.)

2. **See if there's something newer** → <https://github.com/Rapace7/RapaceGo/releases>
   The **topmost entry is the latest**, with its version and date in the title.

3. **Close the app** → download the new `RapaceGo.zip` → **unzip it into the same folder**
   (choose your current folder as the destination; when Windows asks, pick "Replace the files
   in the destination") → double-click `RapaceGo.exe` again.

### Why nothing is lost

The archive contains **only the application** — none of your data:

| Yours | In the archive? | After updating |
|---|---|---|
| `records\` — your SGF files, review reports, move-by-move commentary | ❌ no | **kept as-is** |
| `puzzles\` — imported SGF puzzle collections | ❌ no | **kept as-is** |
| `settings.json` — the engine paths you configured | ❌ no | **kept as-is** |
| `KataGo\`, `LoGos\` — the engines and the commentary model | ❌ no | **kept as-is** |
| `userdata\` — app cache | ❌ no | kept (safe to delete, it gets rebuilt) |

> ⚠️ **Always close the app before updating.** While it's running the files are locked, so the
> overwrite fails or only partly completes — which looks like "still the old version after
> updating", or the app won't start at all. Wait a few seconds after closing the window.

### Belt and braces (optional)

Copy the **`records` folder** somewhere else before updating. It's the only thing that
**can't be recovered** if it's lost (your games and commentary); the app itself can always be
downloaded again from the Releases page.

### How the version numbers work

| Digit | When it goes up | Example |
|---|---|---|
| **third** | Bug fixes and small changes. **+1 on every release**, may be frequent | 0.1.0 → **0.1.1** → 0.1.2 |
| **second** | A new feature you can actually notice; only once a batch accumulates | 0.1.x → **0.2.0** |
| **first** | Only `1.0.0`: stable enough to recommend to anyone | |

No big jumps — every release only moves the third digit, so `0.1.1 → 0.1.2` just means
"another batch of fixes".

---

## Notes on the commentary

- **Speed**: about 2–4 s for a 150–200 character explanation on an RTX 4070 Laptop.
  A full 200-move game takes roughly 8–12 minutes, can be stopped, and **resumes**
  where it left off.
- **⚠️ The commentary is always in Chinese.** LoGos (a 7B model fine-tuned on
  Chinese-annotated Go data) only outputs Chinese — even when both the system prompt
  and the user prompt are in English, it still answers in Chinese. This isn't a setting
  we can flip.
  **The practical workaround**: the commentary is plain prose, so just **select it and
  paste it into any translation tool or LLM** (Google Translate, DeepL, ChatGPT, etc.).
  It translates cleanly, and Go terminology comes through fine.
- **It makes mistakes**: LoGos is a 7B model. It sometimes uses the wrong technical
  term (calling a star point a komoku, etc.). **Positions are usually right, names may be wrong.**
  Trust KataGo's numbers over its wording.
- "Explain whole game" ≠ "AI review": the review produces a *data report*,
  the commentary produces *per-move prose*.

---

## How this was built (human + AI agent)

**Nearly all of the code was written by an AI agent.** This project is an experiment
in long-running human–AI collaboration:

- **The human** sets direction, decides features, judges usability, accepts results.
- **The AI agent** (running on [WorkBuddy](https://www.workbuddy.cn/docs/workbuddy/Overview))
  writes the code, researches APIs, runs the tests, writes docs, fixes bugs.

The development conversations were powered by **DeepSeek V4.1 Flash**.

The whole process is recorded in **[开发记录.md](开发记录.md)** (Chinese) — not a changelog,
but a *decision log*: why each feature is the way it is, which approaches were rejected,
what broke, and the measured numbers behind each choice.

The `_*.mjs` / `_rtest.py` files in the repo root are the self-check suite:
static checks (DOM references, IPC contract, `[hidden]` collisions), end-to-end smoke tests,
and cross-game race regression. They run in seconds after every change.

---

## FAQ

**"How do I know if there's a newer version?"**
Settings → **关于与更新** → **检查更新**. It asks GitHub what the latest release is and compares
it with your build. The **去下载页** button next to it opens the latest release page in your browser
(it always points at the newest release).

**"Does this app need the internet? Does it phone home?"**
**Apart from that one update check, nothing here touches the network.** KataGo and LoGos are local
processes; the app talks to LoGos over **loopback** (127.0.0.1), so no data leaves your machine.
The update check fires **only when you click it** — no auto-check, no background calls, no telemetry.
If it can't reach GitHub it says so instead of pretending you're up to date.
(Enforced by `dev/_lint_net.mjs`, which fails if anything outside the update check reaches the net.)

**"Engine not found"?** Fix the paths in Settings — where the engines must go depends on
which build you are running:

- **The downloaded zip (packaged build)**: engines sit in **the same folder as `RapaceGo.exe`**
  (`KataGo/`, `LoGos/` as siblings of the exe). The path and the nesting depth do not matter.
- **Running from source**: engines go **one level above the project folder**
  (code in `D:\x\RapaceGo\` → engines in `D:\x\KataGo\`). Same on macOS —
  but there you'd typically just point Settings at the Homebrew `katago`.
- **The all-in-one package (懒人包)**: already configured; if you still see this, open an Issue
  with a screenshot of the paths in Settings.

**"I can't see my downloaded weights in the file picker"?**
The app accepts **`.bin.gz` and `.bin`**. Some hosts (Quark) won't share archives, so people
unzip the weight into a plain `.bin` first — that works too, no need to re-zip it.
If the extension got mangled along the way (browser added `.zip`, or a `(1)` suffix),
switch the dialog's file type to "All files".

**"Commentary model not loaded"?** Click the `LoGos` indicator in the top bar → Load.
Not loading it by default is intentional (saves VRAM).

**llama-server is extremely slow (seconds per character)?**
It's probably running on CPU — the official Windows CUDA build ships **without** the
CUDA runtime. Run `llama-server.exe --list-devices`; if it prints `none`, download the
matching `cudart-*.zip` from the same llama.cpp release and drop the DLLs next to the exe.

**Recommended moves stopped showing, or the "computing… N" line above the board
freezes and nothing responds?**
Click **Refresh** next to the engine lamps in the top bar. It releases the stuck
analysis, re-queues it, re-checks the engine, and restarts the engine if it is dead.

**Why does the move I just played show "…" instead of a number?**
It is still computing. Numbers appear **only once the search has settled, and never
change after that** — on purpose: the engine reports partial results every 0.25 s, and
showing those would make the same number jump around. Lower "search depth" in the bottom
bar if you want numbers sooner.

**Where are my games?** In `records\` next to the app.

**Can I redistribute it bundled with the model?** Please don't — LoGos is licensed for
research / non-commercial use only, and 4.4 GB doesn't travel well anyway.

---

## License & credits

This project's code: **MIT** (see [LICENSE](LICENSE)).

It depends on excellent open-source work, each under its own license:

- [KataGo](https://github.com/lightvector/KataGo) — the engine (MIT).
- [LoGos / InternThinker-Go](https://huggingface.co/YichuanMa/LoGos-7B) (Shanghai AI Lab) —
  the explaining model. ⚠️ Its model card says Apache-2.0, but the project README states
  the data is **CC BY-NC 4.0, research use only** — **treat it as non-commercial.**
- [llama.cpp](https://github.com/ggml-org/llama.cpp) — inference runtime (MIT).
- [Electron](https://www.electronjs.org/) — desktop shell (MIT).

The UI, rules engine, SGF I/O and the commentary pipeline are original code in this repo.
