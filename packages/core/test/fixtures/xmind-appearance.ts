export function nativeSheet(id: string, sketch: boolean) {
  const font = sketch ? "NeverMind Hand,全瀨體" : "Arvo";
  const role = (properties: Record<string, string>) => ({ properties });
  return {
    id, title: id,
    theme: {
      map: role({ "svg:fill": "#ffffff", "multi-line-colors": "#f9423a #f6a04d #486aff", "line-tapered": sketch ? "tapered" : "none" }),
      centralTopic: role({ "fo:font-family": font, "fo:font-size": sketch ? "28pt" : "36pt", "fo:font-weight": sketch ? "600" : "700",
        "svg:fill": "#000229", "fill-pattern": "none", "border-line-width": sketch ? "5" : "0pt", "border-line-color": "inherited",
        "shape-class": "org.xmind.topicShape.roundedRect", "line-class": `org.xmind.branchConnection.${sketch ? "curve" : "fold"}`,
        "line-width": sketch ? "3pt" : "5pt", "line-color": "#000229", "line-pattern": sketch ? "handdrawn-solid" : "solid" }),
      mainTopic: role({ "fo:font-family": font, "fo:font-size": "18pt", "fo:font-weight": sketch ? "500" : "700",
        "svg:fill": "inherited", "fill-pattern": sketch ? "hachure" : "none", "border-line-width": sketch ? "3" : "inherited",
        "shape-class": `org.xmind.topicShape.${sketch ? "roundedRect" : "underline"}`,
        "line-class": `org.xmind.branchConnection.${sketch ? "bight" : "fold"}`, "line-width": sketch ? "2pt" : "inherited" }),
      subTopic: role({ "fo:font-family": font, "fo:font-size": "14pt", "fo:font-weight": sketch ? "500" : "700",
        "fill-pattern": "none", "shape-class": "org.xmind.topicShape.underline", "border-line-width": sketch ? "2pt" : "inherited" }),
    },
    rootTopic: { id: `${id}-root`, title: "Project Overview", structureClass: "org.xmind.ui.map.clockwise",
      children: { attached: [3, 3, 5, 3, 3, 1, 1, 1, 2].map((count, index) => ({
        id: `${id}-${index}`, title: `Phase ${index + 1}`,
        children: { attached: Array.from({ length: count }, (_, child) => ({ id: `${id}-${index}-${child}`, title: `Step ${child + 1}` })) },
      })) } },
  };
}
