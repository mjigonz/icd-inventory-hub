import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  routePath?: string;
}

export function SEOHead({ title, description, routePath = '/' }: SEOProps) {
  useEffect(() => {
    const fullTitle = `${title} | Inventory Hub`;
    document.title = fullTitle;

    const setMeta = (nameOrProp: string, value: string, isProp = false) => {
      const selector = isProp ? `meta[property="${nameOrProp}"]` : `meta[name="${nameOrProp}"]`;
      let el = document.querySelector(selector) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        if (isProp) {
          el.setAttribute('property', nameOrProp);
        } else {
          el.setAttribute('name', nameOrProp);
        }
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    };

    setMeta('description', description);
    setMeta('og:title', fullTitle, true);
    setMeta('og:description', description, true);
    setMeta('og:type', 'website', true);
    setMeta('og:url', window.location.origin + routePath, true);
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', fullTitle);
    setMeta('twitter:description', description);
  }, [title, description, routePath]);

  return null;
}
