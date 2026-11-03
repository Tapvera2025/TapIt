const GUIDANCE: Record<string, { impact: string; action: string }> = {
  M: {
    impact:
      'Clear page titles and descriptions help people understand your page in search results.',
    action:
      'Open the affected page in your website editor. Give it a clear, unique title and a useful description that matches its content.',
  },
  H: {
    impact:
      'Pages that do not load, or take visitors through several redirects, can interrupt both visitors and search engines.',
    action:
      'Open the affected address. If the page should exist, restore it or fix its server response. If it moved, update links to its correct destination.',
  },
  I: {
    impact:
      'Search engines may be instructed not to include this page in results. That can be intentional for private or utility pages.',
    action:
      'Decide whether this page should appear in search. Ask your website developer to review its indexing settings before changing them.',
  },
  C: {
    impact:
      'Conflicting preferred-page instructions can make it harder for search engines to understand which address should appear in results.',
    action:
      'Choose the preferred public address for this content. Ask your developer to check canonical tags, headers, redirects, and any changes made by JavaScript.',
  },
  T: {
    impact:
      'Useful content and clear headings help visitors understand the page. Some short pages or repeated headings are intentional.',
    action:
      'Read the affected page as a visitor. Make its main purpose clear, improve headings where useful, and keep the content appropriate for that page.',
  },
  L: {
    impact:
      'Clear, working links help visitors and search engines move between relevant pages.',
    action:
      'Review the links shown in the evidence. Correct broken destinations and use link text that describes where the visitor will go.',
  },
  A: {
    impact:
      'Well-prepared images help people use your website and can reduce page loading time.',
    action:
      'Review the images on this page. Add useful descriptions for informative images, keep decorative descriptions empty, and reduce oversized files.',
  },
  S: {
    impact:
      'A sitemap is a list of pages you want search engines to discover. Its entries should agree with the website’s public pages.',
    action:
      'Review the affected URL and the website’s sitemap. Include the correct public address only when the page is intended for search results.',
  },
  D: {
    impact:
      'Structured data describes the page to search engines. Incorrect details can prevent useful search features, but markup is not needed on every page.',
    action:
      'Ask your developer to validate the structured data against the visible content. Fix incorrect markup and add only information that is accurate.',
  },
  G: {
    impact:
      'Language-page instructions help search engines choose the right version for each visitor.',
    action:
      'Ask your developer to check language and region codes, complete page addresses, and return links between the translated versions.',
  },
  P: {
    impact:
      'A slow or unstable page can make it harder for people to read, tap, and use your website.',
    action:
      'Open Speed & experience to see the measurement, its source, and its target. Share slow pages with your developer for investigation.',
  },
};
export function getSeoGuidance(ruleId: string) {
  const specific: Record<string, { impact: string; action: string }> = {
    M009: {
      impact:
        'A declared page language helps browsers and assistive tools interpret the content correctly.',
      action:
        'Ask your developer to set the HTML language attribute to the language used on this page, for example lang="en" for English.',
    },
    A005: {
      impact:
        'Delaying the main image until it approaches the screen can make the most visible content appear later.',
      action:
        'Ask your developer to check whether this is the main above-the-fold image. If it is, review its lazy-loading setting and how quickly it is requested.',
    },
    L005: {
      impact:
        'These internal links ask search engines not to pass a standard link signal. This may be intentional.',
      action:
        'Review each link’s purpose with your developer before removing nofollow. Keep the setting where the website needs it.',
    },
    L008: {
      impact:
        'A large number of links can make navigation noisy, but a useful directory may legitimately have many.',
      action:
        'Review the page as a visitor. Remove unnecessary repetitions while keeping links that help people reach the right pages.',
    },
    S005: {
      impact:
        'A sitemap date should describe a real page update. An older date alone does not mean the page is out of date.',
      action:
        'Compare the sitemap modification date with the page’s actual last meaningful change. Correct inaccurate dates without inventing a recent update.',
    },
    T004: {
      impact:
        'Matching page titles and main headings can be perfectly reasonable. This is a suggestion to review the wording.',
      action:
        'Check that both the search-result title and the visible main heading clearly describe this page. Change them only if doing so improves clarity.',
    },
  };
  if (specific[ruleId]) return specific[ruleId];
  if (ruleId === 'P010')
    return {
      impact:
        'Google did not provide enough real-user measurements. This alone does not mean your website is slow.',
      action:
        'Check provider access in Speed & experience. If there are not enough real-user samples, use the separate Lighthouse lab test and check again later.',
    };
  if (ruleId === 'L001')
    return {
      impact:
        'Visitors can reach a dead end when they click a link on this page. The broken destination is listed in the evidence.',
      action:
        'Edit the affected page and replace or remove each broken link shown below. The page containing the link may still load correctly.',
    };
  return (
    GUIDANCE[ruleId.charAt(0)] ?? {
      impact:
        'This check identified something worth reviewing in the context of the page.',
      action:
        'Read the evidence and share the technical reference with your website developer before making changes.',
    }
  );
}
