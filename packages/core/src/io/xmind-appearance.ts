import type { MindmapThemeConfig, TopicShape, TopicThemeRole, TopicThemeStyle } from "../model/document.js";

export type XMindStyle = { properties?: Record<string, unknown> };
export type XMindTheme = Partial<Record<"map" | TopicThemeRole, XMindStyle>>;
const roles: TopicThemeRole[] = ["centralTopic", "mainTopic", "subTopic", "floatingTopic", "summaryTopic"];

function color(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return;
  const hex = (value.length < 6 ? value.slice(1).replace(/./g, "$&$&") : value.slice(1)).toUpperCase();
  return `#${hex.length === 6 ? hex + "FF" : hex}`;
}

function pixels(value: unknown, min: number, max: number): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(pt|px)?$/i.exec(String(typeof value === "string" || typeof value === "number" ? value : ""));
  if (!match) return;
  return Math.min(max, Math.max(min, Number(match[1]) * (match[2]?.toLowerCase() === "pt" ? 4 / 3 : 1)));
}

function fontStack(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256) return;
  const names = value.split(",").map((name) => name.trim().replace(/^(['"])(.*)\1$/, "$2"));
  if (!names.every((name) => /^[\p{L}\p{M}\p{N} _-]+$/u.test(name))) return;
  if (!names.some((name) => /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(name))) {
    if (/hand|script|cursive/i.test(names[0])) names.push("Comic Sans MS", "Chalkboard SE", "cursive");
    else if (/^(arvo|georgia|rockwell|times new roman|noto serif.*)$/i.test(names[0])) names.push("Georgia", "serif");
    else names.push("sans-serif");
  }
  const stack = [...new Set(names)].map((name) => /\s/.test(name) ? `"${name}"` : name).join(", ");
  return stack.length <= 256 ? stack : undefined;
}

const shapes = new Map<string, TopicShape>([["roundedRect", "rounded"], ["rect", "rounded"], ["underline", "underline"],
  ["ellipse", "pill"], ["pill", "pill"], ["diamond", "diamond"], ["hexagon", "hexagon"], ["cloud", "cloud"]]);
const lines = new Map<string, NonNullable<TopicThemeStyle["lineKind"]>>([["fold", "fold"], ["curve", "bezier"],
  ["bight", "bezier"], ["elbow", "elbow"], ["roundedElbow", "elbow"]]);

export function readTopicAppearance(source?: XMindStyle): TopicThemeStyle | undefined {
  const props = source?.properties;
  if (!props || typeof props !== "object") return;
  const fill = color(props["svg:fill"]);
  const pattern = props["fill-pattern"];
  const fillPattern = props["svg:fill"] === "none" ? "none" : pattern;
  const shapeId = props["shape-class"];
  const lineId = props["line-class"];
  const weight = props["fo:font-weight"];
  const numericWeight = weight === "bold" ? 700 : weight === "normal" ? 400 : Number(typeof weight === "string" || typeof weight === "number" ? weight : NaN);
  const style: TopicThemeStyle = {
    shape: typeof shapeId === "string" ? shapes.get(shapeId.replace(/^org\.xmind\.topicShape\./, "")) : undefined,
    cornerRadius: shapeId === "org.xmind.topicShape.rect" ? 0 : undefined,
    fillColor: fill,
    fillPattern: fillPattern === "none" || fillPattern === "solid" || fillPattern === "hachure" ? fillPattern : undefined,
    strokeColor: color(props["border-line-color"]) ?? (props["border-line-color"] === "inherited" ? fill : undefined),
    strokeWidth: pixels(props["border-line-width"], 0, 8), textColor: color(props["fo:color"]),
    fontSize: pixels(props["fo:font-size"], 10, 48), fontFamily: fontStack(props["fo:font-family"]),
    fontWeight: numericWeight > 0 && numericWeight <= 1000 ? (numericWeight >= 650 ? 700 : numericWeight >= 550 ? 600 : numericWeight >= 450 ? 500 : 400) : undefined,
    lineKind: typeof lineId === "string" ? lines.get(lineId.replace(/^org\.xmind\.branchConnection\./, "")) : undefined,
    lineWidth: pixels(props["line-width"], 0, 16), lineColor: color(props["line-color"]),
  };
  const defined = Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined));
  return Object.keys(defined).length ? defined : undefined;
}

export function readSheetAppearance(source?: XMindTheme, local?: XMindStyle): Partial<MindmapThemeConfig> | undefined {
  const map = { ...source?.map?.properties, ...local?.properties };
  const theme: Partial<MindmapThemeConfig> = {};
  const background = color(map["svg:fill"]);
  if (background) theme.canvasColor = background;
  const multi = map["multi-line-colors"];
  if (typeof multi === "string") {
    const colors = multi.trim().split(/\s+/).slice(0, 64).map(color);
    if (colors.every((item): item is string => !!item)) { theme.branchColors = colors; theme.rainbowBranches = true; }
    else if (multi === "none") theme.rainbowBranches = false;
  }
  for (const role of roles) {
    const style = readTopicAppearance(source?.[role]);
    if (style) (theme.topicStyles ??= {})[role] = style;
  }
  const central = theme.topicStyles?.centralTopic;
  if (central && map["line-tapered"] === "tapered" && (!central.lineKind || central.lineKind === "bezier")) central.lineKind = "tapered";
  if (central?.lineColor && multi === undefined) theme.rainbowBranches = false;
  const pattern = source?.centralTopic?.properties?.["line-pattern"];
  if (typeof pattern === "string" && pattern !== "inherited") theme.handdrawn = pattern.startsWith("handdrawn-");
  return Object.keys(theme).length ? theme : undefined;
}

export function writeTopicAppearance(style: TopicThemeStyle): XMindStyle | undefined {
  const shape = style.shape === "rounded" ? (style.cornerRadius === 0 ? "rect" : "roundedRect")
    : style.shape === "capsule" || style.shape === "pill" ? "ellipse" : style.shape;
  const line = style.lineKind === "bezier" || style.lineKind === "tapered" ? "curve" : style.lineKind;
  const fields = { "shape-class": shape && shape !== "auto" ? `org.xmind.topicShape.${shape}` : undefined,
    "line-class": line ? `org.xmind.branchConnection.${line}` : undefined, "line-width": style.lineWidth, "line-color": style.lineColor,
    "fo:font-family": style.fontFamily, "fo:font-size": style.fontSize === undefined ? undefined : `${style.fontSize}px`, "fo:font-weight": style.fontWeight, "fo:color": style.textColor,
    "svg:fill": style.fillColor, "fill-pattern": style.fillPattern, "border-line-width": style.strokeWidth, "border-line-color": style.strokeColor };
  const properties = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  return Object.keys(properties).length ? { properties } : undefined;
}

export function writeSheetAppearance(theme?: Partial<MindmapThemeConfig>): XMindTheme | undefined {
  if (!theme || !(theme.canvasColor || theme.branchColors || theme.topicStyles)) return;
  const central = theme.topicStyles?.centralTopic;
  const map = { ...(theme.canvasColor && { "svg:fill": theme.canvasColor }),
    ...(theme.rainbowBranches === false ? { "multi-line-colors": "none" } : theme.branchColors && { "multi-line-colors": theme.branchColors.join(" ") }),
    ...(central?.lineKind === "tapered" && { "line-tapered": "tapered" }) };
  const result: XMindTheme = { map: { properties: map } };
  for (const role of roles) {
    const style = theme.topicStyles?.[role];
    if (style) result[role] = writeTopicAppearance(style);
  }
  if (result.centralTopic?.properties && theme.handdrawn !== undefined) result.centralTopic.properties["line-pattern"] = theme.handdrawn ? "handdrawn-solid" : "solid";
  return result;
}
