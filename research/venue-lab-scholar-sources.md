# Venue, lab and Google Scholar sources

Research for [issue #11](https://github.com/ChrisKalahiki/paper-bot/issues/11). It builds on [Paper sources for the Interests](https://github.com/ChrisKalahiki/paper-bot/blob/research/paper-sources/research/paper-sources.md) (issue #2, branch `research/paper-sources`), which recommended **arXiv**, **OpenAlex**, **ERIC** and **Hugging Face daily papers**. Terms follow `GLOSSARY.md`: **Paper**, **Interest**, **Pick**, **Wildcard**.

The Interests (map issue #1): AI in higher education; agents/LLMs; AI in HCI; context management in AI; multimodal and new kinds of AI models; plus **Wildcards**.

Every claim is cited to the owner's docs, terms, proceedings site or API. Where I called an endpoint myself it is marked *observed* (all on 2026-10-26, OpenAlex on the keyless free tier). Counts are single-day snapshots.

## Short answer

- **OpenAlex reaches most of the venues, but not all, and not on time for some.** ACM venues (CHI, CSCW, UIST, KDD, L@S, TOCHI), ACL/EMNLP, AIED and EDM are in OpenAlex within about a day of publication, mostly with abstracts (*observed*). **ICML and ICLR are not**: OpenAlex only has their arXiv copies, with no venue attached. **NeurIPS** is there, but its 2025 proceedings got DOIs eight months after the conference and every one carries the publication date `2025-01-01`, so the rolling publication-date window recommended in #2 never sees them (*observed*).
- **Fix inside OpenAlex:** add a "watched venues" query per run (`primary_location.source.id:<ids>` + `publication_year:<this year|last year>`, deduped against the seen-Papers store), alongside the date window. It costs cents a day on the free key.
- **ICML and other PMLR venues:** each PMLR volume has an RSS feed with abstracts, and a root feed lists new volumes (*observed*). Cheap, no key. **ICLR (and TMLR)** live on OpenReview, whose API answered a scripted call with a bot challenge (*observed*). ICLR content still arrives through arXiv; only the "accepted at ICLR" label is missing.
- **IEEE Xplore API: not usable for paper-bot.** Access is "limited to current IEEE customers", the grant is for activities "within the Licensee's educational institution", and content may not be used "for use with any AI system" ([API terms](https://developer.ieee.org/API_Terms_of_Use2)). Reach IEEE through OpenAlex, but only ~7% of recent IEEE DOIs there have abstracts (*observed*).
- **Labs:** the three labs publish differently. OpenAI has an RSS feed with `Research`/`Publication` categories, but its article pages answer scripts with a Cloudflare challenge (*observed*). Google DeepMind has a blog RSS feed and a paged publications listing whose detail pages carry a machine-readable link to the Paper (*observed*). Anthropic has no feed (404, *observed*). It has a `/research` index page, a sitemap, and an Atom feed on transformer-circuits.pub (*observed*). Per Chris's decision, a lab post only points to a Paper: it adds that Paper to the candidates and can boost its rank, as Hugging Face daily papers does. Posts with no Paper behind them are out of v1.
- **Google Scholar:** no API, and robots.txt disallows `/scholar` and `/search` ([robots.txt](https://scholar.google.com/robots.txt), *observed*), so no querying or scraping. **Scholar Alerts delivered to Chris's Gmail are legitimate**: they are a Scholar feature, and reading your own mail is not automated access to Scholar. They are a weak source, though. Alerts come "several times a week" ([Scholar help](https://scholar.google.com/intl/en/scholar/help.html)), Google doesn't document what an alert email contains, and reading Gmail needs a *restricted* OAuth scope. Optional, not v1.
- **OpenAlex setup** is a free account and a free key, with no card. Steps are in §6.

Updated v1 set: **arXiv**, **OpenAlex** (date window *plus* watched venues), **ERIC**, **PMLR volume feeds**, and two pointer sources that add no Papers of their own, **Hugging Face daily papers** and **lab feeds**. See §7.

## 1. Conferences

### How each venue publishes

| Venue | Interests | Where proceedings live | When (latest edition) | In OpenAlex? (*observed*) |
| --- | --- | --- | --- | --- |
| **CHI** | AI in HCI, higher ed | ACM DL, DOI `10.1145/3772318.*` | CHI 2026: published 2026-04-13. OpenAlex created the records 2026-04-14 | Yes: source `S4363607743`, 1,702 works for 2026, 1,579 with abstract (93%) |
| **CSCW** | AI in HCI | ACM, published as articles in *Proceedings of the ACM on Human-Computer Interaction* (PACM HCI) through the year | Rolling issues | Yes: PACM HCI `S4210183893`, 274 works for 2026, 273 with abstract. The separate "CSCW" source holds only companion/extended material (142 for 2026) |
| **UIST** | AI in HCI | ACM DL | At the conference | Yes: `S7407087746`, 124 works for 2025, 106 with abstract |
| **KDD** | agents/LLMs, Wildcards | ACM DL | At the conference | Yes: `S4363608767`, 1,475 works for 2026, 1,205 with abstract |
| **L@S** | AI in higher ed | ACM DL | L@S 2025: published 2025-07-17 | Yes: `S7407087266`, 66 works for 2025–26 |
| **NeurIPS** | agents/LLMs, multimodal, context | OpenReview (decisions), then [proceedings.neurips.cc](https://proceedings.neurips.cc/paper_files/paper/2025/vol38-main-conference) (5,823 main-track papers for 2025), with DOIs `10.52202/085713-*` | NeurIPS 2025 ran 2025-11-30 → 12-07. Its DOIs were registered 2026-08-06 (Crossref `created`, *observed*) | Yes but late: `S4363606243`, 5,819 works for 2025, 3,505 with abstract (60%). **All 5,819 have `publication_date` 2025-01-01**, because Crossref gives only the year |
| **ICML** | agents/LLMs, multimodal, context | PMLR: [ICML 2026](https://proceedings.mlr.press/v306/) is volume 306 | ICML 2026 was 2026-07-06 → 11. PMLR published it **2026-09-29** (6,552 papers). ICML 2025 (July) was published 2025-10-06 ([v267](https://proceedings.mlr.press/v267/)) | **No venue record.** The ICML source `S4306419644` has no works for 2024–26. Two ICML Papers checked by title resolve only to their arXiv/repository copies. PMLR issues no DOIs |
| **ICLR** | agents/LLMs, multimodal | OpenReview only | ICLR 2026: April 2026 | **No venue record.** The source `S4306419637` has no works for 2024–26. An ICLR 2026 Outstanding Paper ("Transformers are Inherently Succinct", [MPI-SWS](https://saarland-informatics-campus.de/en/piece-of-news/mpi-researcher-receives-outstanding-paper-award-at-iclr-2026/)) resolves only to arXiv 2510.19315 |
| **ACL / EMNLP** (and NAACL, Findings) | agents/LLMs, context | ACL Anthology, DOI `10.18653/v1/*`. CC BY 4.0 from 2016 ([FAQ](https://aclanthology.org/faq/)) | At the conference | Yes: ACL `S4363608652` 2,655 works for 2026; EMNLP `S4363608991` 1,810 for 2025. All `10.18653/v1/2026*` DOIs: 7,518 of 8,037 with abstract (94%) |
| **AIED** | AI in higher ed | Springer LNCS 16581–16583 (+ CCIS 3031–3033 for posters and workshops). AIED 2026 was Seoul, late June–July 3 ([Springer, Part I](https://link.springer.com/978-3-032-29744-0)) | Chapters dated 2026-06-26, created in OpenAlex 06-27 | Yes, but filed under the "Lecture notes in computer science" source, not AIED. Part I: 43 works, **1 with abstract** |
| **EDM** | AI in higher ed | Zenodo, DOI `10.5281/zenodo.*`, linked from the [EDM 2026 proceedings page](https://educationaldatamining.org/edm2026/proceedings/) | 2026-06-29, created in OpenAlex 06-30 | Yes, but filed under the "Zenodo" source, so it is only findable by topic or DOI (`10.5281/zenodo.21039738` → W7166552438) |

ACM's and ACL's routes are covered in #2 (§6 ACM DL: no API, robots barred, reach it via OpenAlex; §10 ACL Anthology: RSS without abstracts).

### Lag versus arXiv (*observed*)

For a 200-Paper sample of each venue's works that also have an arXiv copy in OpenAlex, I measured the months from the arXiv id's month (first version) to the conference month:

| Venue | Share with an arXiv copy | Median lead of arXiv | Middle 50% |
| --- | --- | --- | --- |
| CHI 2026 | 438 of 1,702 (26%) | 2 months | 1–4.75 months |
| NeurIPS 2025 | 3,372 of 5,819 (58%) | 7 months | 3–9 months |

For NeurIPS, add the ~8 months from the conference to DOI registration. A typical NeurIPS 2025 Paper hit arXiv about **15 months** before its venue record became fetchable from OpenAlex. Example: A-Mem (arXiv 2502.12110, Feb 2025) has the venue DOI `10.52202/085713-0593`, created in OpenAlex 2025-10-10. When the arXiv copy exists, OpenAlex merges both into **one work** (arXiv appears as a second location), so a venue record usually re-surfaces a Paper paper-bot already saw on arXiv. It does not bring a new one.

**What this means.** For the ML venues (NeurIPS, ICML, ICLR), arXiv already carries most of the content months earlier. What the venue adds is the acceptance label and the 40–75% of Papers with no arXiv copy. For the HCI and education venues (CHI, CSCW, L@S, AIED, EDM) most Papers are *not* on arXiv (74% of CHI 2026), so the venue record is the Paper's first appearance and OpenAlex is the route.

### Machine-readable access per venue

- **ACM venues, ACL/EMNLP, AIED, EDM → OpenAlex.** Watch by source id (ACM, ACL) or by DOI prefix (`doi_starts_with:10.1007/978-3-032-29744-0` for AIED Part I; *observed*: the filter works).
- **NeurIPS → OpenAlex watched-venue query**, not the date window. proceedings.neurips.cc has no feed or JSON link, and no `robots.txt` (404, *observed*).
- **ICML (and AISTATS, CoLLAs and other PMLR venues) → PMLR feeds.** The root feed `https://proceedings.mlr.press/feed.xml` lists every volume (`v306` = "Proceedings of ICML 2026"). Each volume has `https://proceedings.mlr.press/v<N>/assets/rss/feed.xml`, whose items carry title, **abstract** (`<description>`), `pubDate` and link (*observed*, v267: 3,330 items). PMLR is a static GitHub Pages site. No API terms are published, and `robots.txt` returns 404 (*observed*).
- **ICLR, TMLR → OpenReview.** The API exists ([docs](https://docs.openreview.net/how-to-guides/data-retrieval-and-modification/how-to-get-all-notes-for-submissions-reviews-rebuttals-etc)) and accepted papers carry the venue id. But an unauthenticated `GET api2.openreview.net/notes?content.venueid=ICLR.cc/2026/Conference` returned `403 ChallengeRequiredError` (*observed*). OpenReview's terms put metadata under CC0 and let editors "set upper limits on the number of transmissions" ([terms](https://openreview.net/legal/terms)). Not in v1. Whether a logged-in client avoids the challenge is untested; this would need an OpenReview account.

## 2. IEEE Xplore and journals

### IEEE Xplore API

- **Key:** register, then request a key "by describing your application". "Only one API key per application". Keys are issued "during business hours (8am-5pm) Eastern time" ([getting started](https://developer.ieee.org/getting_started)).
- **Eligibility:** "Access to the IEEE Xplore API is limited to current IEEE customers". Government and corporate customers "can request an API license". The grant covers "non-commercial educational, research, or scientific activities within the Licensee's educational institution" ([API terms](https://developer.ieee.org/API_Terms_of_Use2)).
- **AI clause:** licensees must not "use any Content for the purpose of training, enhancing, developing, or contributing to any AI system", nor make derivative works "for use with any AI system" ([API terms](https://developer.ieee.org/API_Terms_of_Use2)). Ranking IEEE abstracts with an LLM is at least arguably inside that.
- **Other limits:** content may be shown only "in response to an individual query", never "in bulk format" (same page). Rate limits are "displayed during the user registration process" (same page). There are `start_date`/`end_date` filters on *insert* date, which would have been a clean "new since T", and at most 200 records per call ([metadata parameters](https://developer.ieee.org/docs/read/Metadata_API_details)).
- **Verdict: not usable** unless Chris is covered by an institution that is an IEEE customer, and even then the AI clause is a problem. *Open question for Chris:* does he have an IEEE-subscribing institution?

**IEEE through other routes.** OpenAlex indexes IEEE DOIs, but only 45 of 605 `10.1109` DOIs published 2026-10-01 → 26 have an abstract (7%, *observed*). IEEE Xplore also serves per-journal table-of-contents RSS. The *IEEE Transactions on Learning Technologies* feed `https://ieeexplore.ieee.org/rss/TOC4620076.XML` returned 50 items with full abstracts (*observed*). But the Xplore site terms page refused automated fetches (HTTP 418, *observed*), so I couldn't check what they say about feeds. Re-read [the Xplore terms](https://ieeexplore.ieee.org/Xplorehelp/overview-of-ieee-xplore/terms-of-use) in a browser before using TOC feeds.

### Notable journals

| Journal | Publisher | OpenAlex 2026 (*observed*) | Direct feed (*observed*) | Route |
| --- | --- | --- | --- | --- |
| IEEE Trans. on Learning Technologies | IEEE | `S130363450`: 75 works, 39 with abstract (52%) | Xplore TOC RSS, with abstracts (terms unverified, above) | OpenAlex; TOC RSS only if the terms allow it |
| Computers & Education | Elsevier | `S4210172634`: 143 works, 62 with abstract (43%) | ScienceDirect RSS `rss.sciencedirect.com/publication/science/03601315`: title, issue and authors, **no abstract** | OpenAlex. The RSS adds nothing an LLM can rank |
| Computers and Education: Artificial Intelligence | Elsevier | `S4210183364`: 148 works, 138 with abstract (93%) | n/a | OpenAlex |
| Int. J. of AI in Education | Springer | `S171267539`: 14 works, all with abstract | n/a | OpenAlex |
| ACM TOCHI | ACM | `S89276529`: 45 works, all with abstract | ACM sits behind a bot wall (#2 §6) | OpenAlex |
| JMLR | JMLR (MIT Press listed) | `S118988714`: **0** works for 2024–26 | `https://www.jmlr.org/jmlr.xml`: 205 items with title, abstract, PDF link and year-only `pubDate` | JMLR feed (dedupe by URL, since dates are year-only) |
| TMLR | OpenReview | `S4393919742`: 1 work | Listing at `jmlr.org/tmlr/papers/` with per-paper BibTeX. No feed found | Not in v1 (OpenReview challenge, §1). Content mostly reaches arXiv (unverified) |

The pattern: Elsevier, Springer and IEEE chapters and articles reach OpenAlex with thin abstracts. Abstract-less records can only be ranked on title, venue and topic. Whether that is acceptable, or whether such Papers need an abstract fetched another way, is for the ranking ticket.

## 3. Lab publications

Chris's decision (relayed for this ticket): **a lab post is not a Paper in v1.** A post that announces a Paper only points to it: it adds the Paper to the candidates and can boost its rank, as Hugging Face daily papers does. Posts with no Paper behind them are out of v1 (noted on the map for v2). So the question per lab is: is there a machine-readable list of posts, and can a post be linked to its Paper (arXiv id or DOI) without breaking terms?

### OpenAI

- **Listing:** `https://openai.com/news/rss.xml`, with 1,322 items back to 2015 (*observed*). Each item has `title`, `description` (one sentence), `link`, `pubDate` and `category`. The categories include `Research` (202 items) and `Publication` (34), as well as Product, Company, Safety and others (*observed*). There is no separate research feed.
- **Terms / access:** robots.txt is `Allow: /` ([robots.txt](https://openai.com/robots.txt), *observed*). But article pages (`openai.com/index/...`) answered scripted requests with `cf-mitigated: challenge` (Cloudflare, *observed*), and so did the terms page. I could not read the current Terms of Use; search excerpts show they prohibit "automatically or programmatically extract[ing] data or Output" from the Services ([Terms of Use](https://openai.com/policies/row-terms-of-use/)). Whether that covers the public website isn't settled by the text I could see. Use the RSS feed only and don't work around the challenge.
- **Post → Paper:** the RSS item carries no arXiv/DOI link (*observed*). The link has to be found by matching the post title against arXiv/OpenAlex titles from the same days. Expect misses, since post titles are often not paper titles.
- **arXiv overlap:** not measurable without reading pages. OpenAlex attributes 270 works published in 2026 to OpenAI (`I4210161460`), 43 with an arXiv location (*observed*). But arXiv records carry no affiliations, so that undercounts arXiv badly. Treat it as unknown.

### Google DeepMind

- **Listings:**
  - Blog RSS `https://deepmind.google/blog/rss.xml`: 100 items, 2025-11-18 → 2026-10-22, no categories, served gzip-compressed (*observed*). Mostly announcements.
  - **Publications** `https://deepmind.google/research/publications/`: 265 entries on 9 pages (`/page/N/`), with title and date, newest first. No feed (*observed*). Each detail page `/research/publications/<n>/` has an abstract, authors and a schema.org JSON-LD `"sameAs"` link to the Paper (*observed*).
  - Also relevant: the Google Research blog RSS `https://research.google/blog/rss/` (100 items, *observed*).
- **Terms / access:** robots.txt is `User-agent: * Allow: /` (*observed*). Google's Terms of Service bar "using automated means to access content from any of our services" only "in violation of the machine-readable instructions on our web pages (for example, robots.txt files that disallow crawling...)" ([Google ToS](https://policies.google.com/terms)). Polite reads of the publications listing are within that.
- **Post → Paper:** `sameAs` on all 30 page-one entries pointed to the Paper (*observed*): 12 to arXiv, 4 to ACM DL, 2 each to ACL Anthology, OpenReview and SSRN, and the rest to journals and proceedings (Nature, PLOS ONE, MDPI Entropy, AAAI), NeurIPS, PhilPapers or a project page. That is the cleanest lab-to-Paper link of the three.
- **arXiv overlap:** 12 of 30 recent publications have arXiv as their primary link (*observed*). Venue-first ones may also be on arXiv. OpenAlex attributes 4,171 works in 2026 to Google DeepMind (`I4210090411`), with the same affiliation caveat as above.

### Anthropic

- **Listings:**
  - No RSS: `/rss.xml` and `/news/rss.xml` return 404 (*observed*).
  - `https://www.anthropic.com/research` lists 27 research links in its HTML (*observed*).
  - `https://www.anthropic.com/sitemap.xml` holds 208 `/research/` URLs. But 187 carry an October 2026 `lastmod` (*observed*), so `lastmod` reflects rebuilds, not publication, and can't serve as a "new since T" cursor. New posts have to be detected by diffing the URL set.
  - The interpretability site has an Atom feed, `https://transformer-circuits.pub/feed.xml`: 56 entries, latest 2026-08-21 (*observed*).
  - alignment.anthropic.com has no feed at `/feed.xml` or `/rss.xml` (404, *observed*).
- **Terms / access:** robots.txt is `User-Agent: * Allow: /` (*observed*). The `/legal/` pages in the sitemap are product terms (consumer, commercial, AUP). I found no website-specific terms of use.
- **Post → Paper:** a sampled research post linked arXiv papers, alignment.anthropic.com write-ups and PDFs on `www-cdn.anthropic.com` (*observed*). Some Anthropic research is published only as a PDF or a transformer-circuits.pub article with no arXiv/DOI. Under Chris's rule those count as posts with no Paper behind them, and are out of v1 unless Chris decides otherwise.
- **arXiv overlap:** OpenAlex's "Anthropic (United States)" institution (`I4387930290`) returned 887 works for 2026, including unrelated items (e.g. a Zenodo physics record), so its affiliation match is unreliable (*observed*). Unknown.

### Summary

| Lab | Feed | Post → Paper link | Terms fit for v1 |
| --- | --- | --- | --- |
| OpenAI | RSS, all posts, filter on `Research`/`Publication` | Title match only (pages behind a challenge) | RSS yes; pages no |
| Google DeepMind | Publications listing (HTML, paged) + blog RSS | JSON-LD `sameAs` on every publication page | Yes (robots allow; Google ToS defers to robots) |
| Anthropic | `/research` HTML + transformer-circuits.pub Atom | Links in post HTML (arXiv, PDF) | Yes (robots allow) |

**Open for Chris (not decided here):** whether a lab paper that exists only as a PDF or web article (no arXiv, no DOI), such as a transformer-circuits.pub piece or an OpenAI system card, counts as a Paper. As relayed, v1 treats such posts as "no Paper behind them". Confirm that holds for papers that are self-published rather than plain blog posts.

## 4. Google Scholar

**What isn't allowed.** Scholar has no API. Its help page says "please respect our robots.txt when you access Google Scholar using automated software" and "Sorry, we're unable to provide bulk access", and points to "an arrangement directly with the source of the data" ([Scholar help](https://scholar.google.com/intl/en/scholar/help.html)). robots.txt disallows `/search`, `/scholar` and most of `/citations?` (*observed*). Google's ToS forbid automated access that violates robots.txt ([Google ToS](https://policies.google.com/terms)). So paper-bot must not query or scrape Scholar, and must not use third-party "Scholar APIs" that do it for you.

**What is allowed: alerts.** Any Scholar search can become an email alert: "click the envelope icon ... and click 'Create alert'". Scholar "periodically email[s] you newly published papers that match your search criteria", "right after we add new papers to Google Scholar. This usually happens several times a week" ([Scholar help](https://scholar.google.com/intl/en/scholar/help.html)). Following an author gives "New articles by this author" alerts (same page). A human creates the alerts, and the mail lands in Chris's inbox. Reading that mail is reading his own email, not automated access to Scholar.

**What an alert email contains.** Google doesn't document the format, and I didn't open any mailbox (out of scope). Third-party parsers (e.g. [ai4gs](https://github.com/LIMENGKE24/AI-Agent-GoogleScholarAlertEmail)) read the HTML body for each result's linked title plus nearby text, which suggests title, link, an author/venue line and a short snippet. The snippet is a few lines of text, **not the full abstract**. This is *unverified*. **Before deciding, Chris should look at one real alert and check:** whether there are links to the publisher, how long the snippet is, and whether there's a DOI. If result links go through `scholar.google.com/scholar_url?...`, that path falls under robots `Disallow: /scholar`. paper-bot should then decode the target URL from the query string and never fetch the Scholar redirect.

**Reading it via the Gmail API.**
- **Scope:** reading message bodies needs `gmail.readonly`, which Google lists among the **restricted** scopes ([Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)). `gmail.labels` is non-sensitive but can't read content (same page). Restricted scopes "require restricted scope OAuth App Verification", and storing or transmitting that data on servers triggers "a security assessment" (same page).
- **Personal-use exemption:** apps "for your personal use (fewer than 100 users)" can be used "without going through verification", by clicking through the "unverified app" warning ([unverified apps](https://support.google.com/cloud/answer/13464323)).
- **Token lifetime:** a project whose consent screen is External and in **Testing** status "is issued a refresh token expiring in 7 days" ([OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)). An unattended launchd job would break weekly. The project has to be set to "In production" (unverified, personal use) to keep a long-lived refresh token.
- **homeros:** Chris's existing Google Cloud project (Calendar/Health, read-only) could host this as one more scope, but that widens homeros's grant to his whole mailbox. A separate OAuth client is cleaner. That's for the implementation ticket.

**Value.** Scholar's index covers publishers where OpenAlex is thin on abstracts (IEEE, Elsevier, Springer). Alerts would surface those Papers, but with only a snippet. paper-bot would still need OpenAlex or the publisher for an abstract, matched by title or DOI. Delivery is batched "several times a week", alert queries are keyword searches, and the setup needs a restricted Gmail scope. **Recommendation:** not in v1. Revisit if v1 Briefings show Chris missing IEEE/Elsevier Papers, after he has checked a sample alert.

## 5. Updated coverage matrix

Coverage of *new* Papers per Interest. ●●● primary, ●● good, ● partial, – none. "Pointer" means it adds no Papers of its own, only points to and boosts Papers from other sources.

| Source | AI in higher ed | Agents/LLMs | AI in HCI | Context mgmt | Multimodal / new models | Wildcards | Venues reached | Key |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arXiv | ● | ●●● | ●● | ●●● | ●●● | ●● | NeurIPS/ICML/ICLR preprints, 26% of CHI | none |
| OpenAlex: date window | ●●● | ●● | ●●● | ●● | ●● | ●●● | ACM, ACL, journals, AIED, EDM | free |
| OpenAlex: watched venues | ●● (L@S, C&E, IJAIED, TLT, C&E:AI) | ●● (NeurIPS, KDD, ACL, EMNLP) | ●●● (CHI, CSCW, UIST, TOCHI) | ●● | ●● | – | NeurIPS (late), all ACM/ACL above | free |
| ERIC | ●●● | – | ● | – | – | – | education journals | none |
| PMLR volume feeds | – | ●● | – | ● | ●● | ● | ICML, AISTATS, CoLLAs | none |
| JMLR feed | – | ● | – | ● | ● | ● | JMLR | none |
| OpenReview | – | ●● | – | ● | ●● | – | ICLR, TMLR | blocked (*observed*) |
| HF daily papers (pointer) | – | ●● | – | ● | ●● | – | arXiv only | none |
| Lab feeds (pointer) | – | ●● | ● | ●● | ●● | ● | lab Papers on arXiv/venues | none |
| IEEE Xplore API | ● | ● | ● | ● | ● | ● | IEEE | customers only, AI clause |
| Scholar Alerts via Gmail | ●● | ●● | ●● | ●● | ●● | ● | everything Scholar indexes, snippets only | Gmail restricted scope |

Venue coverage by route (*observed* unless noted):

| Venue | arXiv | OpenAlex | Own feed |
| --- | --- | --- | --- |
| CHI | 26% | ●●● 1 day, 93% abstracts | – (ACM bot wall) |
| CSCW (PACM HCI), UIST, TOCHI, L@S | some | ●●● | – |
| KDD | some | ●●● | – |
| NeurIPS | 58%, ~7 months early | ●● ~8 months after, pub date `2025-01-01` | proceedings site, no feed |
| ICML | most (unmeasured) | arXiv copy only | ●●● PMLR RSS with abstracts |
| ICLR | most (unmeasured) | arXiv copy only | OpenReview (challenge) |
| ACL / EMNLP | most (#2 §10) | ●●● 94% abstracts | Anthology RSS, no abstracts |
| AIED | few | ● titles, ~2% abstracts | Springer (not checked) |
| EDM | few | ●● via Zenodo DOI | proceedings page |
| IEEE TLT | few | ●● 52% abstracts | Xplore TOC RSS (terms unverified) |
| Computers & Education | few | ●● 43% abstracts | ScienceDirect RSS, no abstracts |
| JMLR | some | – | ●●● jmlr.xml with abstracts |

## 6. OpenAlex setup for someone who has never used it

**What it is.** OpenAlex is "a free and open catalog of the world's scholarly research" ([about](https://openalex.org/about)), "built by a small nonprofit team", with data under CC0 (same page). It gathers papers from Crossref, arXiv, PubMed and others into one searchable API, with venues, authors, topics and (reconstructable) abstracts. paper-bot uses it to find peer-reviewed Papers that never appear on arXiv.

**Steps for Chris.**

1. Go to **openalex.org/signup** and make an account with an email address ([rate limits and authentication](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication)).
2. Confirm the email if asked.
3. Open **Settings → API key** (`openalex.org/settings/api-key`) and copy the key (same page).
4. Store it where paper-bot reads secrets (location to be decided by the implementation ticket). paper-bot sends it as `?api_key=<key>` or as `Authorization: Bearer <key>` (same page).
5. That's all. There is no card and no plan to pick: the Free tier gives "$1 of API usage per day" with "no payment method required", reset at midnight UTC ([pricing](https://help.openalex.org/access/pricing/)).

There is an alternative to steps 1–3. A program can request a key for an email address with `POST https://api.openalex.org/api-keys`. OpenAlex emails a link, and the key works once it is clicked (same auth page; also stated in the API's keyless `meta.notice`, *observed*). I did not do this; it needs Chris's go-ahead.

**Cost and limits.**
- Keyless: one shared $0.10/day per IP address (*observed* `x-ratelimit-limit-usd: 0.1`) and 10 req/s. Fine for poking around, but too fragile for a daily job ([rate limits](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication)).
- Free key: $1/day and 30 req/s (same page).
- *Observed* prices: a filtered list call costs $0.0001 (`x-ratelimit-cost-usd`) and a `search=` call $0.001.
- A daily run with the date window (#2) plus about 15 watched venues paged at 200 per call is on the order of 100 list calls, about **$0.01/day**, 1% of the free budget.
- When the budget runs out, calls return `429` until midnight UTC (same page).
- The paid plans ($5k–$20k+/yr) add bigger budgets and, at Member+ and up, "API filters that return everything new or changed since any date" ([pricing](https://help.openalex.org/access/pricing/)). Not needed.

**Gotchas for the implementation** (*observed* unless cited):
- Abstracts arrive only as `abstract_inverted_index` and must be rebuilt (#2 §2).
- Some venues hide under a series or repository source: AIED under "Lecture notes in computer science", EDM under "Zenodo", CSCW under PACM HCI. Watch those by DOI prefix or the right source id.
- NeurIPS publication dates are year-only (`YYYY-01-01`).
- `group_by` on a date field is rejected ("Cannot group by date, number, or search fields").

## 7. Recommended v1 source set (updated)

Building on #2's set:

1. **arXiv: the backbone.** Unchanged (#2 §1). It brings NeurIPS, ICML and ICLR content months ahead of the venues (median 7 months for NeurIPS 2025, *observed*) and most lab Papers that have a preprint.
2. **OpenAlex (free key): two queries per run.**
   - (a) **Date window**, as in #2: subfields 3304, 1709 (and 1702) over the last 14–30 days of publication date.
   - (b) **New: watched venues.** `primary_location.source.id` in {CHI `S4363607743`, PACM HCI `S4210183893`, UIST `S7407087746`, KDD `S4363608767`, L@S `S7407087266`, TOCHI `S89276529`, NeurIPS `S4363606243`, ACL `S4363608652`, EMNLP `S4363608991`, IEEE TLT `S130363450`, Computers & Education `S4210172634`, C&E: AI `S4210183364`, IJAIED `S171267539`} for `publication_year` this year and last year, paged at 200, deduped against the seen-Papers store. Add AIED by DOI prefix each year. This catches NeurIPS's late, year-dated records and anything the window misses through backfilled dates.
   - **Cost:** about 1¢/day.
   - A venue record that merges with an already-seen arXiv Paper carries the acceptance label, not a new Paper. Whether "accepted at X" changes ranking is for the ranking ticket.
3. **ERIC.** Unchanged (#2 §3).
4. **New: PMLR feeds for ICML (and AISTATS).** Check `proceedings.mlr.press/feed.xml` weekly for a new ICML/AISTATS volume, then pull that volume's RSS once: titles, abstracts and links. This is the only machine-readable source that labels ICML Papers, since OpenAlex has no ICML records. It is a few calls a year, with no key.
5. **New: JMLR feed** (`jmlr.org/jmlr.xml`). JMLR has no recent records in OpenAlex. One call a day, deduped by URL. Small. Drop it if v1 must shrink.
6. **Hugging Face daily papers: pointer.** Unchanged (#2 §4).
7. **New: lab feeds: pointer.** Per Chris's decision, posts only point to Papers:
   - **Google DeepMind:** the publications listing, page 1 daily. For each new entry, read its `sameAs` to get the arXiv id or DOI.
   - **Anthropic:** diff the URL set of `/research` and read new posts for arXiv/DOI links. Also `transformer-circuits.pub/feed.xml`.
   - **OpenAI:** the news RSS filtered to `Research`/`Publication`, linked to a Paper by title match only.
   - In all three, a post that resolves to a Paper adds that Paper to the candidates and can boost it. A post that doesn't resolve is dropped in v1.

**Not in v1:**
- IEEE Xplore API: customers only, AI clause.
- IEEE TOC RSS: terms unverified, so pending a check.
- OpenReview for ICLR/TMLR: bot challenge; the content arrives through arXiv anyway.
- ScienceDirect RSS: no abstracts.
- Google Scholar Alerts via Gmail: legitimate but snippet-only, batched, and needs a restricted Gmail scope; revisit after v1.
- Lab posts with no Paper behind them: v2 per Chris.

## Open points for other tickets / Chris

- **Chris:** does a lab paper published only as a PDF or web article (no arXiv, no DOI) count as "a Paper behind the post"? v1 currently says no.
- **Chris:** is he covered by an institution with IEEE access? That is the only way the Xplore API becomes possible, and the AI clause would still need reading by him.
- **Chris:** if Scholar Alerts are wanted later, open one real alert email and check its contents (snippet length, publisher links, DOI) before anyone builds a parser.
- **Ranking ticket:** abstract-less records (IEEE ~7%, AIED ~2%, C&E 43% have abstracts) can only be ranked on title and venue. Venue acceptance arrives as a label on an already-seen arXiv Paper.
- **Store design:** NeurIPS venue DOIs (`10.52202/...`) and arXiv ids merge into one OpenAlex work, but ICML/ICLR versions never get a venue record there. A PMLR URL is the only ICML id.
- **Keys to provision:** still only the OpenAlex free key (§6).
