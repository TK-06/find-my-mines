import { useEffect } from 'react';
import {
  POLICIES,
  POLICY_ORDER,
  POLICY_UPDATED,
  inlineParts,
  type PolicyBlock,
  type PolicyId,
} from '../data/policies.js';
import { RouteLink, routeFromPath, type Route } from '../router.js';

/**
 * Privacy, security and terms: one screen, three documents.
 *
 * Plain static text, so it renders with no server, no database and no
 * sign-in. The contents list uses ordinary #anchor links; the router only
 * reads the pathname, so they scroll the page without changing the screen.
 */
export function PolicyScreen({
  policy,
  onNavigate,
}: {
  policy: PolicyId;
  onNavigate: (next: Route) => void;
}) {
  const doc = POLICIES[policy];

  // A deep link like /privacy#your-browser arrives before this page has
  // rendered, so the browser had nothing to scroll to. Do it now.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [policy]);

  return (
    <div className="policy-page">
      <header>
        <h2 className="policy-title">{doc.title}</h2>
        <p className="muted policy-updated">Last updated {POLICY_UPDATED}</p>
      </header>

      <nav className="policy-tabs" aria-label="Policies">
        {POLICY_ORDER.map((id) => (
          <RouteLink key={id} to={id} current={policy} onNavigate={onNavigate}>
            {POLICIES[id].tab}
          </RouteLink>
        ))}
      </nav>

      <div className="policy-layout">
        <nav className="policy-toc" aria-labelledby="policy-toc-title">
          <h3 id="policy-toc-title" className="policy-toc-title">
            On this page
          </h3>
          <ol>
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="policy-body">
          <p className="policy-intro">{doc.intro}</p>
          {doc.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="policy-section"
              aria-labelledby={`${section.id}-heading`}
            >
              {/* "-heading", not "-title": the contact dialog already uses contact-title. */}
              <h3 id={`${section.id}-heading`}>{section.title}</h3>
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} onNavigate={onNavigate} />
              ))}
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

function Block({ block, onNavigate }: { block: PolicyBlock; onNavigate: (next: Route) => void }) {
  if (typeof block === 'string') {
    return (
      <p>
        <Inline text={block} onNavigate={onNavigate} />
      </p>
    );
  }
  return (
    <ul>
      {block.map((item) => (
        <li key={item}>
          <Inline text={item} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

/** Text with `[label](href)` links: in-app paths use the router, the rest are plain links. */
function Inline({ text, onNavigate }: { text: string; onNavigate: (next: Route) => void }) {
  return (
    <>
      {inlineParts(text).map((part, index) => {
        if (!part.href) return part.text;
        if (part.href.startsWith('/')) {
          return (
            <RouteLink key={index} to={routeFromPath(part.href)} onNavigate={onNavigate}>
              {part.text}
            </RouteLink>
          );
        }
        const external = part.href.startsWith('http');
        return (
          <a
            key={index}
            href={part.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}
