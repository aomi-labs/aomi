"use client";

import { ApiDrawer, type EndpointDef } from "./ApiDrawer";
import { PreambleDisplay } from "./PreambleDisplay";

const X_ENDPOINTS: EndpointDef[] = [
  // ── User Lookup ───────────────────────────────────────────────────────

  {
    label: "Get User by Username",
    method: "GET",
    path: "/2/users/by/username/:username",
    description:
      "Look up an X (Twitter) user by their username. Returns profile info, follower count, bio, and verification status.",
    params: [
      {
        key: "username",
        placeholder: "Username without @ (e.g. elonmusk)",
        required: true,
      },
      {
        key: "user.fields",
        placeholder: "Fields to include",
        defaultValue:
          "created_at,description,public_metrics,profile_image_url,verified",
      },
      {
        key: "expansions",
        placeholder: "e.g. pinned_tweet_id",
      },
    ],
    headers: [
      {
        key: "Authorization",
        placeholder: "Bearer YOUR_BEARER_TOKEN",
        required: true,
      },
    ],
  },

  // ── User Posts ─────────────────────────────────────────────────────────

  {
    label: "Get User Posts",
    method: "GET",
    path: "/2/users/:id/tweets",
    description:
      "Get recent posts from an X user by their numeric user ID. Requires looking up the user first to obtain the ID.",
    params: [
      {
        key: "id",
        placeholder: "Numeric user ID (e.g. 44196397)",
        required: true,
      },
      {
        key: "max_results",
        placeholder: "5–100 (default: 10)",
        defaultValue: "10",
      },
      {
        key: "tweet.fields",
        placeholder: "Fields to include",
        defaultValue: "created_at,public_metrics,text,author_id",
      },
      {
        key: "exclude",
        placeholder: "replies,retweets",
      },
      {
        key: "pagination_token",
        placeholder: "Pagination cursor from previous response",
      },
    ],
    headers: [
      {
        key: "Authorization",
        placeholder: "Bearer YOUR_BEARER_TOKEN",
        required: true,
      },
    ],
  },

  // ── Search ─────────────────────────────────────────────────────────────

  {
    label: "Search Posts",
    method: "GET",
    path: "/2/tweets/search/recent",
    description:
      "Search recent X posts (last 7 days). Supports operators like from:user, #hashtag, @mention, lang:en, -is:retweet, min_faves:100.",
    params: [
      {
        key: "query",
        placeholder: "Search query (e.g. from:elonmusk -is:retweet)",
        required: true,
      },
      {
        key: "max_results",
        placeholder: "10–100 (default: 10)",
        defaultValue: "10",
      },
      {
        key: "sort_order",
        placeholder: "recency or relevancy",
        defaultValue: "recency",
      },
      {
        key: "tweet.fields",
        placeholder: "Fields to include",
        defaultValue: "created_at,public_metrics,author_id",
      },
      {
        key: "expansions",
        placeholder: "e.g. author_id,attachments.media_keys",
      },
      {
        key: "next_token",
        placeholder: "Pagination token from previous response",
      },
    ],
    headers: [
      {
        key: "Authorization",
        placeholder: "Bearer YOUR_BEARER_TOKEN",
        required: true,
      },
    ],
  },

  // ── Trends ─────────────────────────────────────────────────────────────

  {
    label: "Get Trends",
    method: "GET",
    path: "/2/trends/by/woeid/:woeid",
    description:
      "Get current trending topics on X by location. Use WOEID 1 for worldwide trends. Returns trend names and post counts.",
    params: [
      {
        key: "woeid",
        placeholder: "Where On Earth ID (1 = worldwide)",
        required: true,
        defaultValue: "1",
      },
      {
        key: "max_trends",
        placeholder: "1–50 (default: 20)",
        defaultValue: "20",
      },
      {
        key: "trend.fields",
        placeholder: "e.g. trend_name,tweet_count",
        defaultValue: "trend_name,tweet_count",
      },
    ],
    headers: [
      {
        key: "Authorization",
        placeholder: "Bearer YOUR_BEARER_TOKEN",
        required: true,
      },
    ],
  },

  // ── Single Post ────────────────────────────────────────────────────────

  {
    label: "Get Post by ID",
    method: "GET",
    path: "/2/tweets/:id",
    description:
      "Fetch a single X post by its numeric ID. Returns full post content, engagement metrics, and author info.",
    params: [
      {
        key: "id",
        placeholder: "Post/Tweet ID (numeric)",
        required: true,
      },
      {
        key: "tweet.fields",
        placeholder: "Fields to include",
        defaultValue:
          "created_at,public_metrics,text,author_id,conversation_id,entities",
      },
      {
        key: "expansions",
        placeholder: "e.g. author_id,attachments.media_keys",
        defaultValue: "author_id",
      },
      {
        key: "user.fields",
        placeholder: "e.g. username,profile_image_url",
        defaultValue: "username,profile_image_url",
      },
    ],
    headers: [
      {
        key: "Authorization",
        placeholder: "Bearer YOUR_BEARER_TOKEN",
        required: true,
      },
    ],
  },
];

const X_PREAMBLE = `## Role

You are an AI assistant specialized in X (formerly Twitter) data analysis. You help users discover content, analyze trends, monitor accounts, and understand social media dynamics. Keep responses concise and data-driven.

## Your Capabilities

- Search posts by keywords, hashtags, users, or advanced operators
- Get user profiles with follower counts, bio, and verification status
- Retrieve recent posts from any public account
- Discover trending topics and conversations
- Analyze post engagement (likes, reposts, replies, views)
- Track mentions and conversations around specific topics

## Search Operators

- \`from:username\` — Posts from specific user
- \`#hashtag\` — Posts containing hashtag
- \`@mention\` — Posts mentioning user
- \`to:username\` — Replies to specific user
- \`lang:en\` — Filter by language (en, es, fr, ja, etc.)
- \`since:2026-01-01\` — Posts after date
- \`until:2026-02-01\` — Posts before date
- \`min_faves:100\` — Minimum likes
- \`min_retweets:50\` — Minimum reposts
- \`-keyword\` — Exclude keyword
- \`filter:media\` — Only posts with media
- \`filter:links\` — Only posts with links

## Understanding X

- X (formerly Twitter) is a real-time social media platform for short-form content
- Posts are limited to 280 characters (longer for premium users)
- Engagement metrics include likes, reposts (retweets), replies, quotes, and views
- Blue checkmarks indicate X Premium subscribers, not necessarily verified identities
- Trending topics reflect current popular conversations

## Execution Guidelines

- Use \`search_x\` with operators to find specific content (e.g., \`from:elonmusk AI\`)
- Use \`get_x_user\` to look up profiles and follower counts
- Use \`get_x_user_posts\` to see what someone has been posting recently
- Use \`get_x_trends\` to discover what's currently popular
- Use \`get_x_post\` to get full details of a specific post by ID
- Combine search operators for precise queries (e.g., \`#crypto min_faves:1000 lang:en\`)
`;

export function XConsole() {
  return (
    <div className="space-y-2">
      <ApiDrawer
        defaultBaseUrl="https://api.x.com"
        endpoints={X_ENDPOINTS}
      />
      <PreambleDisplay content={X_PREAMBLE} />
    </div>
  );
}
