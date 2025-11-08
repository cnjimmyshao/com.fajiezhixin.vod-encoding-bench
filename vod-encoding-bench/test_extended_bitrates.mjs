import { decideBitrateForSegment } from './scripts/bitrate_probe.mjs';

console.log('\n测试扩展码率范围 / Testing extended bitrate range\n');
console.log('目标 VMAF / Target VMAF: 95');
console.log('探测码率 / Probe bitrates: [600, 800, 1000, 1500, 2500, 3500, 5000, 7000, 10000] kbps\n');

const result = decideBitrateForSegment({
  inputFile: 'assets/sample.mpeg',
  start: 0,
  dur: 4.0,
  height: 1080,
  codec: 'libx264',
  implementation: 'cpu',
  probeBitratesKbps: [600, 800, 1000, 1500, 2500, 3500, 5000, 7000, 10000],
  gopSec: 2,
  audioKbps: 128,
  tmpDir: '/tmp/extended_bitrate_test',
  vmafModel: 'vmaf_v0.6.1.json',
  targetVmaf: 95
});

console.log('\n结果 / Result:');
console.log(`  选择码率 / Chosen bitrate: ${result.chosenBitrateKbps} kbps`);
console.log(`  预估 VMAF / Estimated VMAF: ${result.estVmaf.toFixed(2)}`);
console.log(`  是否达标 / Meets target: ${result.estVmaf >= 95 ? '✓ 是 / Yes' : '✗ 否 / No'}\n`);
