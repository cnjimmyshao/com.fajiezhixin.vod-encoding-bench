/**
 * 占位函数：未来用于独立的视频片段拼接功能
 *
 * 当前项目中视频片段拼接已集成在 per_scene_encode.mjs 的 concatSegmentsToFile() 中。
 * 此文件预留用于未来可能的独立拼接工具实现。
 *
 * @returns {boolean} 始终返回 true
 */
export function noop() {
  return true;
}
