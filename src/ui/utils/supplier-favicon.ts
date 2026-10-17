/** Direct browser image embedding only: no website scraping or logo aggregation service. */
export function supplierFaviconUrl(websiteUrl: string | undefined): string | undefined {
  if (!websiteUrl) {
    return undefined
  }
  try {
    const website = new URL(websiteUrl)
    if ((website.protocol !== 'https:' && website.protocol !== 'http:') || website.username || website.password) {
      return undefined
    }
    return new URL('/favicon.ico', website.origin).href
  } catch {
    return undefined
  }
}
