import katex from "katex";
import "katex/dist/katex.min.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Meta } from "../api/types";
import { ASPL, DegreeHistogram, PathLengthChart } from "../components/AboutCharts";
import { ThemeToggle } from "../theme";

/** Density of a simple undirected graph: D = |E| / C(|V|, 2). */
const DENSITY_TEX = "D = \\frac{|E|}{\\binom{|V|}{2}}";

/**
 * Structural facts about the co-authorship network. Headline counts (researchers,
 * links, papers, dump date) come live from /api/meta so they track the deployed
 * dump; the derived metrics are measured once per dump by an offline pass over
 * the CSR graph — exact for density/degree, sampled BFS for the average path
 * length and its distribution, iterated double-sweep BFS for the diameter [10] —
 * and are pinned to the dump named in MEASURED_ON. The chart data lives in
 * components/AboutCharts.
 */
const MEASURED_ON = "2026-06-10";
export const MEASURED = {
  papers: 8_507_611,
  giantComponent: 3_785_679,
  giantPct: 92.0,
  diameter: 21, // longest shortest path, giant component (iterated double-sweep lower bound)
};

// Most co-authors of any single (non-disambiguation) researcher. The graph's
// raw maximum degree (7,811) belongs to dblp disambiguation profiles such as
// "Yang Liu" that pool many people, so the figure shown is the top genuine
// researcher.
const TOP_RESEARCHER = {
  name: "Dusit Niyato",
  coauthors: 2891,
  dblp: "https://dblp.org/pid/76/440.html",
};

const FOOTNOTE_1 =
  "dblp also indexes books, theses, editorships and informal preprints, so “paper” here means any dblp publication record that links the researchers credited on it.";

const fmt = (n: number) => n.toLocaleString();

function Cite({ n }: { n: number }) {
  return (
    <a className="cite" href={`#ref-${n}`}>
      [{n}]
    </a>
  );
}

/** A DOI rendered as a doi.org link, for the reference list. */
function Doi({ id }: { id: string }) {
  return (
    <>
      {" "}
      <a className="doi" href={`https://doi.org/${id}`} target="_blank" rel="noopener noreferrer">
        doi:{id}
      </a>
    </>
  );
}

/** Inline KaTeX-rendered math. */
function TeX({ tex }: { tex: string }) {
  return (
    <span
      className="tex"
      dangerouslySetInnerHTML={{ __html: katex.renderToString(tex, { throwOnError: false }) }}
    />
  );
}

