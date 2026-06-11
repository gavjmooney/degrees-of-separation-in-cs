import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { AuthorSummary } from "../api/types";

interface Props {
  label: string;
  accent: string;
  value: AuthorSummary | null;
  onSelect: (author: AuthorSummary | null) => void;
}

export function AuthorSearchBox({ label, accent, value, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AuthorSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const r = await api.search(query.trim(), ac.signal);
        setResults(r);
        setOpen(true);
        setActive(0);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) console.error(e);
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (a: AuthorSummary) => {
    onSelect(a);
    setQuery("");
    setOpen(false);
  };

  if (value) {
    return (
      <div className="search-box selected" style={{ borderColor: accent }}>
        <div className="selected-author">
          <span className="selected-name" style={{ color: accent }}>
            {value.name}
          </span>
          <span className="selected-meta">
            {value.pubCount.toLocaleString()} publications
            {value.firstYear && ` · ${value.firstYear}–${value.lastYear}`}
          </span>
        </div>
        <button className="clear" onClick={() => onSelect(null)} title="Clear">
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="search-box" ref={rootRef}>
      <input
        value={query}
        placeholder={label}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {loading && <span className="spinner" />}
      {open && results.length > 0 && (
        <ul className="dropdown">
          {results.map((r, i) => (
            <li
              key={r.id}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
            >
              <div className="result-name">
                {r.name}
                {r.isDisambig && <span className="badge">disambiguation</span>}
              </div>
              <div className="result-meta">
                {r.pubCount.toLocaleString()} publications
                {r.firstYear && ` · ${r.firstYear}–${r.lastYear}`}
                {r.topVenues.length > 0 && ` · ${r.topVenues.slice(0, 2).join(", ")}`}
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && results.length === 0 && !loading && (
        <ul className="dropdown">
          <li className="empty">No authors found</li>
        </ul>
      )}
    </div>
  );
}
