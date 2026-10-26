# Paper sources for the Interests

Research for [issue #2](https://github.com/ChrisKalahiki/paper-bot/issues/2). Terms follow `GLOSSARY.md`: **Paper**, **Interest**, **Pick**, **Wildcard**.

The Interests (map issue #1): AI in higher education; agents/LLMs; AI in HCI; context management in AI; multimodal and new kinds of AI models; plus **Wildcards**.

Everything below was read from the provider's own docs, terms or OpenAPI spec, or observed by calling the API on 2026-10-26 (marked *observed*). Counts are single-day snapshots, not averages.

## Short answer

Recommended v1 set: **arXiv** (RSS daily, API for catch-up), **OpenAlex** (free key), **ERIC**, and **Hugging Face daily papers**.

- **arXiv** carries most new work for agents/LLMs, context management, multimodal models and much of AI in HCI, a day or more before any index. Metadata is CC0. Full text may be read for personal or research use. No key. One request per 3 s.
- **OpenAlex** adds the peer-reviewed side: ACM (CHI, CSCW, L@S, SIGCSE), education journals, Springer/Elsevier. Its abstracts cover about 91% of recent ACM DOIs, against about 13% in Crossref (*observed*). Metadata is CC0. A free key is enough. The catch: "new since T" filters (`from_created_date`) need a $10k/yr plan, so v1 polls by publication date and dedupes against the seen-Papers store.
- **ERIC** is the education-specific index. It is the only source that tags *Higher Education* as a field (`educationlevel`). It returned 1,793 AI + Higher Education records added in 2026 (*observed*). No key, but it only knows the *year* a record was added, so it also needs dedupe.
- **Hugging Face daily papers** is a hand-picked ~50–75 arXiv Papers/day with community upvotes (*observed*). It's no new coverage but a cheap quality signal for agents/LLMs and multimodal models. No key.
- Not in v1: **Semantic Scholar** has no "added since" filter, a shared unauthenticated pool that returned 429 on the first call (*observed*), and an attribution-bearing license. Use it later for enrichment if needed. **Crossref** is already folded into OpenAlex and has thin abstracts. **ACM DL** has no API and its terms forbid robots; reach ACM through OpenAlex. **CORE**, **DBLP** and **ACL Anthology** add little over the above for these Interests (details below).
- Recognise one Paper across sources by **DOI** first, then the **arXiv id** (an arXiv id maps to DOI `10.48550/arXiv.<id>`), then source-native ids. A preprint and its published version usually carry *different* DOIs, so the store needs to hold several ids per Paper.

## 1. arXiv

**Coverage.** arXiv categories map closely to four Interests ([taxonomy](https://arxiv.org/category_taxonomy)):

| Interest | Categories |
| --- | --- |
| Agents/LLMs | cs.CL (NLP), cs.AI, cs.LG, cs.MA ("intelligent agents") |
| Context management in AI | cs.CL, cs.AI, cs.LG, cs.IR (retrieval) |
| Multimodal / new kinds of models | cs.CV, cs.LG, cs.CL |
| AI in HCI | cs.HC ("human factors, user interfaces") |
| AI in higher education | cs.CY ("computers in education"), cs.HC; thin |
| Wildcards | Cross-lists into the above from other archives |

Volume (*observed*, `rss.arxiv.org` on Mon 2026-10-26): cs.AI 79 new + 110 cross, cs.CL 72 + 34, cs.LG 106 + 92, cs.CV 107 + 26, cs.HC 10 + 14, cs.CY 11 + 7, cs.MA 5 + 9. The combined feed `cs.AI+cs.CL+cs.HC+cs.CV+cs.LG+cs.CY+cs.MA` held **390 new + 108 cross-list** entries (plus 300 replacements).

**New since T.** There are three interfaces:
- **RSS/Atom**, `https://rss.arxiv.org/rss/<cat>`; join categories with `+`, "Limit 2000 results". Feeds are "updated daily at midnight Eastern Standard Time" ([RSS help](https://info.arxiv.org/help/rss.html)). Each item has `<arxiv:announce_type>` = `new | cross | replace | replace-cross`, the abstract in `<description>`, and the licence in `<dc:rights>` (*observed*). The feed holds one announcement day only and skips Saturday and Sunday (`<skipDays>`, *observed*), so a missed day can't be recovered from RSS.
- **Query API**: `search_query=cat:cs.HC+AND+submittedDate:[YYYYMMDDTTTT+TO+YYYYMMDDTTTT]` (GMT). `sortBy` is `relevance | lastUpdatedDate | submittedDate`. Pages hold up to 2000 results, capped at 30000 in total ([user manual](https://info.arxiv.org/help/api/user-manual.html)). `cat:` with `submittedDate` works (*observed*: 86 cs.HC Papers for 2026-10-20 → 26). This is the catch-up path after a missed day.
- **OAI-PMH**, `https://oaipmh.arxiv.org/oai`: incremental harvest with `from=<last harvest>` and sets such as `cs:cs:AI`. It "does not support selective harvesting based on submission date". Metadata appears "around 10:30pm ET Sunday through Thursday" ([OAI help](https://info.arxiv.org/help/oa/index.html)).

**Rate limits / key.** No key. "No more than one request every three seconds" and "a single connection at a time", across all your machines ([API terms of use](https://info.arxiv.org/help/api/tou.html)).

**Abstracts.** Yes, in every interface (`<summary>` in the API, `<description>` in RSS, *observed*).

**Full text.** The PDF is at `https://arxiv.org/pdf/<id>`. The terms allow you to "retrieve, store, and use the content of arXiv e-prints for your own personal use, or for research purposes", but not to "store and serve arXiv e-prints ... from your servers". Redistribution "requires permission from the copyright holder" ([API terms of use](https://info.arxiv.org/help/api/tou.html)). Metadata is CC0 ([licence help](https://info.arxiv.org/help/license/index.html)). Per-Paper licences range from CC BY to the arXiv non-exclusive licence, which "limits re-use of any type from other entities" (same page). Reading a Pick's PDF on the Mac mini and quoting from it in a private Briefing falls under personal use. Copying PDFs into the Vault would not be "serving", but keep only links to be safe.

**Identifiers.** arXiv id (e.g. `2610.31987`, with a version suffix `v1`). Every Paper also has the DataCite DOI `10.48550/arXiv.<id>` ([DOI help](https://info.arxiv.org/help/doi.html)). Authors may add the journal DOI later; arXiv keeps "journal reference and DOI metadata fields" for it (same page).

## 2. OpenAlex

**Coverage.** All fields, built from Crossref, DataCite, arXiv, PubMed and others (`indexed_in`, [work object](https://help.openalex.org/api-entities/works/work-object)). Works are classified into topics with subfields: `primary_topic.subfield.id` **1702** Artificial Intelligence, **1709** Human-Computer Interaction, **3304** Education. *Observed*: 5,081 AI-subfield works published since 2026-10-20; 741 HCI-subfield works since 2026-10-19; 648 Education works published 2026-09-26 → 10-26 that match "artificial intelligence OR generative AI OR ChatGPT". It is the best route to ACM conference papers, education journals and other venues that don't post to arXiv.

**New since T.** `from_created_date` ("records created since a date") and `from_updated_date` are "premium filters" ([filter works](https://help.openalex.org/api-entities/works/filter-works)) that come with the Member+ ($10,000/yr) and Partner plans ([pricing](https://help.openalex.org/access/pricing/)). *Observed*: using `from_created_date` without a plan returns `"Plan upgrade required"`. On the free tier, filter with `from_publication_date` / `to_publication_date`. Publication dates lag and get backfilled, so v1 has to query a rolling window (for example the last 14–30 days) and drop Papers already in the seen-Papers store.

**Rate limits / key.** Without a key: 10 req/s, and *observed* "one free daily budget ($0.10) with everyone on your network's IP address". A free key gives 30 req/s and "$1 a day" ([rate limits](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication)). Costs per 1,000 calls: list+filter $0.10, search $1, single entity free, content download $10. The free $1 buys 10,000 list calls (1,000,000 results) or 100 PDFs a day ([example costs](https://help.openalex.org/access/example-costs/)). That is plenty for a daily run. Get a free key at openalex.org/signup → Settings → API key ([rate limits](https://help.openalex.org/how-to-use-the-api/rate-limits-and-authentication)).

**Abstracts.** `abstract_inverted_index` only: "OpenAlex does not ship plaintext abstracts for legal reasons; reconstruct the abstract from the index". Abstracts are sometimes text-mined and can carry trailing junk ([work object](https://help.openalex.org/api-entities/works/work-object)). `has_abstract` is a filter ([filter works](https://help.openalex.org/api-entities/works/filter-works)). *Observed* for DOIs starting `10.1145` (ACM) published 2026-10-01 → 26: 2,779 of 3,051 have an abstract (91%).

**Full text.** `best_oa_location.pdf_url` points to the open copy, ranked publisher first, then PMC/arXiv ([work object](https://help.openalex.org/api-entities/works/work-object)). OpenAlex also caches PDFs and GROBID TEI XML for 50M+ OA works, at $0.01 per download, but "The PDFs retain their original copyright. OpenAlex does not grant any additional rights". You can filter by `best_oa_location.license` ([fulltext](https://help.openalex.org/access/fulltext/)). Metadata is CC0 ([about](https://openalex.org/about)).

**Identifiers.** `ids.openalex` (W-id), `ids.doi`, `mag`, `pmid`, `pmcid`. There is **no arXiv-id key** ([work object](https://help.openalex.org/api-entities/works/work-object)). arXiv Papers can be looked up by their DataCite DOI: *observed* `works/doi:10.48550/arXiv.2005.11401` → W3027879771, whose `ids.doi` is the arXiv DOI and not the later venue DOI. So preprint and venue version may be one OpenAlex work or two.

## 3. ERIC (Education Resources Information Center)

**Coverage.** US Department of Education index of education journals and reports. It is the only source with a precise **AI in higher education** handle: `educationlevel:"Higher Education"` alongside the ERIC thesaurus `subject` descriptors ([OpenAPI spec](https://eric.ed.gov/api/eric-api.yaml)). *Observed*: `"artificial intelligence" AND educationlevel:"Higher Education" AND e_yearadded:2026` → 1,793 records, roughly 6 per day. It has nothing for the other Interests.

**New since T.** Weak. The documented date fields are `publicationdateyear`, `e_yearadded` ("the year the record was added") and `e_datemodified`. There is no documented sort parameter ([OpenAPI spec](https://eric.ed.gov/api/eric-api.yaml)). *Observed*: a Solr range such as `e_datemodified:[2026-09-26T00:00:00Z TO *]` is accepted. But only 1,476 records in all of ERIC match from 2026-01-01, fewer than the 1,793 AI+HE records added in 2026, so `e_datemodified` is not populated on every record and can't serve as an "added since" cursor. v1 must query `e_yearadded:<this year>` (plus the previous year in January) and dedupe by ERIC id. ERIC's own pages give no update cadence. Library guides report 2025 budget cuts reduced intake (secondary, not verified against IES).

**Rate limits / key.** No key. The spec documents no rate limit. `rows` defaults to 20 and goes up to 2000, with paging via `start`; output is `xml | json | csv` ([OpenAPI spec](https://eric.ed.gov/api/eric-api.yaml)).

**Abstracts.** `description`: "Every ERIC record has a description, or abstract" ([OpenAPI spec](https://eric.ed.gov/api/eric-api.yaml)).

**Full text.** `e_fulltextauth` = 1 means ERIC "has permission to display the full text", at `https://files.eric.ed.gov/fulltext/<id>.pdf`. Otherwise `url` links to the publisher ([OpenAPI spec](https://eric.ed.gov/api/eric-api.yaml)). Authors or publishers "retain copyright to these works, which are used by ERIC with permission". Use beyond fair use needs the owner's permission ([copyright policy](https://eric.ed.gov/?copyright)). Private reading of a Pick for a Briefing is fair-use territory, so don't store or redistribute the PDFs.

**Identifiers.** ERIC number (`EJ…` journal, `ED…` document). There is **no DOI field**. *Observed*: the DOI appears, when present, only inside `url` as `http://dx.doi.org/<doi>`, so it has to be parsed from there. ISSN/ISBN are fields.

## 4. Hugging Face daily papers

**Coverage.** A daily hand-picked list of arXiv Papers on the Hub, overwhelmingly agents/LLMs and multimodal models. *Observed* 49–75 Papers/day over 2026-10-20 → 23. Useful as a quality signal (`upvotes`, `githubStars`) for three Interests. It adds no Papers that arXiv lacks: every entry is an arXiv id.

**New since T.** `GET /api/daily_papers` takes `date`, `week`, `month`, `limit`, `p`, `sort`, `submitter`; there is also `GET /api/papers/{paperId}` ([Hub OpenAPI](https://huggingface.co/.well-known/openapi.md)). Query `date=YYYY-MM-DD` per day, which makes a missed day easy to backfill. The parameters are listed without descriptions, so the semantics of `sort`/`week` are untested here.

**Rate limits / key.** Hub API bucket: 500 requests per 5 min anonymous (per IP), 1,000 for a free user, "subject to change" ([rate limits](https://huggingface.co/docs/hub/en/rate-limits)). *Observed* header: `ratelimit-policy: "fixed window";"api";q=500;w=300`. No key needed.

**Abstracts.** `paper.summary` is the arXiv abstract. HF also sends `ai_summary` and `ai_keywords` (*observed*).

**Full text.** None of its own; use arXiv (§1).

**Identifiers.** `paper.id` = arXiv id (*observed*).

## 5. Semantic Scholar Academic Graph

**Coverage.** All fields, ~200M papers. `fieldsOfStudy` filter includes `Computer Science`, `Education`, `Psychology` ([Graph API spec](https://api.semanticscholar.org/graph/v1/swagger.json)). Coverage overlaps OpenAlex and arXiv.

**New since T.** `/paper/search/bulk` filters on `publicationDateOrYear` (`2026-10-20:`), returns up to 1,000 per call with a continuation `token`, and sorts by `paperId | publicationDate | citationCount`. "Specific dates are not known for all papers ... they will be treated as if published on January 1st" ([Graph API spec](https://api.semanticscholar.org/graph/v1/swagger.json)). There is no "added since" filter in the Graph API. The Datasets API offers release-to-release `diffs` for the full corpus ([Datasets API spec](https://api.semanticscholar.org/datasets/v1/swagger.json)), far too heavy for a daily bot.

**Rate limits / key.** Unauthenticated: "1000 requests per second shared among all unauthenticated users". A key (free, by request form, emailed) starts at "1 RPS on all endpoints" ([API page](https://www.semanticscholar.org/product/api)). *Observed*: the first unauthenticated call returned `429 Too Many Requests`. So unattended use needs a key.

**Abstracts.** `abstract`, but "due to legal reasons, this may be missing even if we display an abstract on the website". There is also `tldr` ([Graph API spec](https://api.semanticscholar.org/graph/v1/swagger.json)).

**Full text.** `openAccessPdf` gives a link, and an `openAccessPdf` filter exists ([Graph API spec](https://api.semanticscholar.org/graph/v1/swagger.json)). The licence is "limited, non-exclusive, non-transferable ... terminable". Data is governed by its own licences "such as CC BY-NC or ODC-BY". Users must credit Semantic Scholar ([API licence](https://www.semanticscholar.org/product/api/license)).

**Identifiers.** The richest cross-walk: `externalIds` covers "ArXiv, MAG, ACL, PubMed, Medline, PubMedCentral, DBLP, and DOI" plus `CorpusId`. Lookup accepts `arXiv:<id>`, `DOI:<doi>` ([Graph API spec](https://api.semanticscholar.org/graph/v1/swagger.json)). That makes it the best fallback for resolving whether two records are one Paper.

## 6. ACM Digital Library

**Coverage.** Home of most AI-in-HCI venues (CHI, CSCW, UIST, IUI) and computing-education venues (SIGCSE, L@S, ITiCSE). Since 2026-01-01 "ACM is a fully Open Access publisher and the contents of the ACM Digital Library are free to access without a subscription on a basic version" ([ACM: Subscriptions/Access](https://libraries.acm.org/subscriptions-access); [ACM is Now Fully Open Access](https://www.acm.org/articles/bulletins/2026/january/acm-open-access)). Bulk downloads are a Premium feature (same pages).

**New since T / API.** ACM publishes no public API. Its usage policy bars using scripts, spiders or other robotic activity to download articles or harvest metadata ([DL usage policies](https://www.acm.org/publications/policies/dl_use_policies)). Its remote-access FAQ likewise forbids crawling full text or metadata without ACM's prior consent ([remote access FAQ](https://libraries.acm.org/subscriptions-access/remote-access/faq)). acm.org pages sit behind a Cloudflare bot challenge (*observed*: HTTP 403 / JS challenge to scripted fetches), so the acm.org statements in this section come from search-engine excerpts of those pages, not a direct read. Re-check them in a browser before relying on the exact wording. **Reach ACM through OpenAlex or Crossref**: DOI prefix `10.1145`.

**Abstracts.** Not from ACM directly. Through OpenAlex, 91% have abstracts; through Crossref, 13% (*observed*, §2 and §7).

**Full text.** Open to read on the DL. Crossref licence records for new ACM DOIs show `CC BY 4.0` or `CC BY-NC-ND 4.0` (*observed*). Fetching a Pick's PDF by hand is fine. Automated fetching from dl.acm.org conflicts with the usage policy, so for full text prefer an OpenAlex `best_oa_location` or arXiv copy.

**Identifiers.** DOI `10.1145/...`.

## 7. Crossref

**Coverage.** Every DOI registered with Crossref, ACM included. It has no subject classification worth filtering on.

**New since T.** The best of any source: `from-created-date`, `from-update-date` and `from-index-date` filters, plus `cursor=*` paging. Don't use published dates to sync ([tips](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)). *Observed*: `filter=prefix:10.1145,from-created-date:2026-10-20` → 1,468 ACM records.

**Rate limits / key.** "No sign-up is required" ([REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)). Documented pools: public 5 / concurrency 1, polite (`mailto=`) 10 / 3, Plus 150 ([access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)). *Observed* response headers were lower: public `x-rate-limit-limit: 1` and polite `3`, both `interval: 1s`. Trust the headers.

**Abstracts.** Thin and publisher-dependent. "Some abstracts ... may be subject to copyright" ([REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)). *Observed*: 648 of 4,808 ACM records created since 2026-10-01 have one (`has-abstract:true`).

**Full text.** Only `license` and `link` pointers. Metadata: "almost none of the metadata is subject to copyright, and you may use it for any purpose" ([REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)).

**Identifiers.** DOI (the canonical one for published versions).

Verdict: OpenAlex already ingests Crossref (`indexed_in: crossref`, *observed*) and adds abstracts and topics, so Crossref only earns a place if exact "created since T" for ACM becomes necessary.

## 8. CORE

**Coverage.** An aggregator of open-access repository content, all fields. It adds institutional-repository copies of education papers but little new for these Interests beyond OpenAlex.

**New since T.** Query fields `createdDate` / `updatedDate`, e.g. `q=createdDate:"2016-06-16T16:34:27"` ([API v3 docs](https://api.core.ac.uk/docs/v3)).

**Rate limits / key.** Token based: unauthenticated users get "100 tokens per day, maximum 10 per minute", registered personal users "1,000 tokens per day, maximum 25 per minute". A simple query costs 1 token, complex ones 3–5 ([API v3 docs](https://api.core.ac.uk/docs/v3)). *Observed*: the first unauthenticated call returned 429.

**Abstracts / full text.** A full-text field exists, but "Full-text is not available for unauthenticated API users" ([API v3 docs](https://api.core.ac.uk/docs/v3)). Licensing follows each repository copy (not verified further).

**Identifiers.** `doi`, `arxivId` (searchable, e.g. `q=arxivId:1905.13497`), CORE id ([API v3 docs](https://api.core.ac.uk/docs/v3)).

## 9. DBLP

**Coverage.** Computer-science bibliography: strong venue coverage for HCI and AI conferences. Metadata is "released as open data under CC0 1.0" ([FAQ](https://dblp.org/faqdblp.html), via search excerpt). The FAQ has an entry "Why are there no abstracts in dblp?" (same page), so it is of no use for abstract ranking.

**Access.** *Observed*: dblp.org, **including** `/search/publ/api`, now sits behind an Anubis proof-of-work bot challenge, so scripted calls from this machine got the challenge page rather than JSON. Not viable for an unattended bot.

**Identifiers.** DBLP key; links to DOI/arXiv.

## 10. ACL Anthology

**Coverage.** All ACL/EMNLP/NAACL papers and workshops: agents/LLMs and context-management work that sometimes isn't on arXiv. Papers from 2016 on are CC BY 4.0 ([FAQ](https://aclanthology.org/faq/)).

**New since T.** The RSS feed `https://aclanthology.org/papers/index.xml` holds the "latest 1,000 papers added" ([FAQ](https://aclanthology.org/faq/)). *Observed*: items carry title, link, `pubDate`, Anthology id, and authors + venue in `<description>`, but **no abstract**. Abstracts come from the bulk `anthology+abstracts.bib.gz`, the GitHub XML data, or the `acl-anthology` PyPI package. There is no web API ([FAQ](https://aclanthology.org/faq/)).

**Identifiers.** Anthology id (e.g. `2026.impactspeech-1.1`). Semantic Scholar exposes `ACL` ids in `externalIds` (§5).

Verdict: most ACL papers also appear on arXiv (cs.CL) and in OpenAlex, so skip in v1.

## Coverage matrix

Coverage of *new* Papers per Interest. ●●● primary, ●● good, ● partial, – none.

| Source | AI in higher ed | Agents/LLMs | AI in HCI | Context mgmt | Multimodal / new models | Wildcards | New-since-T | Key |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arXiv | ● (cs.CY) | ●●● | ●● (cs.HC) | ●●● | ●●● | ●● cross-lists | ●●● RSS daily + API by `submittedDate` | none |
| OpenAlex | ●●● (subfield 3304) | ●● | ●●● (1709, ACM) | ●● | ●● | ●●● any field | ● publication-date window + dedupe (created-since is paid) | free (recommended) |
| ERIC | ●●● (`educationlevel`) | – | ● | – | – | – | ● year-added + dedupe | none |
| HF daily papers | – | ●● (curated) | – | ● | ●● (curated) | – | ●●● by `date` | none |
| Semantic Scholar | ●● | ●● | ●● | ●● | ●● | ●●● | ● publication date only | effectively required |
| ACM DL | ●● (SIGCSE, L@S) | ● | ●●● (CHI, CSCW) | ● | ● | ● | – no API; via OpenAlex/Crossref | n/a |
| Crossref | ● | ● | ●● (ACM) | ● | ● | ● | ●●● created-since | none (`mailto`) |
| CORE | ●● | ● | ● | ● | ● | ●● | ●● createdDate | free, tight quota |
| DBLP | – | ● | ●● | ● | ● | – | – bot wall | n/a |
| ACL Anthology | – | ●● | – | ●● | ● | – | ●● RSS, no abstracts | none |

## Recommended v1 set

1. **arXiv: the backbone.** Daily: one combined RSS fetch for `cs.AI+cs.CL+cs.LG+cs.CV+cs.HC+cs.CY+cs.MA`, keeping `new` and `cross` and dropping `replace*`. Catch-up for missed days: the query API with `submittedDate` ranges, 3 s apart. It covers four of five Interests on its own, gives abstracts and full text in one place under terms that allow personal and research reading, and needs no key. Whether to add cs.IR, and how to cut ~500 entries a day down for ranking, is for the ranking ticket.
2. **OpenAlex (free key): the peer-reviewed half.** It is the only practical route to ACM HCI and education venues with usable abstracts (91% vs Crossref's 13% for ACM), and it covers Wildcards in any field. Query subfields 3304 (Education) and 1709 (HCI), plus 1702 if non-arXiv AI matters, over a rolling publication-date window, and dedupe against the seen-Papers store. Budget: a few list calls a day against $1/day. The Member+ plan for true created-since is not worth $10k/yr.
3. **ERIC: AI in higher education precision.** `educationlevel:"Higher Education"` plus AI terms, `e_yearadded` = current year, dedupe by ERIC id. Free, no key, every record has an abstract. It is the weakest "since T" here, but at ~6 relevant records a day a full re-pull of the year is a few `rows=2000` pages.
4. **Hugging Face daily papers: a signal, not a corpus.** One call per day (`date=`). It overlaps arXiv completely, so it adds upvotes, GitHub stars and project links to arXiv Papers already fetched. Whether and how that affects ranking is the ranking ticket's call. Cheapest to drop if v1 must shrink.

Not in v1: Semantic Scholar (key needed, no created-since filter, attribution terms; keep in mind as an id resolver), Crossref (subsumed by OpenAlex), ACM DL (no API, robots barred), CORE (tight quota, no full text without registration), DBLP (bot wall, no abstracts), ACL Anthology (no abstracts in feed, overlaps arXiv).

### Recognising one Paper across sources

| Source | Ids it gives |
| --- | --- |
| arXiv | arXiv id; DOI `10.48550/arXiv.<id>`; optional journal DOI |
| OpenAlex | W-id, DOI (often the arXiv DOI for preprints), PMID/PMCID; no arXiv field |
| ERIC | ERIC id; DOI only inside `url` |
| HF daily | arXiv id |
| Semantic Scholar | CorpusId plus ArXiv, DOI, ACL, DBLP, PubMed, MAG |

Normalise DOIs to lower case without the `https://doi.org/` / `http://dx.doi.org/` prefix, map arXiv ids to `10.48550/arxiv.<id>` (version stripped), and store a set of ids per Paper. A preprint and its venue version can arrive with two different DOIs and no shared id. Linking those needs a title match or a Semantic Scholar lookup, which is a store-design question for a later ticket.

## Open points for other tickets

- Ranking: ~500 arXiv entries a day for the chosen categories (*observed* on a Monday) is the input size. Pre-filtering is a ranking/pipeline decision.
- First run and catch-up (map issue #1, "Not yet specified"): arXiv RSS can't backfill. The API can, and so can OpenAlex/ERIC/HF by date.
- Keys to provision: an OpenAlex free key (needs Chris's email confirmation). Optional: a `mailto` for Crossref, an HF token.
