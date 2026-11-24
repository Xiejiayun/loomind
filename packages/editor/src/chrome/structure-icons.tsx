import React from "react";
import type { MindmapStructure } from "@mindmap/core";

interface StructureIconProps {
  structure: MindmapStructure;
  rootColor?: string;
  accentColor?: string;
  secondaryColor?: string;
  className?: string;
}

export const StructureIcon: React.FC<StructureIconProps> = ({
  structure,
  rootColor = "#0F172A",
  accentColor = "#3B82F6",
  secondaryColor = "#10B981",
  className = "h-7 w-11",
}) => {
  switch (structure) {
    case "mindmap":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <path d="M26 20 C19 20 19 11 12 11 M26 20 C19 20 19 29 12 29" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
          <path d="M38 20 C45 20 45 11 52 11 M38 20 C45 20 45 29 52 29" stroke={secondaryColor} strokeWidth="2" strokeLinecap="round" />
          <rect x="23" y="15" width="18" height="10" rx="5" fill={rootColor} />
          <rect x="4" y="8" width="10" height="6" rx="3" fill={accentColor} opacity="0.25" stroke={accentColor} strokeWidth="1.2" />
          <rect x="4" y="26" width="10" height="6" rx="3" fill={accentColor} opacity="0.25" stroke={accentColor} strokeWidth="1.2" />
          <rect x="50" y="8" width="10" height="6" rx="3" fill={secondaryColor} opacity="0.25" stroke={secondaryColor} strokeWidth="1.2" />
          <rect x="50" y="26" width="10" height="6" rx="3" fill={secondaryColor} opacity="0.25" stroke={secondaryColor} strokeWidth="1.2" />
        </svg>
      );
    case "logic":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <path d="M22 20 C31 20 31 9 40 9 M22 20 H40 M22 20 C31 20 31 31 40 31" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
          <rect x="6" y="15" width="16" height="10" rx="4" fill={rootColor} />
          <rect x="40" y="6" width="18" height="6" rx="3" fill={accentColor} opacity="0.22" stroke={accentColor} strokeWidth="1.2" />
          <rect x="40" y="17" width="18" height="6" rx="3" fill={secondaryColor} opacity="0.22" stroke={secondaryColor} strokeWidth="1.2" />
          <rect x="40" y="28" width="18" height="6" rx="3" fill={accentColor} opacity="0.22" stroke={accentColor} strokeWidth="1.2" />
        </svg>
      );
    case "org":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <path d="M32 14 V20 M14 20 H50 M14 20 V26 M32 20 V26 M50 20 V26" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" />
          <rect x="22" y="5" width="20" height="9" rx="3" fill={rootColor} />
          <rect x="7" y="26" width="14" height="8" rx="2.5" fill={accentColor} opacity="0.22" stroke={accentColor} strokeWidth="1.2" />
          <rect x="25" y="26" width="14" height="8" rx="2.5" fill={secondaryColor} opacity="0.22" stroke={secondaryColor} strokeWidth="1.2" />
          <rect x="43" y="26" width="14" height="8" rx="2.5" fill={accentColor} opacity="0.22" stroke={accentColor} strokeWidth="1.2" />
        </svg>
      );
    case "brace":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <path d="M31 7 C27 7 28 20 23 20 C28 20 27 33 31 33" stroke={accentColor} strokeWidth="2" strokeLinecap="round" />
          <rect x="5" y="15" width="16" height="10" rx="3" fill={rootColor} />
          <line x1="34" y1="9" x2="57" y2="9" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="34" y1="20" x2="53" y2="20" stroke={secondaryColor} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="34" y1="31" x2="57" y2="31" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "indented":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <path d="M14 13 V32 M14 22 H24 M14 32 H24" stroke={accentColor} strokeWidth="1.6" strokeLinecap="round" />
          <rect x="8" y="5" width="22" height="8" rx="3" fill={rootColor} />
          <rect x="24" y="18" width="26" height="7" rx="2.5" fill={accentColor} opacity="0.22" stroke={accentColor} strokeWidth="1.2" />
          <rect x="24" y="28" width="22" height="7" rx="2.5" fill={secondaryColor} opacity="0.22" stroke={secondaryColor} strokeWidth="1.2" />
        </svg>
      );
    case "timeline":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <line x1="6" y1="20" x2="58" y2="20" stroke={rootColor} strokeWidth="2.2" strokeLinecap="round" />
          <line x1="18" y1="20" x2="18" y2="12" stroke={accentColor} strokeWidth="1.8" />
          <line x1="34" y1="20" x2="34" y2="28" stroke={secondaryColor} strokeWidth="1.8" />
          <line x1="50" y1="20" x2="50" y2="12" stroke={accentColor} strokeWidth="1.8" />
          <circle cx="18" cy="20" r="2.6" fill={accentColor} />
          <circle cx="34" cy="20" r="2.6" fill={secondaryColor} />
          <circle cx="50" cy="20" r="2.6" fill={accentColor} />
          <rect x="10" y="5" width="16" height="7" rx="2.5" fill={accentColor} opacity="0.24" stroke={accentColor} strokeWidth="1.1" />
          <rect x="26" y="28" width="16" height="7" rx="2.5" fill={secondaryColor} opacity="0.24" stroke={secondaryColor} strokeWidth="1.1" />
          <rect x="42" y="5" width="16" height="7" rx="2.5" fill={accentColor} opacity="0.24" stroke={accentColor} strokeWidth="1.1" />
        </svg>
      );
    case "fishbone":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <path d="M5 13 L10 20 L5 27 M10 20 H44" stroke={rootColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M24 20 L17 8 M36 20 L29 8" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M24 20 L17 32 M36 20 L29 32" stroke={secondaryColor} strokeWidth="1.8" strokeLinecap="round" />
          <rect x="44" y="14" width="15" height="12" rx="6" fill={rootColor} />
        </svg>
      );
    case "treeTable":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <rect x="7" y="6" width="50" height="28" rx="3" stroke={accentColor} strokeWidth="1.5" fill="none" />
          <line x1="25" y1="6" x2="25" y2="34" stroke={accentColor} strokeWidth="1.3" />
          <line x1="25" y1="20" x2="57" y2="20" stroke={accentColor} strokeWidth="1.3" />
          <rect x="10" y="16" width="12" height="8" rx="2" fill={rootColor} />
          <rect x="29" y="10" width="24" height="6" rx="2" fill={accentColor} opacity="0.24" />
          <rect x="29" y="24" width="24" height="6" rx="2" fill={secondaryColor} opacity="0.24" />
        </svg>
      );
    case "matrix":
      return (
        <svg viewBox="0 0 64 40" className={className} fill="none">
          <rect x="22" y="3" width="20" height="6" rx="3" fill={rootColor} />
          <rect x="8" y="13" width="22" height="11" rx="2.5" fill={accentColor} opacity="0.14" stroke={accentColor} strokeWidth="1.2" />
          <rect x="34" y="13" width="22" height="11" rx="2.5" fill={secondaryColor} opacity="0.14" stroke={secondaryColor} strokeWidth="1.2" />
          <rect x="8" y="27" width="22" height="10" rx="2.5" fill={secondaryColor} opacity="0.14" stroke={secondaryColor} strokeWidth="1.2" />
          <rect x="34" y="27" width="22" height="10" rx="2.5" fill={accentColor} opacity="0.14" stroke={accentColor} strokeWidth="1.2" />
        </svg>
      );
  }
};
