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

**Pick**:
A Paper paper-bot chose to write up in a Briefing.
_Avoid_: result, hit, recommendation

**Wildcard**:
A Pick outside every Interest, chosen because paper-bot judges it could still matter to Chris.
_Avoid_: bonus, serendipity pick, extra

**Briefing**:
A scheduled write-up of Picks for one period: a Daily Briefing covers one day, a Weekly Briefing covers one week and is drawn from that week's Daily Briefings.
_Avoid_: Digest, summary, roundup, report

**Keep**:
Chris marking a Pick in a Briefing as worth holding onto, which sends it to the Inbox for normal Filing.
_Avoid_: save, bookmark, star
