import { z } from "zod";

export const foremUserSchema = z.object({
  name: z.string().nullable().optional(),
  username: z.string(),
  twitter_username: z.string().nullable().optional(),
  github_username: z.string().nullable().optional(),
  user_id: z.number().int().optional(),
  website_url: z.string().nullable().optional(),
  profile_image: z.string().nullable().optional(),
  profile_image_90: z.string().nullable().optional(),
});

export const foremArticleSchema = z.object({
  type_of: z.string().optional(),
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullable().optional(),
  readable_publish_date: z.string().optional(),
  slug: z.string(),
  path: z.string().optional(),
  url: z.string().url(),
  comments_count: z.number().int().nonnegative().default(0),
  public_reactions_count: z.number().int().nonnegative().default(0),
  collection_id: z.number().int().nullable().optional(),
  published_timestamp: z.string(),
  positive_reactions_count: z.number().int().nonnegative().default(0),
  cover_image: z.string().nullable().optional(),
  social_image: z.string().nullable().optional(),
  canonical_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
  edited_at: z.string().nullable().optional(),
  crossposted_at: z.string().nullable().optional(),
  published_at: z.string().optional(),
  last_comment_at: z.string().optional(),
  reading_time_minutes: z.number().nonnegative().default(0),
  tag_list: z.array(z.string()).default([]),
  tags: z.string().optional(),
  user: foremUserSchema,
});

export const foremArticleListSchema = z.array(foremArticleSchema);

export type ForemArticle = z.infer<typeof foremArticleSchema>;
