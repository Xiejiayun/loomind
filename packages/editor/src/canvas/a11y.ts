import {
  richTextToPlainText,
  type LayoutNode,
  type MindmapLayoutResult,
  type MindmapTopic,
} from "@mindmap/core";

export interface TopicA11yLabels {
  untitledTopic: string;
  level: (depth: number) => string;
  taskDone: string;
  taskTodo: string;
  taskProgress: (done: number, total: number) => string;
  collapsedChildren: (count: number) => string;
  childCount: (count: number) => string;
  hasNote: string;
  hasLink: string;
  multiSelected: (count: number) => string;
}

/**
 * Builds a concise, human-friendly ARIA label for a mindmap topic node
 * so screen readers announce hierarchy depth, task status, collapse state, and attachments.
 */
export function buildTopicAriaLabel(
  topic: MindmapTopic,
  layoutNode: LayoutNode,
  labels: TopicA11yLabels,
): string {
  const parts: string[] = [];
  const title = richTextToPlainText(topic.title).replace(/\s+/g, " ").trim();
  parts.push(title || labels.untitledTopic);
  parts.push(labels.level(layoutNode.depth + 1));

  if (layoutNode.taskSummary) {
    parts.push(labels.taskProgress(layoutNode.taskSummary.done, layoutNode.taskSummary.total));
  } else if (topic.task) {
    parts.push(topic.task.status === "done" ? labels.taskDone : labels.taskTodo);
  }

  if (topic.children.length > 0) {
    parts.push(
      topic.collapsed
        ? labels.collapsedChildren(layoutNode.hiddenCount || topic.children.length)
        : labels.childCount(topic.children.length),
    );
  }

  if (topic.note?.text) parts.push(labels.hasNote);
  if (topic.href?.target) parts.push(labels.hasLink);

  return parts.join(", ");
}

/**
 * Builds live-region text announcing selection changes during keyboard/pointer navigation.
 */
export function buildSelectionAnnouncement(
  selectedTopicIds: string[],
  topicMap: ReadonlyMap<string, MindmapTopic>,
  layout: MindmapLayoutResult,
  labels: TopicA11yLabels,
): string {
  if (selectedTopicIds.length === 0) return "";
  if (selectedTopicIds.length > 1) return labels.multiSelected(selectedTopicIds.length);
  const id = selectedTopicIds[0];
  const topic = topicMap.get(id);
  const node = layout.nodes.get(id);
  if (!topic || !node) return "";
  return buildTopicAriaLabel(topic, node, labels);
}
