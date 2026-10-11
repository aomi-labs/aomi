"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AomiLogo } from "../../components/aomi-logo";
import { navGroups } from "../site";
import styles from "../marketing.module.css";

export function MarketingNav() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const rootRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  return (
    <header ref={rootRef} className={styles.navDock}>
      <nav className={styles.navPill} aria-label="Primary">
        <Link to="/" reloadDocument className={styles.navBrand} aria-label="Aomi home">
          <AomiLogo
            className={styles.navLogo}
            markClassName={styles.navLogoMark}
            wordmarkClassName={styles.navLogoWord}
          />
        </Link>

        <div className={styles.navDesktop}>
          {navGroups.map((group) => {
            const open = openMenu === group.label;
            return (
              <div className={styles.navGroup} key={group.label}>
                <button
                  type="button"
                  className={styles.navTrigger}
                  aria-expanded={open}
                  onClick={() => setOpenMenu(open ? null : group.label)}
                >
                  {group.label}
                </button>
                {open ? (
                  <div className={styles.navPopover}>
                    <div className={styles.navPopoverGrid}>
                      {group.items.map((item) => (
                        <a
                          key={item.title}
                          href={item.href}
                          className={styles.navPopoverItem}
                          target={
                            "external" in item && item.external
                              ? "_blank"
                              : undefined
                          }
                          rel={
                            "external" in item && item.external
                              ? "noreferrer"
                              : undefined
                          }
                        >
                          <span>{item.title}</span>
                          <small>{item.description}</small>
                          {"external" in item && item.external ? (
                            <ArrowUpRight aria-hidden />
                          ) : null}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className={styles.navActions}>
          <a href="https://build.aomi.dev" className={styles.navConsole}>
            Console
          </a>
          <a href="https://chat.aomi.dev" className={styles.navApp}>
            App <span aria-hidden>→</span>
          </a>
        </div>

        <button
          type="button"
          className={styles.navMobileToggle}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X aria-hidden /> : <Menu aria-hidden />}
        </button>
      </nav>

      {mobileOpen ? (
        <div className={styles.navMobilePanel}>
          <div className={styles.navMobileScroll}>
            {navGroups.map((group) => (
              <section key={group.label} className={styles.navMobileGroup}>
                <p>{group.label}</p>
                {group.items.map((item) => (
                  <a
                    key={item.title}
                    href={item.href}
                    target={
                      "external" in item && item.external ? "_blank" : undefined
                    }
                    rel={
                      "external" in item && item.external
                        ? "noreferrer"
                        : undefined
                    }
                  >
                    <span>{item.title}</span>
                    <small>{item.description}</small>
                  </a>
                ))}
              </section>
            ))}
            <div className={styles.navMobileActions}>
              <a href="https://build.aomi.dev">Console</a>
              <a href="https://chat.aomi.dev">Open app →</a>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
