# paper-bot

paper-bot finds new research papers in Chris's areas of interest on a schedule, writes regular Briefings about them into the Vault, and makes them visible in homeros.

## Language

**Paper**:
One research publication paper-bot has found, preprint or peer-reviewed, identified across sources as the same work. A lab's own paper published only as a PDF or web page still counts. A lab blog post is not a Paper; one that announces a Paper only points to it.
_Avoid_: article, publication, result

**Interest**:
One research area Chris wants papers from, such as "AI in higher education" or "context management in AI".
_Avoid_: topic, category, keyword

**Interests Note**:
The Vault note where Chris lists his Interests; paper-bot reads it and never writes it.
_Avoid_: profile, config, preferences

**Venue**:
A conference or journal a Paper is published in, such as CHI or NeurIPS, named by its common name.
_Avoid_: source id, outlet, publication

**Candidate**:
A Paper paper-bot fetched for a Briefing, to be ranked once against the Interests; the best become Picks. A Candidate a Scan could not rank waits for the next Scan.
_Avoid_: result, hit, near miss

**Pick**:
A Paper paper-bot chose to write up in a Briefing.
_Avoid_: result, hit, recommendation

**Wildcard**:
A Pick outside every Interest, chosen because paper-bot judges it could still matter to Chris.
_Avoid_: bonus, serendipity pick, extra

**Scan**:
One scheduled execution of paper-bot: a Daily Scan fetches Candidates, ranks them and writes at most one Daily Briefing; a Weekly Scan fetches nothing and writes the Weekly Briefing from that week's Picks. A Scan with no Picks is skipped, not failed; a Scan fails only when it cannot settle its Briefing at all, and losing some sources or ranking batches only degrades it.
_Avoid_: run (a Brain-Dump Run is one set of Vault changes), job, pass

**Briefing**:
A scheduled write-up of Picks for one period: a Daily Briefing is named for the day its Scan ran and covers what appeared since the previous Scan; a Weekly Briefing covers one Monday-to-Sunday week and is drawn from that week's Daily Briefings.
_Avoid_: Digest, summary, roundup, report

**Keep**:
Chris marking a Pick in a Briefing as worth holding onto, which sends it to the Inbox for normal Filing.
_Avoid_: save, bookmark, star
