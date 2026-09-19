import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getResearchPost,
  readResearchPost,
  researchPosts,
} from "@/lib/research";
import styles from "../../longform.module.css";
import { ExecutionHarnessesResearch } from "./execution-harnesses-research";
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
        <Link href="/research/aomibench-v0-1/data">aombench_v1_data</Link>
        {"\n"}
        {aomiBenchSourceTree.map((entry, index) => (
          <span key={entry.name}>
            {index === aomiBenchSourceTree.length - 1 ? "└── " : "├── "}
            <Link href={entry.href}>{entry.name}</Link>
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}

export function generateStaticParams() {
  return researchPosts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getResearchPost(slug);

  if (post === null) {
    return {
      title: "Not Found",
    };
  }

  return {
    title: `${post.title} | Aomi Labs Research`,
    description: post.subtitle,
    openGraph: {
      title: `${post.title} | Aomi Labs Research`,
      description: post.subtitle,
      type: "article",
      publishedTime: post.isoDate,
      url: `/research/${post.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: `${post.title} | Aomi Labs Research`,
      description: post.subtitle,
    },
  };
}

export default async function ResearchPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await readResearchPost(slug);

  if (post === null) {
    notFound();
  }

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

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.byline}>
          <Link href="/research">Research</Link>
          <i aria-hidden />
          <span>{post.tag}</span>
          <i aria-hidden />
          <time dateTime={post.isoDate}>{post.date}</time>
        </p>
        <h1>{post.title}</h1>
      </header>

      <div className={styles.body}>
        <article className={`${styles.prose} ${styles.proseWide}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {post.body}
          </ReactMarkdown>
        </article>
      </div>
    </main>
  );
}
