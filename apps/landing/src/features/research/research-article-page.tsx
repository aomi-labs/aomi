import type {LandingMetadata as Metadata} from "@/lib/metadata";
import {Link} from "@tanstack/react-router";

import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getResearchPost,
  postHref,
  type ResearchPost,
} from "@/lib/research";
import styles from "@/features/marketing/longform.module.css";
import { AgenticFuzzerResearchBody } from "./agentic-fuzzer-research";
import { ExecutionHarnessesResearch } from "./execution-harnesses-research";
import { TaskApiResearchBody } from "./task-api-research";
import { ThreeGatesResearch } from "./three-gates-research";

function textFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }

      if (isValidElement<{ children?: ReactNode }>(child)) {
        return textFromChildren(child.props.children);
      }

      return "";
    })
    .join("");
}

function isImageOnly(children: ReactNode) {
  const childArray = Children.toArray(children);
  const child = childArray[0];

  return (
    childArray.length === 1 &&
    isValidElement<{ src?: string; alt?: string }>(child) &&
    typeof child.props.src === "string"
  );
}

function imageSrc(src: unknown) {
  if (typeof src !== "string") {
    return "";
  }

  if (src.startsWith("figures/")) {
    return `/research/aomibench-v0.1/${src}`;
  }

  return src;
}

/* Only the components that add behavior survive: everything purely visual is
   styled by .prose in longform.module.css, so research articles inherit the
   marketing type scale, palette, and dark mode instead of restating them. */
const markdownComponents: Components = {
  p: ({ children }) => {
    if (isImageOnly(children)) {
      return <figure>{children}</figure>;
    }

    const text = textFromChildren(children).trim();

    if (/^(Figure|Table|Code)\s+\d+/.test(text)) {
      return <p className={styles.caption}>{children}</p>;
    }

    return <p>{children}</p>;
  },
  img: ({ src, alt }) => <img src={imageSrc(src)} alt={alt ?? ""} />,
  blockquote: ({ children }) => {
    const text = textFromChildren(children).trim();

    if (/^Figure\s+\d+/.test(text)) {
      return <figure className={styles.figureNote}>{children}</figure>;
    }

    return <blockquote>{children}</blockquote>;
  },
  table: ({ children }) => (
    <div className={styles.tableScroll}>
      <table>{children}</table>
    </div>
  ),
  // The hero already renders post.title as the page's single h1.
  h1: () => null,
};

const aomiBenchSourceTree = [
  { name: "figures", href: "/research/aomibench-v0-1/data/figures" },
  {
    name: "latest.json",
    href: "/research/aomibench-v0.1/aombench_v1_data/latest.json",
  },
  {
    name: "MANIFEST.md",
    href: "/research/aomibench-v0.1/aombench_v1_data/MANIFEST.md",
  },
  {
    name: "README.md",
    href: "/research/aomibench-v0.1/aombench_v1_data/README.md",
  },
  { name: "specs", href: "/research/aomibench-v0-1/data/specs" },
  { name: "summaries", href: "/research/aomibench-v0-1/data/summaries" },
];

function AomiBenchSourceData() {
  return (
    <section className={styles.fileTree}>
      <pre>
        <Link to="/research/aomibench-v0-1/data">aombench_v1_data</Link>
        {"\n"}
        {aomiBenchSourceTree.map((entry, index) => (
          <span key={entry.name}>
            {index === aomiBenchSourceTree.length - 1 ? "└── " : "├── "}
            <a href={entry.href}>{entry.name}</a>
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}



export function getPageMetadata(slug: string): Metadata {
  const post = getResearchPost(slug);

  if (post === null) {
    return {
      title: "Not Found",
    };
  }

  const title = `${post.title} | ${post.research ? "Aomi Labs Research" : "Aomi Blog"}`;

  return {
    title,
    description: post.subtitle,
    openGraph: {
      title,
      description: post.subtitle,
      type: "article",
      publishedTime: post.isoDate,
      url: postHref(post),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: post.subtitle,
    },
  };
}

export default function ResearchPostPage({post}: {post: ResearchPost & {body: string}}) {
  if (post.format === "execution-harnesses") {
    return <ExecutionHarnessesResearch post={post} />;
  }

  if (post.format === "three-gates") {
    return <ThreeGatesResearch post={post} />;
  }

  const components: Components =
    post.slug === "aomibench-v0-1"
      ? {
          ...markdownComponents,
          h1: () => <AomiBenchSourceData />,
        }
      : markdownComponents;

  const articleClassName = `${styles.prose} ${styles.proseWide} ${
    post.slug === "introducing-the-aomi-task-api"
      ? styles.borderlessFigures
      : ""
  }`;

  return (
    <main className={`${styles.page} ${styles.centered}`}>
      <header className={styles.hero}>
        <p className={styles.byline}>
          {post.research ? (
            <Link to="/research">Research</Link>
          ) : (
            <Link to="/blog">Blog</Link>
          )}
          <i aria-hidden />
          <span>{post.tag}</span>
          <i aria-hidden />
          <time dateTime={post.isoDate}>{post.date}</time>
        </p>
        <h1>{post.title}</h1>
      </header>

      <figure className={styles.cover}>
        <img
          src={post.cover}
          alt=""
          width={1600}
          height={900}
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      </figure>

      <div className={styles.body}>
        <article className={articleClassName}>
          {post.slug === "introducing-the-aomi-task-api" ? (
            <TaskApiResearchBody body={post.body} components={components} />
          ) : post.slug === "agentic-fuzzer" ? (
            <AgenticFuzzerResearchBody
              body={post.body}
              components={components}
            />
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {post.body}
            </ReactMarkdown>
          )}
        </article>
      </div>
    </main>
  );
}
