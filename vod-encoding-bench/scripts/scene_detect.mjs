import { execSync } from "node:child_process";

/**
 * 检测视频场景切换点
 *
 * 使用 FFmpeg 的 scene 过滤器检测视频中的场景切换时间点。
 * 场景切换检测基于相邻帧之间的差异程度，超过阈值则认为发生场景切换。
 *
 * @param {string} inputFile - 输入视频文件路径
 * @param {number} sceneThresh - 场景切换阈值 (0.0-1.0)，默认推荐 0.4
 *                               值越小越敏感，检测到的切换点越多
 * @returns {number[]} 场景切换时间点数组（秒），按升序排列且去重
 *
 * @example
 * const cuts = detectScenes('./video.mp4', 0.4);
 * // 返回: [5.234, 12.567, 23.891, ...]
 * // 表示在这些时间点发生了场景切换
 */
export function detectScenes(inputFile, sceneThresh) {
  const cmd = `ffmpeg -hide_banner -i "${inputFile}" -filter:v "select='gt(scene,${sceneThresh})',showinfo" -an -f null - 2>&1`;
  const stderr = execSync(cmd, { stdio: "pipe", shell: "/bin/bash" }).toString(
    "utf8"
  );
  const cuts = [];
  const re = /pts_time:([0-9.]+)/g;
  let m;
  while ((m = re.exec(stderr)) !== null) {
    cuts.push(parseFloat(m[1]));
  }
  const uniq = Array.from(new Set(cuts)).sort((a, b) => a - b);
  return uniq;
}

/**
 * 根据场景切换点构建视频片段
 *
 * 将视频分割成多个片段，优先在场景切换点分割，同时遵守片段时长约束。
 * 算法优先选择 [minDurSec, maxDurSec] 范围内的场景切换点，
 * 如果范围内没有切换点，则在 maxDurSec 处强制分割。
 *
 * @param {number[]} sceneCuts - 场景切换时间点数组（秒）
 * @param {number} totalDur - 视频总时长（秒）
 * @param {number} [minDurSec=4.0] - 片段最小时长（秒）
 * @param {number} [maxDurSec=8.0] - 片段最大时长（秒）
 * @returns {Array<{start: number, dur: number, end: number}>} 片段数组
 *
 * @example
 * const cuts = [5.2, 12.5, 18.3, 25.6];
 * const segments = buildSegments(cuts, 30.0, 4.0, 8.0);
 * // 返回: [
 * //   { start: 0, dur: 5.2, end: 5.2 },      // 优先使用场景切换点
 * //   { start: 5.2, dur: 7.3, end: 12.5 },   // 范围内的切换点
 * //   { start: 12.5, dur: 5.8, end: 18.3 },  // 范围内的切换点
 * //   { start: 18.3, dur: 7.3, end: 25.6 },  // 范围内的切换点
 * //   { start: 25.6, dur: 4.4, end: 30.0 }   // 到视频结尾
 * // ]
 */
export function buildSegments(
  sceneCuts,
  totalDur,
  minDurSec = 4.0,
  maxDurSec = 8.0
) {
  let segs = [];
  let curStart = 0.0;
  let idx = 0;
  while (curStart < totalDur - 0.01) {
    const minT = curStart + minDurSec;
    const maxT = Math.min(curStart + maxDurSec, totalDur);
    let pick = null;
    while (idx < sceneCuts.length && sceneCuts[idx] < minT) idx++;
    let j = idx;
    while (j < sceneCuts.length && sceneCuts[j] <= maxT) {
      pick = sceneCuts[j];
      j++;
    }
    const end = pick ?? maxT;
    const dur = +(end - curStart).toFixed(3);
    segs.push({ start: curStart, dur, end });
    curStart = end;
  }
  return segs;
}

/**
 * 获取视频总时长
 *
 * 使用 ffprobe 读取视频文件的时长信息。
 *
 * @param {string} inputFile - 输入视频文件路径
 * @returns {number} 视频时长（秒）
 *
 * @example
 * const duration = getDurationSeconds('./video.mp4');
 * // 返回: 125.467 （表示视频时长 2 分 5.467 秒）
 */
export function getDurationSeconds(inputFile) {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${inputFile}"`,
    { stdio: "pipe" }
  )
    .toString("utf8")
    .trim();
  return parseFloat(out);
}
