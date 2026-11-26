import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getIntlLocale,
  getLocale,
  getPaletteLabel,
  getSkeletonInfo,
  getTemplateInfo,
  PALETTE_LIST,
  setLocale,
  SKELETON_LIST,
  subscribeLocale,
  TEMPLATES,
  toggleLocale,
} from "../src/index.js";

describe("@mindmap/core i18n", () => {
  afterEach(() => {
    setLocale("zh");
  });

  it("switches locales, toggles cleanly, and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeLocale(listener);

    expect(getLocale()).toBe("zh");
    expect(getIntlLocale()).toBe("zh-CN");

    expect(toggleLocale()).toBe("en");
    expect(getLocale()).toBe("en");
    expect(getIntlLocale()).toBe("en-US");
    expect(listener).toHaveBeenCalledTimes(1);

    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    setLocale("zh");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("provides Chinese and English metadata for all palettes, skeletons, and templates", () => {
    for (const pal of PALETTE_LIST) {
      const zh = getPaletteLabel(pal.id, "zh");
      const en = getPaletteLabel(pal.id, "en");
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(zh).not.toBe(en);
    }

    for (const sk of SKELETON_LIST) {
      const zh = getSkeletonInfo(sk.id, "zh");
      const en = getSkeletonInfo(sk.id, "en");
      expect(zh.name).not.toBe(en.name);
      expect(zh.description).not.toBe(en.description);
    }

    for (const tpl of TEMPLATES) {
      const zh = getTemplateInfo(tpl.id, "zh");
      const en = getTemplateInfo(tpl.id, "en");
      expect(zh.name).not.toBe(en.name);
      expect(zh.description).not.toBe(en.description);
    }
  });
});
