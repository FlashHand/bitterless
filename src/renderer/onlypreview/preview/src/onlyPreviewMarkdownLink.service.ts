export const findOnlyPreviewMarkdownLink = (
  root: HTMLElement | null,
  target: EventTarget | null,
  links: readonly string[]
): string | null => {
  const elementType = root?.ownerDocument.defaultView?.Element;
  if (!root || !elementType || !(target instanceof elementType)) return null;
  const link = target.closest('[data-onlypreview-link]');
  if (!link || !root.contains(link)) return null;
  const index = link.getAttribute('data-onlypreview-link') ?? '';
  if (!/^(0|[1-9]\d*)$/.test(index)) return null;
  return links[Number(index)] ?? null;
};

export const scrollOnlyPreviewMarkdownAnchor = (
  root: HTMLElement | null,
  fragment: string,
  encoded = true
): boolean => {
  if (!root) return false;
  let anchor: string;
  try {
    anchor = encoded ? decodeURIComponent(fragment.replace(/^#/, '')) : fragment;
  } catch {
    return false;
  }
  if (!anchor) {
    root.parentElement?.scrollTo({ top: 0 });
    return true;
  }
  for (const heading of root.querySelectorAll<HTMLElement>('[data-onlypreview-anchor]')) {
    if (heading.getAttribute('data-onlypreview-anchor') !== anchor) continue;
    heading.scrollIntoView({ block: 'start' });
    return true;
  }
  return false;
};
