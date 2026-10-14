"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import styles from "../marketing.module.css";

export type FaqItem = {
  question: string;
  answer: string;
};

export function MarketingFaq({ items }: { items: readonly FaqItem[] }) {
  const [open, setOpen] = useState(0);
  const id = useId();

  return (
    <div className={styles.faqList}>
      {items.map((item, index) => {
        const active = open === index;
        const panelId = `${id}-${index}`;
        return (
          <div className={styles.faqItem} key={item.question}>
            <button
              type="button"
              aria-expanded={active}
              aria-controls={panelId}
              onClick={() => setOpen(active ? -1 : index)}
            >
              <span>{item.question}</span>
              <Plus aria-hidden className={active ? styles.faqClose : ""} />
            </button>
            <div
              id={panelId}
              aria-hidden={!active}
              inert={!active}
              className={active ? styles.faqAnswerOpen : styles.faqAnswer}
            >
              <div>
                <p>{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
