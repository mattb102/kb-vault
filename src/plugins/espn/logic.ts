const LEAGUE_ID = process.env.ESPN_LEAGUE_ID || "253361692";
const SEASON = process.env.ESPN_SEASON || "2026";
const SWID = process.env.ESPN_SWID || "46725353-DEC6-4B32-B253-53DEC62B3262";
const ESPN_S2 =
  process.env.ESPN_S2 ||
  "AEBZyVoV%2BTgrWjtxB5DOVym8L6rC7vJlv8Su1%2FH56Br25GxB2dSdWZH99wLezVjFG4h2zL5%2B3cwzBkiArjf6wc%2B%2FLQ97kGkHVw8yN8WxzMfl3ckEjdHJTGYy5C4LHrV%2FGQo7ixsUnMW5XTrg7DEwjLGTLe9pAA9igH%2B13YCKQt2n8Mv2xddup2%2FLyFYXSA8%2FL9c%2FD1lEx74ajQg%2FACMMPXc19yhCXAUwuxc0g72iX7d388cgmqEgMxmiSbCUcsukMQLmBIIv0OTmnkVH9jcii3bEeJE3D2T4sw1V8UMu%2F%2FLdrQ%3D%3D";

const TEAM_NAME = "The Predators";
const BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;
const MLB_STATS_API = "https://statsapi.mlb.com/api/v1";

