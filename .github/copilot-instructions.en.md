# VOD Encoding Benchmark - AI Agent Instructions

## Project Overview

Video-on-demand encoding benchmark comparing multiple strategies (baseline CRF, per-title, per-scene, AI preprocessing) across codecs (H.264, H.265, VP9, AV1) with CPU and NVENC implementations, targeting VMAF≈95 quality.

## Architecture & Data Flow

- **Entry point**: `scripts/run_experiment.mjs` orchestrates the entire pipeline per mode/codec/resolution/implementation
- **Core pipeline**: Scene detection → Bitrate probing → Segmented encoding → VMAF evaluation
- **Working directory pattern**: `workdir/<input_name>/<mode>_<height>p_<codec>_<impl>/` contains tmp files, segments, reports, and final videos
- **Results output**: `results/<input_name>_summary.json` aggregates VMAF scores and bitrates across all configurations

## Critical Implementation Patterns

### Bilingual Output

All console messages use `bilingual(chinese, english)` helper - maintain this pattern for consistency. Example:

```javascript
console.log(bilingual("正在编码...", "Encoding..."));
```

### Module Dependencies

- `scene_detect.mjs`: Exports `detectScenes()`, `buildSegments()`, `getDurationSeconds()`
- `bitrate_probe.mjs`: Exports `decideBitrateForSegment()` - returns `{ chosenBitrateKbps, estVmaf, probesUsed }`
  - Depends on `resolution_strategy.mjs`, `encoder_config.mjs`, `vmaf_calculator.mjs`
- `resolution_strategy.mjs`: Exports `getBitrateStrategy()`, `adjustSearchRange()` - manages resolution strategies
- `encoder_config.mjs`: Exports `encodeReference()`, `getEncoderArgs()`, `encodeSegment()` - manages encoder configs
- `vmaf_calculator.mjs`: Exports `measureVmaf()` - handles VMAF quality evaluation
- `per_scene_encode.mjs`: Exports `runPerSceneEncode()` - returns `{ finalFile, finalVmaf }`

### Encoder Implementation Logic

NVENC support is codec-specific:

- `libx264` / `libx265`: Both CPU and NVENC supported
- `libvpx-vp9` / `libsvtav1`: CPU only (NVENC unsupported, automatically skipped)
- Check `isImplementationSupported(codec, implementation)` before processing

### Configuration-Driven Execution

`configs/experiment_matrix.json` drives all experiments:

- `modes`: Controls which strategies run (`per_scene`, `ai_preprocess+per_scene`)
- `encoderImplementations`: `["cpu", "nvenc"]` - processes all combinations
- `useAdaptiveBitrateSearch`: Auto-determines bitrate ranges when enabled (recommended `true`)
- All parameters are consumed by `run_experiment.mjs` main loop

**Note:** When adaptive search is enabled, `probeBitratesKbps` config is no longer needed - bitrate ranges are auto-determined by resolution strategies.

### AI Preprocessing Integration

When `ai_preprocess+per_scene` mode runs:

1. Creates `workdir/<input>/ai_preprocess/<input>_enhanced.mp4`
2. Calls `python3 ./ai_preprocess/preprocess_video.py --input <source> --output <enhanced> --model <model_name>`
3. Uses enhanced video as input for subsequent per-scene encoding
4. **Current state**: `preprocess_video.py` is a copy placeholder - no actual enhancement yet

## Development Workflows

### Running Experiments

```bash
# Interactive mode (prompts for input video or generates test video)
node scripts/run_experiment.mjs

# With specific video
node scripts/run_experiment.mjs ./path/to/video.mp4

# Smoke tests (10-frame test videos)
npm test
```

### Adding New Encoding Modes

1. Add mode identifier to `configs/experiment_matrix.json` `modes` array
2. Add new branch in `run_experiment.mjs` main loop's mode dispatcher
3. Reuse existing helpers: `fetchSegments()`, `avgBitrateKbps()`, `decideBitrateForSegment()`
4. Ensure bilingual logging and summary row creation

