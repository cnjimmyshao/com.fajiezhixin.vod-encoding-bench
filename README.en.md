# vod-encoding-bench

## Project Goals

Benchmark multiple offline encoding strategies for video-on-demand scenarios.

Compare baseline CRF, per-title, per-scene, and AI-preprocessed encoding workflows.

Support open-source codecs including H.264, H.265, VP9, and AV1.

Quantify average bitrate and file size differences while maintaining a target subjective quality (VMAF≈95).

## Prerequisites

Node.js version 24 or newer.

ffmpeg 8 or newer with libvmaf, libx264, libx265, libvpx-vp9, libsvtav1, and ideally NVENC-capable drivers installed.

Python 3.9 or newer, optionally with CUDA for the AI preprocessing script.

## Directory Overview

`scripts/`: Core pipeline scripts covering scene detection, bitrate probing, segmented encoding, and VMAF evaluation.

`configs/`: Parameter definitions such as experiment matrix, quality targets, and preprocessing models.

`ai_preprocess/`: AI preprocessing scripts and the integration point for future models.

`results/`: Output directory for experiment summaries.

`workdir/`: Workspace for temporary artifacts and segments (ignored by .gitignore).

`ARCHITECTURE.en.md`: Architectural overview and module boundaries.

## Configuration Highlights

The `configs/experiment_matrix.json` file drives the experiment strategy.

`targetVmaf`: Target VMAF threshold.

`heightList`: List of output resolutions to test.

`codecs`: Enumerated codecs to evaluate.

`encoderImplementations`: Encoder implementations to compare CPU and NVENC pipelines.

`modes`: Strategy modes to execute; `per_scene` and `ai_preprocess+per_scene` are currently implemented.

`probeBitratesKbps`: Candidate bitrates (kbps) for probing acceptable quality levels.

`gopSec`: GOP duration in seconds.

`sceneThresh`: Scene change detection threshold.

`audioKbps`: Audio bitrate in kbps.

`vmafModel`: libvmaf model file path.

`aiPreprocessModel`: Default model identifier for the AI preprocessing script.

## Quick Start

Prepare a test video, e.g., `./sample_input.mp4`.

Adjust codecs, resolutions, modes, and encoder implementations in `configs/experiment_matrix.json` as needed.

Run the basic per-scene workflow:

```
node ./scripts/run_experiment.mjs ./sample_input.mp4
```

When `ai_preprocess+per_scene` is enabled, the script automatically calls `python3 ./ai_preprocess/preprocess_video.py` to create an enhanced video before executing the per-scene encode.

To compare NVENC, ensure hardware and drivers are installed and keep the `nvenc` implementation in the configuration to generate CPU versus GPU results.

At present the NVENC workflow supports the H.264 and H.265 codecs; VP9 and AV1 automatically fall back to the CPU implementation.

## Output Artifacts

`workdir/<input name>/`: Mode-, codec-, and implementation-specific subdirectories containing segments, final stitched videos, and reference encodes.

`results/<input name>_summary.json`: Summary JSON listing final VMAF, estimated average bitrate, output path, and the encoder implementation for later analysis or visualization.

## AI Preprocessing Script

The placeholder script `ai_preprocess/preprocess_video.py` still copies the input video to the target path until real models are integrated.

- Basic usage:
  ```bash
  python3 ./ai_preprocess/preprocess_video.py --input ./source.mp4 --output ./enhanced.mp4 --model realesrgan_x4plus
  ```
- Automatically creates the parent directory for the output if it does not exist.
- Skips copying and prints a notice when input and output paths are identical.
- Exits with bilingual error messages when the input file is missing to speed up troubleshooting.

## Testing

Run basic smoke tests to verify core scripts:

```
npm test
```

Smoke tests include:

1. Generating a 10-frame test video.
2. Testing the `preprocess_video.py` script with mock parameters.
3. Testing the `per_scene_encode.mjs` script in 10-frame mode.

Note: Tests require ffmpeg with libvmaf support. If not available, encoding tests will be skipped.

## Roadmap

Implement the `baseline_crf` and `per_title` modes while keeping bilingual output consistent with the current workflow.

Integrate real super-resolution, denoising, or deblocking models and extend the `ai_preprocess` directory to support more model choices.

Produce DASH/HLS manifests and multi-resolution ABR ladders for player integration.

Enhance visualization and reporting capabilities to share results across teams.