async function espnGet(views: string[]): Promise<any> {
  const url = `${BASE}?${views.map((v) => `view=${v}`).join("&")}`;
  const res = await fetch(url, {
    headers: {
      Cookie: `SWID=${SWID}; espn_s2=${ESPN_S2}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`ESPN API failed: ${res.status}`);
  return res.json();
}

/**
 * Get current standings for all teams.
 */
export async function getStandings(): Promise<string> {
  const data = await espnGet(["mTeam"]);
  const teams = (data.teams || []).sort((a: any, b: any) => {
    const aw = a.record?.overall?.wins || 0;
    const bw = b.record?.overall?.wins || 0;
    if (bw !== aw) return bw - aw;
    return (b.points || 0) - (a.points || 0);
  });

  return teams
    .map((t: any, i: number) => {
      const r = t.record?.overall || {};
      return `${i + 1}. **${t.name}** — ${r.wins || 0}-${r.losses || 0}-${r.ties || 0} (${t.points || 0} pts)`;
    })
    .join("\n");
}

/**
 * Get detailed roster with actual and projected stats.
 */
export async function getRosterWithStats(teamName: string = TEAM_NAME): Promise<string> {
  const data = await espnGet(["mRoster", "mTeam", "kona_player_info"]);
  const team = (data.teams || []).find((t: any) => t.name === teamName);
  if (!team) return `Team "${teamName}" not found.`;

  const rec = team.record?.overall || {};
  const roster = team.roster?.entries || [];

  const lines: string[] = [
    `**${team.name}** — ${rec.wins || 0}-${rec.losses || 0}-${rec.ties || 0} (${team.points || 0} pts)`,
    "",
    "| Player | Pos | Injured | Actual | Projected |",
    "|--------|-----|---------|--------|-----------|",
  ];

  for (const entry of roster) {
    const player = entry.playerPoolEntry?.player || {};
    const name = player.fullName || "?";
    const injured = player.injured ? "YES" : "";
    const posId = player.defaultPositionId;
    const posMap: Record<number, string> = {
      1: "SP", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS",
      7: "OF", 8: "OF", 9: "OF", 10: "DH", 11: "RP", 12: "SP",
    };
    const pos = posMap[posId] || "?";

    const stats = player.stats || [];
    const seasonActual = stats.find(
      (s: any) => s.seasonId === parseInt(SEASON) && s.statSourceId === 0 && s.statSplitTypeId === 0
    );
    const seasonProj = stats.find(
      (s: any) => s.seasonId === parseInt(SEASON) && s.statSourceId === 1 && s.statSplitTypeId === 0
    );

    const actual = (seasonActual?.appliedTotal || 0).toFixed(1);
    const proj = (seasonProj?.appliedTotal || 0).toFixed(1);

    lines.push(`| ${name} | ${pos} | ${injured} | ${actual} | ${proj} |`);
  }

  return lines.join("\n");
}

/**
 * Get current week matchup for a team.
 */
export async function getMatchup(teamName: string = TEAM_NAME): Promise<string> {
  const data = await espnGet(["mMatchup", "mTeam", "mSettings"]);
  const teams = data.teams || [];
  const team = teams.find((t: any) => t.name === teamName);
  if (!team) return `Team "${teamName}" not found.`;

  // currentMatchupPeriod is the actual week number in fantasy baseball
  const currentWeek = data.status?.currentMatchupPeriod || 1;
  const schedule = data.schedule || [];

  // Find matchup for current week
  const matchup = schedule.find(
    (m: any) =>
      m.matchupPeriodId === currentWeek &&
      (m.home?.teamId === team.id || m.away?.teamId === team.id)
  );

  if (!matchup) return `No current matchup found for ${teamName} in week ${currentWeek}.`;

  const homeTeam = teams.find((t: any) => t.id === matchup.home?.teamId);
  const awayTeam = teams.find((t: any) => t.id === matchup.away?.teamId);
  const homeScore = matchup.home?.totalPoints || 0;
  const awayScore = matchup.away?.totalPoints || 0;

  return `**Week ${currentWeek} Matchup:**
${awayTeam?.name || "?"}: ${awayScore}
${homeTeam?.name || "?"}: ${homeScore}`;
}

/**
 * Get recent MLB stats for a specific player by name.
 * Uses the free MLB StatsAPI.
 */
export async function getPlayerStats(playerName: string): Promise<string> {
  // Search for player
  const searchRes = await fetch(
    `${MLB_STATS_API}/people/search?names=${encodeURIComponent(playerName)}`
  );
  const searchData = await searchRes.json();
  const people = searchData.people || [];
  if (people.length === 0) return `No MLB player found matching "${playerName}".`;

  const player = people[0];
  const playerId = player.id;
  const fullName = player.fullName;

  // Get pitching game log
  const pitchRes = await fetch(
    `${MLB_STATS_API}/people/${playerId}/stats?stats=gameLog&season=${SEASON}&group=pitching`
  );
  const pitchData = await pitchRes.json();
  const pitchGames = pitchData.stats?.[0]?.splits || [];

  // Get hitting game log
  const hitRes = await fetch(
    `${MLB_STATS_API}/people/${playerId}/stats?stats=gameLog&season=${SEASON}&group=hitting`
  );
  const hitData = await hitRes.json();
  const hitGames = hitData.stats?.[0]?.splits || [];

  const lines = [`**${fullName}** — ${SEASON} season`];

  if (pitchGames.length > 0) {
    lines.push("", "**Pitching (last 10 games):**");
    lines.push("| Date | Opp | IP | H | ER | BB | K |");
    lines.push("|------|-----|-----|---|-----|-----|---|");
    for (const g of pitchGames.slice(0, 10)) {
      const s = g.stat || {};
      const opp = g.opponent?.name || "?";
      lines.push(
        `| ${g.date} | ${opp.slice(0, 15)} | ${s.inningsPitched || "?"} | ${s.hits || 0} | ${s.earnedRuns || 0} | ${s.baseOnBalls || 0} | ${s.strikeOuts || 0} |`
      );
    }
  }

  if (hitGames.length > 0) {
    lines.push("", "**Hitting (last 10 games):**");
    lines.push("| Date | Opp | AB | H | HR | RBI | BB | K | AVG |");
    lines.push("|------|-----|-----|---|-----|-----|-----|---|-----|");
    for (const g of hitGames.slice(0, 10)) {
      const s = g.stat || {};
      const opp = g.opponent?.name || "?";
      lines.push(
        `| ${g.date} | ${opp.slice(0, 15)} | ${s.atBats || 0} | ${s.hits || 0} | ${s.homeRuns || 0} | ${s.rbi || 0} | ${s.baseOnBalls || 0} | ${s.strikeOuts || 0} | ${s.avg || ".000"} |`
      );
    }
  }

  if (pitchGames.length === 0 && hitGames.length === 0) {
    lines.push(`No ${SEASON} game log found.`);
  }

  return lines.join("\n");
}