function StatCard({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function About() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [showDiameter, setShowDiameter] = useState(false);

  useEffect(() => {
    api.meta().then(setMeta, () => {});
  }, []);

  const nodes = meta?.graph.nodes ?? 4_114_323;
  const edges = meta?.graph.undirected_edges ?? 28_816_878;
  const built = meta?.built ?? MEASURED_ON;
  const avgDeg = (2 * edges) / nodes;
  // density of a simple undirected graph, as a plain decimal (≈ 0.0000034)
  const density = edges / ((nodes * (nodes - 1)) / 2);
  const densityStr = density.toFixed(7);

  return (
    <div className="about">
      <header className="about-header">
        <div className="brand-block">
          <Link to="/" className="brand-logo-link" title="Back to the explorer">
            <img className="brand-logo" src="/logo.png" alt="" />
          </Link>
          <div className="brand-col">
            <Link to="/" className="brand" title="Back to the explorer">
              Degrees of Separation in CS
            </Link>
            <div className="byline">
              by{" "}
              <a href="https://gavjmooney.com" target="_blank" rel="noopener noreferrer">
                Gavin J. Mooney
              </a>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <ThemeToggle />
          <Link to="/" className="nav-link">
            ← Explorer
          </Link>
        </div>
      </header>

      <main className="about-body">
        <h1 className="about-title">Degrees of Separation in Computing Science</h1>
        <p className="about-byline">
          by{" "}
          <a href="https://gavjmooney.com" target="_blank" rel="noopener noreferrer">
            Gavin J. Mooney
          </a>{" "}
          · dblp dump of {built}
        </p>

        <p className="about-lede">
          This site presents the co-authorship network of{" "}
          <a href="https://dblp.org" target="_blank" rel="noopener noreferrer">
            dblp
          </a>{" "}
          <Cite n={1} />: every node is a researcher, and two researchers are joined whenever they
          have co-authored a paper
          <span className="fn" tabIndex={0}>
            <a className="fn-ref" href="#fn-1" id="fnref-1" aria-describedby="fn-1">
              *
            </a>
            <span className="fn-pop" role="tooltip">
              {FOOTNOTE_1}
            </span>
          </span>
          . It exists to visualise the path between any two researchers in that network — pick two
          people and it finds the shortest chain of shared work connecting them.
        </p>

        <section>
          <p>
            The idea is an old one. An{" "}
            <a href="https://oakland.edu/enp/" target="_blank" rel="noopener noreferrer">
              Erdős number
            </a>{" "}
            <Cite n={2} /> counts a researcher's co-authorship distance to Paul Erdős; the{" "}
            <a href="https://oracleofbacon.org/" target="_blank" rel="noopener noreferrer">
              Bacon number
            </a>{" "}
            <Cite n={3} /> plays the same game with film actors and shared movies; and both are
            everyday versions of <em>six degrees of separation</em> — Milgram's finding that short
            chains link almost any two people in a large social network <Cite n={4} />. These are
            all <em>small-world</em> networks <Cite n={5} />: huge and sparse, yet criss-crossed by
            short paths. Scientific co-authorship graphs are a textbook example <Cite n={6} />.
          </p>
          <p>
            Those projects fix one endpoint — your distance to Erdős, or to Bacon. This one measures
            the distance between <em>any</em> two researchers. And because the network is
            small-world, nearly every pair turns out to be only a handful of hops apart, which
            makes the opposite question the more sporting one:{" "}
            <strong>how far apart can you push two connected researchers?</strong> The longest
            shortest path that exists — the network's <em>diameter</em> <Cite n={10} /> — is only
            about{" "}
            {showDiameter ? (
              <strong>{MEASURED.diameter}</strong>
            ) : (
              <button
                className="spoiler"
                onClick={() => setShowDiameter(true)}
                title="Reveal the diameter"
              >
                spoiler — click to reveal
              </button>
            )}
            . See if you can find a pair that distant.
          </p>
          <p>
            This site has a longer backstory. The idea began as my undergraduate computing-science
            honours project, supervised by{" "}
            <a href="https://research.monash.edu/en/persons/helen-purchase/" target="_blank" rel="noopener noreferrer">
              Helen C. Purchase
            </a>
            . In the final year of my PhD I asked Claude Fable to rebuild it from the ground up;
            this site is the result, which I then shaped through extensive refinement and many
            choices of taste and style.
          </p>
        </section>

        <section>
          <h2>The data</h2>
          <p>
            dblp is the computer-science bibliography maintained at Schloss Dagstuhl and released
            under a{" "}
            <a
              href="https://creativecommons.org/publicdomain/zero/1.0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC0 1.0
            </a>{" "}
            public-domain dedication. An offline pipeline parses its XML, resolves people across
            their homepage records, aliases and homonym suffixes, and compiles a co-authorship graph
            that a small server queries with a bidirectional breadth-first search.
          </p>
          <p>A few deliberate choices shape what the graph contains:</p>
          <ul className="about-list">
            <li>
              <strong>Papers with more than 50 co-authors create no edges</strong> — such massively
              co-authored works would otherwise forge huge artificial cliques. They still appear in
              publication lists.
            </li>
            <li>
              <strong>arXiv / CoRR preprints are included</strong>, since they reflect real
              collaborations.
            </li>
            <li>
              <strong>dblp disambiguation profiles are kept and badged.</strong> Bare names like
              “Wei Wang” that pool work from many people stay in the graph, and any path forced
              through one is flagged.
            </li>
          </ul>
        </section>

        <section>
          <h2>The network at a glance</h2>
          <div className="stat-grid">
            <StatCard value={fmt(nodes)} label="researchers" sub="nodes" />
            <StatCard value={fmt(edges)} label="co-author links" sub="edges" />
            <StatCard value={fmt(MEASURED.papers)} label="papers" sub="dblp records" />
            <StatCard value={avgDeg.toFixed(1)} label="mean co-authors per researcher" sub="average degree" />
            <StatCard value={`${ASPL}`} label="degrees of separation" sub="mean path length" />
            <StatCard
              value={`${MEASURED.giantPct}%`}
              label="largest connected component"
              sub={`${fmt(MEASURED.giantComponent)} linked`}
            />
            <StatCard value={densityStr} label="density" sub={<TeX tex={DENSITY_TEX} />} />
            <StatCard
              value={fmt(TOP_RESEARCHER.coauthors)}
              label="researcher with most co-authors"
              sub={
                <a href={TOP_RESEARCHER.dblp} target="_blank" rel="noopener noreferrer">
                  {TOP_RESEARCHER.name} ↗
                </a>
              }
            />
          </div>
          <p>
            The graph is extraordinarily sparse: its density — the fraction of all possible pairs of
            researchers that are actually linked, <TeX tex={DENSITY_TEX} /> — is just {densityStr}.
            Yet {MEASURED.giantPct}% of researchers fall into a single connected component of{" "}
            {fmt(MEASURED.giantComponent)} researchers, and within it the typical separation is only
            about <strong>{ASPL}</strong> co-authorship hops.
          </p>
          <PathLengthChart />
          <p>
            That short average is held together by a few heavily-connected hubs — the most-connected
            individual researcher,{" "}
            <a href={TOP_RESEARCHER.dblp} target="_blank" rel="noopener noreferrer">
              {TOP_RESEARCHER.name}
            </a>
            , has {fmt(TOP_RESEARCHER.coauthors)} distinct co-authors. The degree distribution is
            steeply heavy-tailed, the hallmark of a real-world collaboration network <Cite n={6} />.
          </p>
          <DegreeHistogram />
          <p>
            The landing-page map renders the whole graph: it is laid out with a force-directed
            algorithm <Cite n={7} />, <Cite n={8} /> and partitioned by Leiden community detection{" "}
            <Cite n={9} />, so related fields settle into recognisable “continents”.
          </p>
          <p>
            For more information, we suggest the following:{" "}
            <a href="https://dblp.org/statistics/" target="_blank" rel="noopener noreferrer">
              dblp's own statistics pages
            </a>{" "}
            and Wikipedia's overview of the{" "}
            <a
              href="https://en.wikipedia.org/wiki/Collaboration_graph"
              target="_blank"
              rel="noopener noreferrer"
            >
              collaboration graph
            </a>{" "}
            (which also covers Erdős and Bacon numbers). For the underlying theory, see comprehensive
            references on graph theory <Cite n={11} /> and graph drawing <Cite n={12} />.
          </p>
        </section>

        <section className="footnotes">
          <p id="fn-1" className="footnote">
            <a href="#fnref-1">*</a> {FOOTNOTE_1}
          </p>
        </section>

        <section>
          <h2>References</h2>
          <ol className="references">
            <li id="ref-1">
              M. Ley, “The DBLP computer science bibliography: Evolution, research issues,
              perspectives,” in <em>Proc. 9th Int. Symp. String Processing and Information Retrieval
              (SPIRE)</em>, 2002, pp. 1–10.<Doi id="10.1007/3-540-45735-6_1" />
            </li>
            <li id="ref-2">
              J. Grossman, “The Erdős Number Project,” Oakland University. [Online]. Available:{" "}
              <a href="https://oakland.edu/enp/" target="_blank" rel="noopener noreferrer">
                https://oakland.edu/enp/
              </a>
            </li>
            <li id="ref-3">
              P. Reynolds, “The Oracle of Bacon.” [Online]. Available:{" "}
              <a href="https://oracleofbacon.org/" target="_blank" rel="noopener noreferrer">
                https://oracleofbacon.org/
              </a>
            </li>
            <li id="ref-4">
              J. Travers and S. Milgram, “An experimental study of the small world problem,”{" "}
              <em>Sociometry</em>, vol. 32, no. 4, pp. 425–443, 1969.<Doi id="10.2307/2786545" />
            </li>
            <li id="ref-5">
              D. J. Watts and S. H. Strogatz, “Collective dynamics of ‘small-world’ networks,”{" "}
              <em>Nature</em>, vol. 393, no. 6684, pp. 440–442, 1998.<Doi id="10.1038/30918" />
            </li>
            <li id="ref-6">
              M. E. J. Newman, “The structure of scientific collaboration networks,”{" "}
              <em>Proc. Natl. Acad. Sci. USA</em>, vol. 98, no. 2, pp. 404–409, 2001.
              <Doi id="10.1073/pnas.98.2.404" />
            </li>
            <li id="ref-7">
              T. M. J. Fruchterman and E. M. Reingold, “Graph drawing by force-directed placement,”{" "}
              <em>Softw.: Pract. Exper.</em>, vol. 21, no. 11, pp. 1129–1164, 1991.
              <Doi id="10.1002/spe.4380211102" />
            </li>
            <li id="ref-8">
              S. Martin, W. M. Brown, R. Klavans, and K. W. Boyack, “OpenOrd: An open-source toolbox
              for large graph layout,” in <em>Proc. SPIE Visualization and Data Analysis</em>, vol.
              7868, 2011, Art. no. 786806.<Doi id="10.1117/12.871402" />
            </li>
            <li id="ref-9">
              V. A. Traag, L. Waltman, and N. J. van Eck, “From Louvain to Leiden: Guaranteeing
              well-connected communities,” <em>Scientific Reports</em>, vol. 9, Art. no. 5233, 2019.
              <Doi id="10.1038/s41598-019-41695-z" />
            </li>
            <li id="ref-10">
              C. Magnien, M. Latapy, and M. Habib, “Fast computation of empirically tight bounds for
              the diameter of massive graphs,” <em>ACM J. Experimental Algorithmics</em>, vol. 13,
              Art. no. 1.10, 2009.<Doi id="10.1145/1412228.1455266" />
            </li>
            <li id="ref-11">
              R. Diestel, <em>Graph Theory</em>, 5th ed. Berlin, Germany: Springer, 2017.
              <Doi id="10.1007/978-3-662-53622-3" />
            </li>
            <li id="ref-12">
              R. Tamassia, Ed., <em>Handbook of Graph Drawing and Visualization</em>. Boca Raton, FL,
              USA: CRC Press, 2013.<Doi id="10.1201/b15385" />
            </li>
          </ol>
        </section>

        <Link to="/" className="about-cta">
          Explore the network →
        </Link>
      </main>
    </div>
  );
}
