"""nfl_knowledge.py - the staff's nightly film study.

Pulls this season's NFL data from nflverse (free, updated daily) and boils it down to what
the Head Coach, Scout and Analyst need: who is trending up or down, who gets the ball, who is
on the field, and which defenses give up the most fantasy points to each position.
Writes data/nfl/knowledge.json. GitHub Actions runs it every night.
"""
import datetime as dt
import json
import os
import re

POS = ["QB", "RB", "WR", "TE"]


def season_now():
    t = dt.date.today()
    return t.year if t.month >= 8 else t.year - 1


def load(season):
    import nflreadpy as nfl  # installed on GitHub Actions
    ps = nfl.load_player_stats([season]).to_pandas()
    try:
        sn = nfl.load_snap_counts([season]).to_pandas()
    except Exception as e:  # snap counts are a bonus, never block the rest
        print("snap counts unavailable:", e)
        sn = None
    return ps, sn


def key(name):
    """Normalize a player name so nflverse and Sleeper names line up."""
    n = re.sub(r"[^a-z0-9 ]", "", str(name).lower())
    n = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", n)
    return " ".join(n.split())


def col(df, *names):
    return next((c for c in names if c in df.columns), None)


def r2(x):
    try:
        return None if x != x else round(float(x), 2)  # NaN check
    except Exception:
        return None


def build(ps, sn, season):
    if "season_type" in ps.columns:
        ps = ps[ps["season_type"] == "REG"]
    team, name = col(ps, "team", "recent_team"), col(ps, "player_display_name", "player_name")
    opp, pts = col(ps, "opponent_team", "opponent"), col(ps, "fantasy_points_ppr")
    ps = ps[ps["position"].isin(POS)].copy()
    last_week = int(ps["week"].max())

    # snap share in each player's most recent game
    snaps = {}
    if sn is not None and len(sn):
        sname, steam = col(sn, "player", "player_name"), col(sn, "team")
        if sname and "offense_pct" in sn.columns:
            for _, r in sn.sort_values("week").iterrows():
                pct = r["offense_pct"]
                snaps[key(r[sname])] = r2(pct * 100 if pct <= 1 else pct)

    players = {}
    for _, g in ps.sort_values("week").groupby("player_id"):
        last = g.iloc[-1]
        recent = g.tail(3)
        games = len(g)
        avg = lambda c, d=g: r2(d[c].mean()) if c and c in d.columns else None
        season_avg, l3 = avg(pts), avg(pts, recent)
        p = {
            "name": last[name], "pos": last["position"], "team": last[team], "games": games,
            "last_week": int(last["week"]),
            "ppr_avg": season_avg, "ppr_last3": l3,
            "trend": r2((l3 or 0) - (season_avg or 0)),
            "ppr_floor": r2(g[pts].quantile(0.2)) if games >= 3 else None,  # a bad week for him
            "ppr_ceiling": r2(g[pts].quantile(0.8)) if games >= 3 else None,  # a good week for him
            "target_share": avg(col(g, "target_share"), recent),
            "targets_pg": avg(col(g, "targets"), recent),
            "carries_pg": avg(col(g, "carries"), recent),
            "snap_pct": snaps.get(key(last[name])),
        }
        players[key(last[name])] = {k: v for k, v in p.items() if v is not None}

    # fantasy points each defense allows to each position, per game (rank 1 = allows the most)
    defense = {}
    if opp:
        per_game = ps.groupby([opp, "position", "week"])[pts].sum().reset_index()
        allowed = per_game.groupby([opp, "position"])[pts].mean().reset_index()
        for pos in POS:
            rows = allowed[allowed["position"] == pos].sort_values(pts, ascending=False)
            for rank, (_, r) in enumerate(rows.iterrows(), 1):
                defense.setdefault(r[opp], {})[pos] = {"rank": rank, "ppr_allowed": r2(r[pts])}

    return {
        "made": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "season": season, "through_week": last_week,
        "notes": "ppr_* are PPR fantasy points per game. trend = last 3 games minus season average. "
                 "ppr_floor/ppr_ceiling are his 20th/80th percentile weeks. defense rank 1 = allows the most points to that position.",
        "players": players, "defense_vs_pos": defense,
    }


if __name__ == "__main__":
    season = int(os.environ.get("SEASON") or season_now())
    ps, sn = load(season)
    out = build(ps, sn, season)
    os.makedirs("data/nfl", exist_ok=True)
    with open("data/nfl/knowledge.json", "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"season {season} through week {out['through_week']}: {len(out['players'])} players, {len(out['defense_vs_pos'])} defenses")
