const https = require('https');
const http = require('http');

class ItemScraper {
  constructor() {
    this.results = [];
    this.visitedUrls = new Set();
  }

  // Make an HTTP/HTTPS request with timeout and redirects
  fetch(url, maxRedirects = 3) {
    return new Promise((resolve, reject) => {
      if (maxRedirects <= 0) {
        return reject(new Error('Too many redirects'));
      }

      const protocol = url.startsWith('https') ? https : http;
      
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5,es-MX;q=0.3',
        },
        timeout: 10000
      };

      const req = protocol.get(url, options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const urlObj = new URL(url);
            redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          }
          return this.fetch(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  // Extract prices in USD and MXN from text/HTML
  extractPrices(text) {
    const prices = {
      usd: [],
      mxn: []
    };

    // USD patterns
    const usdPatterns = [
      /\$\s*([\d,]+\.?\d{0,2})\s*(?:USD|usd|dollars?)?/g,
      /USD\s*\$?\s*([\d,]+\.?\d{0,2})/gi,
      /US\$\s*([\d,]+\.?\d{0,2})/gi,
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars?)/gi,
    ];

    // MXN patterns
    const mxnPatterns = [
      /\$\s*([\d,]+\.?\d{0,2})\s*(?:MXN|mxn|pesos?)/gi,
      /MXN\s*\$?\s*([\d,]+\.?\d{0,2})/gi,
      /MX\$\s*([\d,]+\.?\d{0,2})/gi,
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:MXN|pesos?)/gi,
    ];

    // Extract USD prices
    for (const pattern of usdPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const price = this.normalizePrice(match[1] || match[0]);
        if (price && price > 0 && price < 1000000) {
          prices.usd.push(price);
        }
      }
    }

