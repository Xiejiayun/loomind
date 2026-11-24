import type { MindmapTopic } from "../model/document.js";
import type { DepthStyleToken } from "../theme/tokens.js";
import type { TextMeasurer } from "./measurer.js";
import type { NodeMeasurement } from "./types.js";

export const CALLOUT_GAP = 10;

export function measureTopicBox(
  topic: MindmapTopic,
  token: DepthStyleToken,
  measurer: TextMeasurer,
  hasTaskSummary: boolean,
): NodeMeasurement {
  const fontSize = topic.style?.fontSize ?? token.fontSize;
  const fontWeight = topic.style?.fontWeight ?? token.fontWeight;
  const padX = token.paddingX;
  const padY = token.paddingY;

  const maxTextWidth = topic.customWidth
    ? Math.max(48, topic.customWidth - padX * 2)
    : 280;

  const measuredTitle = measurer.measureRichText(topic.title, {
    fontSize,
    fontWeight,
    maxWidth: maxTextWidth,
  });

  // Main row horizontal extras
  let mainRowExtras = 0;
  if (hasTaskSummary || topic.task) mainRowExtras += 22;
  if (topic.markers && topic.markers.length > 0) mainRowExtras += topic.markers.length * 20 + 4;
  if (topic.stickerId) mainRowExtras += 30;
  if (topic.href) mainRowExtras += 18;
  if (topic.note) mainRowExtras += 18;

  let mainRowWidth = measuredTitle.width + mainRowExtras;
  let mainRowHeight = Math.max(measuredTitle.height, topic.stickerId ? 24 : 18);

  // Side image
  if (topic.image && (topic.image.pos === "left" || topic.image.pos === "right")) {
    const imgW = Math.min(topic.image.width, 160);
    const imgH = Math.min(topic.image.height, 120);
    mainRowWidth += imgW + 8;
    mainRowHeight = Math.max(mainRowHeight, imgH);
  }

  let bodyWidth = mainRowWidth;
  let bodyHeight = mainRowHeight;

  // Top image
  if (topic.image && topic.image.pos === "top") {
    const imgW = Math.min(topic.image.width, 220);
    const imgH = Math.min(topic.image.height, 140);
    bodyWidth = Math.max(bodyWidth, imgW);
    bodyHeight += imgH + 8;
  }

  // Labels row
  if (topic.labels && topic.labels.length > 0) {
    const labelsW = topic.labels.reduce((acc, l) => acc + l.length * 8 + 16, 0) + (topic.labels.length - 1) * 4;
    bodyWidth = Math.max(bodyWidth, Math.min(labelsW, maxTextWidth + 40));
    bodyHeight += 22;
  }

  // Subtitle
  if (topic.subtitle) {
    const sub = measurer.measurePlainText(topic.subtitle, {
      fontSize: 11,
      fontWeight: 400,
      maxWidth: maxTextWidth,
    });
    bodyWidth = Math.max(bodyWidth, sub.width);
    bodyHeight += sub.height + 4;
  }

  // Equation
  if (topic.equation?.latex) {
    const eqW = Math.min(260, Math.max(48, topic.equation.latex.length * 8.5 + 16));
    bodyWidth = Math.max(bodyWidth, eqW);
    bodyHeight += 28;
  }

  const strokeW = topic.style?.strokeWidth ?? token.strokeWidth;
  const borderExtra = Math.ceil(strokeW * 2);
  const contentWidth = topic.customWidth
    ? Math.max(topic.customWidth, bodyWidth + padX * 2 + borderExtra + 8)
    : Math.max(64, bodyWidth + padX * 2 + borderExtra + 10);
  const contentHeight = Math.max(30, bodyHeight + padY * 2 + borderExtra + 2);

  let calloutWidth = 0;
  let calloutHeight = 0;
  if (topic.callout) {
    const co = measurer.measureRichText(topic.callout.title, {
      fontSize: 12,
      fontWeight: 500,
      maxWidth: 180,
    });
    calloutWidth = Math.max(48, co.width + 18);
    calloutHeight = Math.max(24, co.height + 10);
  }

  const totalWidth = Math.max(contentWidth, calloutWidth);
  const totalHeight = calloutHeight > 0 ? contentHeight + calloutHeight + CALLOUT_GAP : contentHeight;

  return {
    width: Math.ceil(totalWidth),
    height: Math.ceil(totalHeight),
    contentWidth: Math.ceil(contentWidth),
    contentHeight: Math.ceil(contentHeight),
    calloutWidth: Math.ceil(calloutWidth),
    calloutHeight: Math.ceil(calloutHeight),
  };
}
