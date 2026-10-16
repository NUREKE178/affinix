// How the community answered the daily challenge, and who thinks most like you.
import { html, useState, useEffect, useMemo } from "../../lib/preact.js";
import { Badge, Skeleton } from "../../components/ui.js";
import { Avatar } from "../../components/avatar.js";
import { PersonLink } from "../../components/profileViewer.js";
import { useT } from "../../lib/i18n.js";
import { planDaily } from "../../lib/arena/sampler.js";
import { seasonOf } from "../../lib/arena/rules.js";
import { fetchDailyReport, answeredPick } from "../../lib/arenaStore.js";
import { Thumb } from "./parts.js";

export function DailyReport({ day, season = seasonOf() }) {
  const t = useT();
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const duels = useMemo(() => planDaily(day, season), [day, season]);

  useEffect(() => {
    let off = false;
    setState({ loading: true, data: null, error: null });
    fetchDailyReport(day)
      .then((data) => !off && setState({ loading: false, data, error: null }))
      .catch((error) => !off && setState({ loading: false, data: null, error }));
    return () => { off = true; };
  }, [day]);

  const split = new Map((state.data?.split ?? []).map((s) => [`${s.pair}|${s.dim}`, s]));
  const twins = state.data?.twins ?? [];

  return html`
    <section class="ar-report sk-panel" data-testid="arena-report">
      <div class="ar-report-head">
        <span class="sk-caption">${t("arena.report.title")}</span>
        <span class="ar-report-sub">${t("arena.report.sub")}</span>
      </div>
      <div class="ar-report-list">
        ${duels.map((d) => {
          const mine = answeredPick(d.season, d.family, d.a, d.b, d.dim);
          const sp = split.get(`${d.pair}|${d.dim}`);
          const total = sp ? sp.a + sp.b : 0;
          const pa = total ? Math.round((sp.a / total) * 100) : null;
          return html`
            <div class="ar-report-row" key=${d.id} data-mine=${mine === null ? "none" : mine === 0 ? "a" : "b"}>
              <div class="ar-report-thumbs">
                <span class="ar-report-thumb" data-picked=${mine === 0}><${Thumb} season=${d.season} family=${d.family} index=${d.a} size=${52} /></span>
                <span class="ar-report-thumb" data-picked=${mine === 1}><${Thumb} season=${d.season} family=${d.family} index=${d.b} size=${52} /></span>
              </div>
              <div class="ar-report-main">
                <div class="ar-report-q">${t(`arena.family.${d.family}`)} · ${t(`builder.dimensions.${d.dim}.label`)}</div>
                ${state.loading
                  ? html`<${Skeleton} className="h-2 w-full rounded-full" />`
                  : total > 0
                    ? html`
                      <div class="ar-split" aria-hidden="true"><i style=${{ width: `${pa}%` }} data-picked=${mine === 0}></i><i style=${{ width: `${100 - pa}%` }} data-picked=${mine === 1}></i></div>
                      <div class="ar-report-nums sk-num">${pa}%<span class="sk-unit">·</span>${100 - pa}%<span class="sk-unit">${t("arena.console.votes")}: ${total}</span></div>`
                    : html`<div class="ar-report-nums ar-muted">${state.error ? t("arena.report.offline") : t("arena.report.noData")}</div>`}
              </div>
            </div>
          `;
        })}
      </div>
      <div class="ar-twins">
        <div class="sk-caption">${t("arena.report.twins")}</div>
        ${state.loading
          ? html`<${Skeleton} className="h-10 w-full rounded-lg" />`
          : twins.length
            ? twins.map((u) => html`
                <div class="ar-twin" key=${u.userId} data-testid="arena-twin">
                  <${PersonLink} who=${u} className="sk-person-grow">
                    <${Avatar} name=${u.name} url=${u.avatarUrl} size=${32} />
                    <div class="ar-twin-who"><div class="ar-twin-name">${u.name ?? t("feed.unknownAuthor")}</div>${u.username && html`<div class="ar-twin-user">@${u.username}</div>`}</div>
                  <//>
                  ${u.isFriend && html`<${Badge} tone="steel">${t("arena.report.friend")}<//>`}
                  <span class="ar-twin-score sk-num">${Math.round((u.agree / u.shared) * 100)}<span class="sk-unit">%</span></span>
                </div>`)
            : html`<p class="ar-muted ar-twins-empty">${t("arena.report.twinsEmpty")}</p>`}
      </div>
    </section>
  `;
}