### Modifying Encoder Parameters

Edit `resolveVideoArgs()` in `bitrate_probe.mjs`:

- CPU codecs: Adjust presets, GOP settings, pixel format
- NVENC codecs: Tune rate control (VBR, maxrate, bufsize), presets (p5, p7)
- Return `null` for unsupported codec/implementation combinations

## Key Technical Constraints

### Shell Command Execution

All ffmpeg/ffprobe calls use `sh()` helper or `execSync()` with explicit `/bin/bash` shell and `pipe` stdio to capture output. Follow this pattern for consistency.

### Segment Construction Rules

`buildSegments()` constraints:

- `minDurSec`: Default 4.0s minimum segment duration
- `maxDurSec`: Default 8.0s maximum segment duration
- Prefers scene cuts within this range, falls back to maxDurSec boundary

### Adaptive Bitrate Search (New Feature)

`decideBitrateForSegment()` supports two modes:

- **Adaptive Search** (default): Uses binary search + inter-segment historical reference, reduces probes by 40-60%
  - Resolution-specific strategy: Different bitrate ranges per resolution (360p: 300-1500 kbps, 1080p: 1500-10000 kbps)
  - Binary search: O(log n) complexity, typically 3-5 probes
  - Historical reference: `previousSegmentResult` parameter optimizes subsequent segment search range
- **Traditional Linear Probing**: Iterates through all bitrates in `probeBitratesKbps`, typically 7-9 probes
- Configuration: Set `useAdaptiveBitrateSearch: true/false` in `configs/experiment_matrix.json`
- Detailed documentation: `ADAPTIVE_BITRATE_SEARCH.md`

### VMAF Score Extraction

`compute_vmaf.mjs` and `bitrate_probe.mjs` handle multiple libvmaf JSON formats for FFmpeg version compatibility:

- FFmpeg 8.0+: `pooled_metrics.vmaf.mean` (primary)
- Older versions: `global_metrics.vmaf`, `aggregate.VMAF_score`, `VMAF_score`
  Falls back to 0 if none match.

### FFmpeg libvmaf Filter Version Differences

FFmpeg 8.0 changed the libvmaf filter API:

- Old versions use: `libvmaf=model_path='vmaf_v0.6.1.json'`
- FFmpeg 8.0+ uses: `libvmaf=model=version=vmaf_v0.6.1` or `model=path='/full/path'`
  Code auto-detects model parameter format (extracts version from filenames containing `vmaf_v`, treats paths containing `/` or `\` as full paths).

## Testing & Validation

### Smoke Test Coverage

`test/run_smoke_test.mjs` validates:

1. 10-frame test video generation via lavfi
2. `preprocess_video.py` execution with mock parameters
3. `per_scene_encode.mjs` end-to-end with small input
   Requires ffmpeg with libvmaf support - encoding tests skip if unavailable.

### Common Debugging Patterns

- Check `workdir/<input>/<mode>/tmp/` for probe-phase encoded segments
- Review `workdir/<input>/<mode>/report/<mode>_vmaf.json` for detailed VMAF frame scores
- Verify `results/<input>_summary.json` for aggregate metrics
- Inspect bilingual console output for segment-level decisions

## External Dependencies

- **Node.js**: v24+ required for ESM support
- **FFmpeg**: v8+ with libvmaf, codec libraries (libx264, libx265, libvpx-vp9, libsvtav1)
- **NVENC**: Requires CUDA-capable GPU and drivers for hardware encoding
- **Python**: 3.9+ for AI preprocessing script (currently placeholder, no ML dependencies yet)

## Future Extension Points

- `baseline_crf` mode: Implement fixed CRF encoding without scene detection
- `per_title` mode: Implement single-bitrate probe for entire video
- Real AI models: Integrate super-resolution/denoising in `preprocess_video.py` with PyTorch/TensorFlow
- ABR ladder generation: Produce DASH/HLS manifests from multi-resolution outputs
