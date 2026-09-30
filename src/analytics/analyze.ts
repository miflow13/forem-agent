import type { ForemArticle } from "../forem/types.js";
import type { StoredResearchArticle } from "../storage/database.js";

export type BaselineComparison = {
  cohortSize: number;
  medianEngagementPerDay: number;
  targetEngagementPerDay: number;
  residualPerDay: number;
};

export type ArticleAnalysis = {
  article: {
    id: number;
    title: string;
    url: string;
    author: string;
    ageHours: number;
    reactions: number;
    comments: number;
    engagement: number;
    engagementPerDay: number;
    tags: string[];
  };
  community: BaselineComparison | null;
  owner: BaselineComparison | null;
  relatedArticles: Array<{
    id: number;
    title: string;
    url: string;
    sharedTags: string[];
  }>;
  limitations: string[];
};

export function analyzeArticle(
  target: ForemArticle,
  communityArticles: StoredResearchArticle[],
  ownerArticles: StoredResearchArticle[] | null,
  now = new Date(),
): ArticleAnalysis {
  const targetStored = fromForemArticle(target);
  const targetRate = engagementPerDay(targetStored, now);
  const communityCohort = communityArticles.filter(
    (article) =>
      article.id !== target.id &&
      sharedTags(article.tags, target.tag_list).length > 0,
  );

  const ownerCohort = ownerArticles?.filter(
    (article) => article.id !== target.id,
  ) ?? null;

  const relatedArticles = communityCohort
    .map((article) => ({
      id: article.id,
      title: article.title,
      url: article.url,
      sharedTags: sharedTags(article.tags, target.tag_list),
      engagement: engagement(article),
    }))
    .sort(
      (a, b) =>
        b.sharedTags.length - a.sharedTags.length ||
        b.engagement - a.engagement,
    )
    .slice(0, 5)
    .map(({ engagement: _engagement, ...article }) => article);

  const limitations = [
    "Engagement is a transparent heuristic: reactions + (comments × 2).",
    "Per-day normalization uses a one-day floor so very new posts are not extrapolated into artificial rates.",
    "Community comparison uses the latest locally stored research sample sharing at least one tag; it is not a complete DEV/Forem population.",
    "This analysis does not infer page views, follower conversion, referrers, revenue, or success probability.",
  ];

  if (communityCohort.length === 0) {
    limitations.push(
      "No matching community cohort exists in the latest local research sample.",
    );
  }

  if (ownerCohort === null) {
    limitations.push(
      "Owner baseline is unavailable because the article is not identified as the authenticated author's post or authenticated history is unavailable.",
    );
  } else if (ownerCohort.length === 0) {
    limitations.push(
      "Owner baseline needs at least one other published article.",
    );
  }

  return {
    article: {
      id: target.id,
      title: target.title,
      url: target.url,
      author: target.user.username,
      ageHours: round(ageHours(target.published_timestamp, now), 1),
      reactions: target.public_reactions_count,
      comments: target.comments_count,
      engagement: engagement(targetStored),
      engagementPerDay: round(targetRate, 2),
      tags: target.tag_list,
    },
    community: compareToBaseline(targetRate, communityCohort, now),
    owner:
      ownerCohort === null
        ? null
        : compareToBaseline(targetRate, ownerCohort, now),
    relatedArticles,
    limitations,
  };
}

export function fromForemArticle(article: ForemArticle): StoredResearchArticle {
  return {
    id: article.id,
    title: article.title,
    url: article.url,
    username: article.user.username,
    publishedTimestamp: article.published_timestamp,
    commentsCount: article.comments_count,
    publicReactionsCount: article.public_reactions_count,
    positiveReactionsCount: article.positive_reactions_count,
    readingTimeMinutes: article.reading_time_minutes,
    tags: article.tag_list,
  };
}

function compareToBaseline(
  targetRate: number,
  cohort: StoredResearchArticle[],
  now: Date,
): BaselineComparison | null {
  if (cohort.length === 0) return null;

  const rates = cohort
    .map((article) => engagementPerDay(article, now))
    .sort((a, b) => a - b);

  const medianRate = median(rates);

  return {
    cohortSize: cohort.length,
    medianEngagementPerDay: round(medianRate, 2),
    targetEngagementPerDay: round(targetRate, 2),
    residualPerDay: round(targetRate - medianRate, 2),
  };
}

function engagement(article: StoredResearchArticle): number {
  return article.publicReactionsCount + article.commentsCount * 2;
}

function engagementPerDay(
  article: StoredResearchArticle,
  now: Date,
): number {
  const days = Math.max(
    1,
    ageHours(article.publishedTimestamp, now) / 24,
  );
  return engagement(article) / days;
}

function ageHours(publishedTimestamp: string, now: Date): number {
  return Math.max(
    0,
    (now.getTime() - new Date(publishedTimestamp).getTime()) / 3_600_000,
  );
}

function sharedTags(left: string[], right: string[]): string[] {
  const rightSet = new Set(right.map((tag) => tag.toLowerCase()));
  return left
    .map((tag) => tag.toLowerCase())
    .filter((tag) => rightSet.has(tag));
}

function median(values: number[]): number {
  const midpoint = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[midpoint - 1] + values[midpoint]) / 2;
  }
  return values[midpoint];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
