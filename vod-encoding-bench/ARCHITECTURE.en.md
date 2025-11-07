# Architecture Overview

## End-to-End Flow
`run_experiment.mjs` reads the experiment matrix and target parameters to determine which encoding modes to run.

Each mode performs scene detection, bitrate probing, and segmented encoding on the input video while collecting VMAF and average bitrate metrics.

Results are written to `results/<input name>_summary.json` for later comparison or visualization.

## Core Modules
**Scene Detection (`scripts/scene_detect.mjs`)**

- Uses `ffmpeg` with `select` and `showinfo` filters to detect scene cut timestamps.
- `buildSegments` creates candidate segments under minimum and maximum duration constraints.

**Bitrate Probing (`scripts/bitrate_probe.mjs`)**

- Encodes each segment with configured bitrate, codec, and implementation candidates.
- Computes VMAF against the reference segment to pick the lowest bitrate meeting the target.

**Segmented Encoding (`scripts/per_scene_encode.mjs`)**

- Re-encodes all segments per decisions and concatenates them via `ffmpeg concat`.
- Produces a high-quality reference encode and evaluates final VMAF scores.

**AI Preprocessing (`ai_preprocess/preprocess_video.py`)**

- Currently a copy placeholder, ready for future super-resolution or denoising models.
- Defines input and output paths plus model name via CLI arguments.

## Working Directory Layout
`workdir/<input name>/<mode_resolution_codec_impl>/`

- `tmp/`: Temporary files produced during bitrate probing.
- `<mode tag>_segments/`: Encoded segments for final output.
- `report/`: JSON reports containing full-video VMAF scores.
- `final_<codec>_<mode tag>.mp4`: Final concatenated video.

`workdir/<input name>/ai_preprocess/`

- `*_enhanced.mp4`: Intermediate AI-enhanced videos.

## Extension Guidelines
To implement `baseline_crf` or `per_title`, add new branches in `run_experiment.mjs` while reusing `avgBitrateKbps` and summary logic.

When integrating real AI models, modify `preprocess_video.py` while keeping the input and output interface consistent.

To parallelize probing, introduce task queues or worker pools around `decideBitrateForSegment` while avoiding naming conflicts in temporary directories.
