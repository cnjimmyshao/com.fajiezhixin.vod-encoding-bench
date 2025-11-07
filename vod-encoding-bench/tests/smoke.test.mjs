import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function prepareInputVideo(tmpDir) {
  const chosen = process.env.VOD_BENCH_TEST_INPUT;
  if (chosen && chosen.trim()) {
    return chosen;
  }

  const check = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (check.error || check.status !== 0) {
    const placeholder = join(tmpDir, 'smoke_input.mp4');
    writeFileSync(placeholder, 'placeholder video for smoke test', 'utf8');
    return placeholder;
  }

  const outFile = join(tmpDir, 'smoke_input.mp4');
  const ffmpegArgs = [
    '-y',
    '-hide_banner',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x240:rate=30',
    '-f', 'lavfi',
    '-i', 'sine=frequency=1000:sample_rate=48000',
    '-shortest',
    '-t', '1.5',
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '28',
    outFile
  ];
  const proc = spawnSync('ffmpeg', ffmpegArgs, { encoding: 'utf8' });
  if (proc.error || proc.status !== 0) {
    throw new Error(`Failed to create random video: ${proc.stderr || proc.stdout || proc.error?.message}`);
  }
  return outFile;
}

test('run_experiment completes in smoke test mode', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'vod-bench-smoke-'));
  const inputVideo = prepareInputVideo(tempRoot);
  const configPath = join(tempRoot, 'smoke_config.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        targetVmaf: 95,
        heightList: [144],
        codecs: ['libx264'],
        encoderImplementations: ['cpu'],
        modes: ['per_scene'],
        probeBitratesKbps: [250],
        gopSec: 2,
        sceneThresh: 0.5,
        audioKbps: 64,
        vmafModel: 'vmaf_v0.6.1.json'
      },
      null,
      2
    ),
    'utf8'
  );

  const resultsDir = join(tempRoot, 'results');
  const workDir = join(tempRoot, 'workdir');
  const env = {
    ...process.env,
    VOD_BENCH_CONFIG: configPath,
    VOD_BENCH_RESULTS_DIR: resultsDir,
    VOD_BENCH_WORKDIR: workDir,
    VOD_BENCH_SMOKE_TEST: '1',
    VOD_BENCH_SMOKE_DURATION: '1.5'
  };

  const proc = spawnSync('node', ['./scripts/run_experiment.mjs', inputVideo], {
    cwd: repoRoot,
    env,
    encoding: 'utf8'
  });

  assert.strictEqual(
    proc.status,
    0,
    `run_experiment exited with ${proc.status}.\nSTDOUT:\n${proc.stdout}\nSTDERR:\n${proc.stderr}`
  );

  const summaryPath = join(
    resultsDir,
    `${basename(inputVideo).replace(/\.[^.]+$/, '')}_summary.json`
  );
  assert.ok(existsSync(summaryPath), 'summary file should exist');
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  assert.ok(Array.isArray(summary) && summary.length > 0, 'summary should contain records');

  const first = summary[0];
  assert.equal(first.codec, 'libx264');
  assert.equal(first.mode, 'per_scene');
  assert.equal(first.implementation, 'cpu');
  assert.equal(first.height, 144);
  assert.ok(typeof first.avgBitrateKbps === 'number');
  assert.ok(first.finalVmaf >= 0);
  assert.ok(existsSync(first.outputFile), 'output file should exist on disk');
});
