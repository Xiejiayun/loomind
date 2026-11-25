import type { OutlineNode } from "./outline.js";

export function OutlineTree({ outline }: { outline: OutlineNode }) {
  return <div className="lm-outline-tree"><strong>{outline.title}</strong><NodeList nodes={outline.children}/></div>;
}

function NodeList({ nodes }: { nodes: OutlineNode[] }) {
  if (!nodes.length) return null;
  return <ul>{nodes.map((node, index) => <li key={`${node.title}-${index}`}><span>{node.title}</span><NodeList nodes={node.children}/></li>)}</ul>;
}
