export const SOURCE_TEXT_LIMIT = 16_000;
export const SOURCE_PASSAGE_LIMIT = 80;

export interface WebpageSource {
  title: string;
  url: string;
  paragraphs: string[];
  truncated: boolean;
}
