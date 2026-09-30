import type { StoredResearchArticle } from "../storage/database.js";

export type TagOpportunity = {
  tag: string;
  articleCount: number;
  averageEngagement: number;
  averageAgeHours: number;
  signalScore: number;
};

type TagAccumulator = {
  articleCount: number;
  engagementTotal: number;
  ageHoursTotal: number;
};

export function rankTagOpportunities(
  articles: StoredResearchArticle[],
  now = new Date(),
): TagOpportunity[] {
  const byTag = new Map<string, TagAccumulator>();

  for (const article of articles) {
    const ageHours = Math.max(
      0,
      (now.getTime() - new Date(article.publishedTimestamp).getTime()) / 3_600_000,
    );

    // Comments are weighted more heavily because they usually represent a
    // deeper interaction than a reaction. This is a heuristic, not a Forem
    // success metric or probability.
    const engagement = article.publicReactionsCount + article.commentsCount * 2;

    for (const rawTag of article.tags) {
      const tag = rawTag.trim().toLowerCase();
      if (!tag) continue;

      const current = byTag.get(tag) ?? {
        articleCount: 0,
        engagementTotal: 0,
        ageHoursTotal: 0,
      };

      current.articleCount += 1;
      current.engagementTotal += engagement;
      current.ageHoursTotal += ageHours;
      byTag.set(tag, current);
    }
  }

  const raw = [...byTag.entries()].map(([tag, value]) => ({
    tag,
    articleCount: value.articleCount,
    averageEngagement: value.engagementTotal / value.articleCount,
    averageAgeHours: value.ageHoursTotal / value.articleCount,
  }));

  const frequencyValues = raw.map((item) => Math.log1p(item.articleCount));
  const engagementValues = raw.map((item) => Math.log1p(item.averageEngagement));
  const freshnessValues = raw.map(
    (item) => 1 / (1 + item.averageAgeHours / 24),
  );

  return raw
    .map((item, index) => {
      const frequency = normalize(frequencyValues[index], frequencyValues);
      const engagement = normalize(engagementValues[index], engagementValues);
      const freshness = normalize(freshnessValues[index], freshnessValues);

      return {
        ...item,
        signalScore: round(
          frequency * 0.45 + engagement * 0.35 + freshness * 0.2,
          3,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.signalScore - a.signalScore ||
        b.articleCount - a.articleCount ||
        a.tag.localeCompare(b.tag),
    );
}

function normalize(value: number, values: number[]): number {
  if (values.length === 0) return 0;

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) return max > 0 ? 1 : 0;
  return (value - min) / (max - min);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
