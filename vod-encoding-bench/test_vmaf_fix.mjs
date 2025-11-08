import { decideBitrateForSegment } from './scripts/bitrate_probe.mjs';

const result = decideBitrateForSegment({
  inputFile: 'assets/sample.mpeg',
  start: 0,
  dur: 4.0,
  height: 360,
  codec: 'libx264',
  implementation: 'cpu',
  probeBitratesKbps: [600, 800],
  gopSec: 2,
  audioKbps: 128,
  tmpDir: '/tmp/vmaf_test',
  vmafModel: 'vmaf_v0.6.1.json',
  targetVmaf: 95
});

console.log('测试结果 / Test result:');
console.log(`  选择码率 / Chosen bitrate: ${result.chosenBitrateKbps} kbps`);
console.log(`  预估 VMAF / Estimated VMAF: ${result.estVmaf.toFixed(2)}`);