    // Extract MXN prices
    for (const pattern of mxnPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const price = this.normalizePrice(match[1] || match[0]);
        if (price && price > 0 && price < 10000000) {
          prices.mxn.push(price);
        }
      }
    }

    // Also look for generic $ prices (could be either currency)
    // These will be categorized based on value heuristics
    const genericPattern = /\$\s*([\d,]+\.?\d{0,2})(?![^\s]*(?:USD|MXN|peso|dollar))/gi;
    let match;
    while ((match = genericPattern.exec(text)) !== null) {
      const price = this.normalizePrice(match[1]);
      if (price && price > 0) {
        // Heuristic: prices over 500 without currency indicator might be MXN
        // This is a rough guess based on typical price ranges
        if (price > 500 && price < 100000) {
          prices.mxn.push(price);
        } else if (price < 10000) {
          prices.usd.push(price);
        }
      }
    }

    // Remove duplicates and sort
    prices.usd = [...new Set(prices.usd)].sort((a, b) => a - b);
    prices.mxn = [...new Set(prices.mxn)].sort((a, b) => a - b);

    return prices;
  }

  // Normalize price string to number
  normalizePrice(priceStr) {
    if (!priceStr) return null;
    const cleaned = priceStr.toString().replace(/[,$\s]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }

  // Extract product information from a page
  extractProductInfo(html, url) {
    const info = {
      title: '',
      description: '',
      prices: { usd: [], mxn: [] },
      images: [],
      url: url
    };

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      info.title = this.cleanHtml(titleMatch[1]);
    }

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    if (descMatch) {
      info.description = this.cleanHtml(descMatch[1]);
    }

    // Extract all prices from the page
    info.prices = this.extractPrices(html);

    // Look for structured price data (JSON-LD)
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const jsonLdMatch of jsonLdMatches) {
        try {
          const jsonContent = jsonLdMatch.replace(/<script[^>]*>|<\/script>/gi, '');
          const data = JSON.parse(jsonContent);
          this.extractPricesFromJsonLd(data, info.prices);
        } catch (e) {
          // JSON parse failed, continue
        }
      }
    }

    // Look for common price element patterns
    const priceElementPatterns = [
      /<[^>]*class=["'][^"']*price[^"']*["'][^>]*>([^<]*[\d,.]+[^<]*)<\/[^>]+>/gi,
      /<[^>]*id=["'][^"']*price[^"']*["'][^>]*>([^<]*[\d,.]+[^<]*)<\/[^>]+>/gi,
      /<span[^>]*itemprop=["']price["'][^>]*>([^<]+)<\/span>/gi,
      /data-price=["']([^"']+)["']/gi,
    ];

    for (const pattern of priceElementPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const extracted = this.extractPrices(match[1]);
        info.prices.usd.push(...extracted.usd);
        info.prices.mxn.push(...extracted.mxn);
      }
    }

    // Deduplicate
    info.prices.usd = [...new Set(info.prices.usd)].sort((a, b) => a - b);
    info.prices.mxn = [...new Set(info.prices.mxn)].sort((a, b) => a - b);

    return info;
  }

  // Extract prices from JSON-LD structured data
  extractPricesFromJsonLd(data, prices) {
    if (Array.isArray(data)) {
      for (const item of data) {
        this.extractPricesFromJsonLd(item, prices);
      }
      return;
    }

    if (typeof data !== 'object' || data === null) return;

    // Look for price fields
    if (data.price) {
      const price = parseFloat(data.price);
      if (!isNaN(price)) {
        const currency = (data.priceCurrency || '').toUpperCase();
        if (currency === 'MXN') {
          prices.mxn.push(price);
        } else {
          prices.usd.push(price);
        }
      }
    }

    if (data.offers) {
      this.extractPricesFromJsonLd(data.offers, prices);
    }

    if (data.lowPrice) {
      const price = parseFloat(data.lowPrice);
      if (!isNaN(price)) prices.usd.push(price);
    }

    if (data.highPrice) {
      const price = parseFloat(data.highPrice);
      if (!isNaN(price)) prices.usd.push(price);
    }
  }

  // Search and get initial results
  async search(item) {
    console.log('\n[SEARCH] Looking for: "' + item + '"\n');
    console.log('='.repeat(60));

    const searchQuery = encodeURIComponent(item + ' price buy');
    const searchUrl = `https://html.duckduckgo.com/html/?q=${searchQuery}`;

    try {
      console.log('[STATUS] Fetching search results...\n');
      const html = await this.fetch(searchUrl);
      const initialResults = this.parseSearchResults(html, item);

      if (initialResults.length === 0) {
        console.log('[WARNING] No results found in initial search.');
        return [];
      }

      console.log('[STATUS] Found ' + initialResults.length + ' initial results');
      console.log('[STATUS] Now scanning each result page for detailed prices...\n');
      console.log('='.repeat(60));

      // Deep scan the first 8 results
      const detailedResults = [];
      const maxResults = Math.min(initialResults.length, 8);

      for (let i = 0; i < maxResults; i++) {
        const result = initialResults[i];
        console.log('\n[' + (i + 1) + '/' + maxResults + '] Scanning: ' + result.url.substring(0, 60) + '...');

        try {
          const pageHtml = await this.fetch(result.url);
          const productInfo = this.extractProductInfo(pageHtml, result.url);

          // Merge with initial result data
          const detailedResult = {
            rank: i + 1,
            title: productInfo.title || result.title,
            url: result.url,
            description: productInfo.description || result.snippet,
            prices: productInfo.prices,
            initialSnippet: result.snippet
          };

          detailedResults.push(detailedResult);

          // Print progress
          const usdCount = detailedResult.prices.usd.length;
          const mxnCount = detailedResult.prices.mxn.length;
          console.log('    [OK] Found ' + usdCount + ' USD prices, ' + mxnCount + ' MXN prices');

        } catch (error) {
          console.log('    [ERROR] Failed to scan: ' + error.message);
          // Still include the initial result
          detailedResults.push({
            rank: i + 1,
            title: result.title,
            url: result.url,
            description: result.snippet,
            prices: { usd: [], mxn: [] },
            error: error.message
          });
        }
      }

      // Display final results
      this.displayResults(detailedResults, item);

      return detailedResults;

    } catch (error) {
      console.log('[ERROR] Search failed: ' + error.message);
      return [];
    }
  }

  // Parse DuckDuckGo HTML search results
  parseSearchResults(html, searchTerm) {
    const results = [];
    
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links = [];
    const titles = [];
    const snippets = [];

    let match;
    while ((match = resultPattern.exec(html)) !== null) {
      let url = match[1];
      const actualUrl = this.extractActualUrl(url);
      if (actualUrl && !actualUrl.includes('duckduckgo.com')) {
        links.push(actualUrl);
        titles.push(this.cleanHtml(match[2]));
      }
    }

    while ((match = snippetPattern.exec(html)) !== null) {
      snippets.push(this.cleanHtml(match[1]));
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: titles[i] || 'Unknown',
        url: links[i],
        snippet: snippets[i] || ''
      });
    }

    return results;
  }

  // Extract actual URL from DuckDuckGo redirect
  extractActualUrl(ddgUrl) {
    const uddgMatch = ddgUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      try {
        return decodeURIComponent(uddgMatch[1]);
      } catch (e) {
        return null;
      }
    }
    if (ddgUrl.startsWith('//')) {
      return 'https:' + ddgUrl;
    }
    return ddgUrl;
  }

  // Remove HTML tags from text
  cleanHtml(text) {
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Display formatted results
  displayResults(results, searchTerm) {
    console.log('\n');
    console.log('='.repeat(60));
    console.log('SEARCH RESULTS FOR: "' + searchTerm + '"');
    console.log('='.repeat(60));

    if (results.length === 0) {
      console.log('\nNo results found.');
      return;
    }

    for (const result of results) {
      console.log('\n' + '-'.repeat(60));
      console.log('RESULT #' + result.rank);
      console.log('-'.repeat(60));
      console.log('Title: ' + result.title.substring(0, 80));
      console.log('URL:   ' + result.url);
      
      if (result.description) {
        console.log('Description: ' + result.description.substring(0, 120) + '...');
      }

      console.log('\nPRICES FOUND:');
      
      if (result.prices.usd.length > 0) {
        const usdPrices = result.prices.usd.slice(0, 10).map(p => '$' + p.toFixed(2) + ' USD');
        console.log('  USD: ' + usdPrices.join(', '));
        
        if (result.prices.usd.length > 1) {
          const min = Math.min(...result.prices.usd);
          const max = Math.max(...result.prices.usd);
          console.log('  USD Range: $' + min.toFixed(2) + ' - $' + max.toFixed(2));
        }
      } else {
        console.log('  USD: No prices found');
      }

      if (result.prices.mxn.length > 0) {
        const mxnPrices = result.prices.mxn.slice(0, 10).map(p => '$' + p.toFixed(2) + ' MXN');
        console.log('  MXN: ' + mxnPrices.join(', '));
        
        if (result.prices.mxn.length > 1) {
          const min = Math.min(...result.prices.mxn);
          const max = Math.max(...result.prices.mxn);
          console.log('  MXN Range: $' + min.toFixed(2) + ' - $' + max.toFixed(2));
        }
      } else {
        console.log('  MXN: No prices found');
      }

      if (result.error) {
        console.log('  [Note: Page scan failed - ' + result.error + ']');
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    
    const allUsd = results.flatMap(r => r.prices.usd);
    const allMxn = results.flatMap(r => r.prices.mxn);

    if (allUsd.length > 0) {
      const avgUsd = allUsd.reduce((a, b) => a + b, 0) / allUsd.length;
      console.log('USD Prices Found: ' + allUsd.length);
      console.log('USD Price Range: $' + Math.min(...allUsd).toFixed(2) + ' - $' + Math.max(...allUsd).toFixed(2));
      console.log('USD Average: $' + avgUsd.toFixed(2));
    }

    if (allMxn.length > 0) {
      const avgMxn = allMxn.reduce((a, b) => a + b, 0) / allMxn.length;
      console.log('MXN Prices Found: ' + allMxn.length);
      console.log('MXN Price Range: $' + Math.min(...allMxn).toFixed(2) + ' - $' + Math.max(...allMxn).toFixed(2));
      console.log('MXN Average: $' + avgMxn.toFixed(2));
    }

    console.log('Total Pages Scanned: ' + results.length);
  }
}

// Demo mode for testing without network
function runDemoMode(searchTerm) {
  console.log('\n[SEARCH] Looking for: "' + searchTerm + '" (Demo Mode)\n');
  console.log('='.repeat(60));
  console.log('[STATUS] Running in demo mode with sample data\n');

  const demoResults = [
    {
      rank: 1,
      title: searchTerm + ' - Premium Quality - Best Electronics Store',
      url: 'https://electronics-store.com/product/12345',
      description: 'High quality ' + searchTerm + ' with warranty. Fast shipping available.',
      prices: { usd: [49.99, 59.99, 44.99], mxn: [899.00, 1099.00] }
    },
    {
      rank: 2,
      title: 'Buy ' + searchTerm + ' - Official Retailer',
      url: 'https://official-shop.com/items/premium',
      description: 'Authorized dealer for ' + searchTerm + '. Original products guaranteed.',
      prices: { usd: [79.99, 89.99], mxn: [1499.00, 1699.00] }
    },
    {
      rank: 3,
      title: searchTerm + ' - Budget Option - Value Store',
      url: 'https://value-store.com/budget-items',
      description: 'Affordable ' + searchTerm + ' options. Great quality at low prices.',
      prices: { usd: [24.99, 29.99, 19.99], mxn: [449.00, 549.00, 399.00] }
    },
    {
      rank: 4,
      title: searchTerm + ' Bundle with Accessories',
      url: 'https://bundle-deals.com/complete-package',
      description: 'Complete ' + searchTerm + ' bundle. Includes carrying case and extras.',
      prices: { usd: [99.99, 119.99], mxn: [1899.00, 2199.00] }
    },
    {
      rank: 5,
      title: 'Refurbished ' + searchTerm + ' - Certified',
      url: 'https://refurb-center.com/certified',
      description: 'Certified refurbished ' + searchTerm + '. Like new condition with warranty.',
      prices: { usd: [34.99, 39.99], mxn: [649.00, 749.00] }
    },
    {
      rank: 6,
      title: searchTerm + ' Pro Edition - Premium Features',
      url: 'https://pro-gear.com/premium-edition',
      description: 'Professional grade ' + searchTerm + ' with advanced features.',
      prices: { usd: [149.99, 179.99], mxn: [2799.00, 3299.00] }
    },
    {
      rank: 7,
      title: searchTerm + ' - Marketplace Deals',
      url: 'https://marketplace.com/deals/electronics',
      description: 'Multiple sellers offering ' + searchTerm + ' at competitive prices.',
      prices: { usd: [42.50, 55.00, 38.99], mxn: [799.00, 999.00, 699.00] }
    },
    {
      rank: 8,
      title: 'Import ' + searchTerm + ' - International Shop',
      url: 'https://global-import.com/products',
      description: 'Imported ' + searchTerm + ' with international warranty.',
      prices: { usd: [65.00, 72.00], mxn: [1199.00, 1349.00] }
    }
  ];

  // Display results using the same format
  console.log('\n');
  console.log('='.repeat(60));
  console.log('SEARCH RESULTS FOR: "' + searchTerm + '"');
  console.log('='.repeat(60));

  for (const result of demoResults) {
    console.log('\n' + '-'.repeat(60));
    console.log('RESULT #' + result.rank);
    console.log('-'.repeat(60));
    console.log('Title: ' + result.title);
    console.log('URL:   ' + result.url);
    console.log('Description: ' + result.description);

    console.log('\nPRICES FOUND:');
    
    if (result.prices.usd.length > 0) {
      const usdPrices = result.prices.usd.map(p => '$' + p.toFixed(2) + ' USD');
      console.log('  USD: ' + usdPrices.join(', '));
      const min = Math.min(...result.prices.usd);
      const max = Math.max(...result.prices.usd);
      console.log('  USD Range: $' + min.toFixed(2) + ' - $' + max.toFixed(2));
    }

    if (result.prices.mxn.length > 0) {
      const mxnPrices = result.prices.mxn.map(p => '$' + p.toFixed(2) + ' MXN');
      console.log('  MXN: ' + mxnPrices.join(', '));
      const min = Math.min(...result.prices.mxn);
      const max = Math.max(...result.prices.mxn);
      console.log('  MXN Range: $' + min.toFixed(2) + ' - $' + max.toFixed(2));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const allUsd = demoResults.flatMap(r => r.prices.usd);
  const allMxn = demoResults.flatMap(r => r.prices.mxn);

  const avgUsd = allUsd.reduce((a, b) => a + b, 0) / allUsd.length;
  console.log('USD Prices Found: ' + allUsd.length);
  console.log('USD Price Range: $' + Math.min(...allUsd).toFixed(2) + ' - $' + Math.max(...allUsd).toFixed(2));
  console.log('USD Average: $' + avgUsd.toFixed(2));

  const avgMxn = allMxn.reduce((a, b) => a + b, 0) / allMxn.length;
  console.log('MXN Prices Found: ' + allMxn.length);
  console.log('MXN Price Range: $' + Math.min(...allMxn).toFixed(2) + ' - $' + Math.max(...allMxn).toFixed(2));
  console.log('MXN Average: $' + avgMxn.toFixed(2));

  console.log('Total Pages Scanned: ' + demoResults.length);

  return demoResults;
}

// Main execution
async function main() {
  const scraper = new ItemScraper();

  const searchTerm = process.argv.slice(2).join(' ') || 'wireless headphones';
  const useDemo = process.env.DEMO === '1';

  console.log('============================================================');
  console.log('           ITEM PRICE SCRAPER - USD & MXN');
  console.log('============================================================');

  if (useDemo) {
    runDemoMode(searchTerm);
  } else {
    const results = await scraper.search(searchTerm);
    
    if (results.length === 0) {
      console.log('\n[FALLBACK] Network unavailable. Running demo mode...');
      runDemoMode(searchTerm);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Usage: node index.js <search term>');
  console.log('       node index.js gaming mouse');
  console.log('       node index.js laptop stand');
  console.log('       DEMO=1 node index.js bluetooth speaker');
  console.log('='.repeat(60));
}

main().catch(console.error);