import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { Card, Badge, Button, Skeleton } from "./ui.js";
import { Avatar } from "./avatar.js";
import { FriendButton } from "./friendButton.js";
import { useT, getLocale } from "../lib/i18n.js";
import { useSession } from "../lib/auth.js";
import { useMountedValue } from "../lib/motion.js";
import { useFriendStatus, useFriendsCount } from "../lib/friendsStore.js";
import { cachedPerson, fetchPerson, toPerson } from "../lib/people.js";
import { useProfileViewer, openProfile, closeProfile } from "../lib/profileViewer.js";
import { navigate } from "../router.js";

/** The caller's version of the person is shown at once; the authoritative row
 * from profiles_public (cached for a minute) replaces it when it arrives, so a
 * leaderboard row with only a name still ends up with a bio, a role and a
 * @username. `done` turns true once that lookup has settled either way. */
function usePersonDetails(base) {
  const id = base?.id ?? null;
  const [state, setState] = useState({ id: null, person: null, done: false });
  useEffect(() => {
    if (!id) return undefined;
    const known = cachedPerson(id);
    if (known) { setState({ id, person: known, done: true }); return undefined; }
    let off = false;
    setState({ id, person: null, done: false });
    fetchPerson(id)
      .then((person) => { if (!off) setState({ id, person, done: true }); })
      .catch(() => { if (!off) setState({ id, person: null, done: true }); });
    return () => { off = true; };
  }, [id]);
  // Until the effect above has caught up with a new id, a person seen in the last minute is answered
  // from memory in that very render (no skeleton flash); afterwards the state is what counts.
  const caughtUp = state.id === id;
  const hit = id && !caughtUp ? cachedPerson(id) : null;
  const fetched = caughtUp ? state.person : hit;
  const done = !id || (caughtUp ? state.done : !!hit);
  const person = base && fetched ? { ...base, ...fetched, name: fetched.name ?? base.name } : base;
  return { person, done };
}

const nf = (n) => new Intl.NumberFormat(getLocale()).format(Math.round(n ?? 0));

function ArenaStrip({ arena, t }) {
  return html`
    <div class="sk-pstats" style="--cols:3" data-testid="profile-arena">
      <div class="sk-pstat"><div class="sk-pstat-label">${t("people.profile.place")}</div><div class="sk-pstat-value">${arena.rank ? `#${arena.rank}` : "—"}</div></div>
      <div class="sk-pstat"><div class="sk-pstat-label">${t("arena.level")}</div><div class="sk-pstat-value">${arena.level ?? "—"}</div></div>
      <div class="sk-pstat"><div class="sk-pstat-label">${t(arena.scope === "all" ? "people.profile.xpAll" : "people.profile.xpWeek")}</div><div class="sk-pstat-value">${nf(arena.xp)}</div></div>
    </div>
  `;
}

function ProfileActions({ person, isSelf, t }) {
  const { status } = useFriendStatus(person.id);
  if (!person.id) return null;
  if (isSelf) {
    return html`
      <div class="sk-profile-actions">
        <${Badge} tone="signal">${t("people.profile.you")}<//>
        <${Button} size="sm" variant="secondary" onClick=${() => { closeProfile(); navigate("/profile"); }}>
          <${Icon} name="user" size=${14} /> ${t("people.profile.openMine")}
        <//>
      </div>
    `;
  }
  return html`
    <div class="sk-profile-actions">
      <${FriendButton} targetUserId=${person.id} />
      ${status === "friends" && html`
        <${Button} size="sm" variant="secondary" onClick=${() => { closeProfile(); navigate(`/app/messages?with=${person.id}`); }}>
          <${Icon} name="chat" size=${14} /> ${t("friends.message")}
        <//>
      `}
    </div>
  `;
}

function ProfileCard({ view, mounted, phase, t }) {
  const { user } = useSession();
  const closeRef = useRef(null);
  const { person, done } = usePersonDetails(view?.person ?? null);
  const friendsCount = useFriendsCount(person?.id);

  // Escape closes it (and is marked handled, so the Arena's own Esc = "leave the round" stands down),
  // and so does the browser's back button.
  useEffect(() => {
    if (!mounted) return undefined;
    const previous = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeProfile();
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", closeProfile);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", closeProfile);
      if (previous?.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
  }, [mounted]);

  if (!mounted || !person) return null;
  const isSelf = !!person.id && person.id === user?.id;
  const name = person.name ?? t("feed.unknownAuthor");
  const arena = view?.arena;
  const bioPending = !person.bio && !done;
  const showFriends = Number.isFinite(friendsCount);
  const showStreak = arena?.streak > 0;

  return html`
    <div class="sk-backdrop-anim fixed inset-0 z-50 flex items-center justify-center bg-graphite-950/70 p-4" data-state=${phase} data-testid="profile-backdrop"
      onClick=${(e) => e.target === e.currentTarget && closeProfile()}>
      <${Card} className="sk-overlay-anim sk-overlay-anim-center sk-profile max-w-sm w-full p-5" data-state=${phase} role="dialog" aria-modal="true" aria-label=${name} data-testid="profile-card">
        <div class="sk-profile-head">
          <${Avatar} name=${person.name} url=${person.avatarUrl} size=${56} />
          <div class="sk-profile-id">
            <div class="sk-profile-name font-semibold text-graphite-100" data-testid="profile-name">${name}</div>
            ${person.username && html`<div class="sk-profile-handle" data-testid="profile-username">@${person.username}</div>`}
            ${person.roleTitle && html`<div class="sk-profile-role text-sm text-graphite-400">${person.roleTitle}</div>`}
          </div>
          <button type="button" ref=${closeRef} onClick=${closeProfile} aria-label=${t("common.close")} class="sk-profile-close">
            <${Icon} name="close" size=${16} />
          </button>
        </div>

        ${arena && html`<${ArenaStrip} arena=${arena} t=${t} />`}
        ${(showFriends || showStreak) && html`
          <div class="sk-profile-chips">
            ${showStreak && html`<span class="sk-pchip" title=${t("arena.quests.streakTitle")}><${Icon} name="flame" size=${13} /> ${arena.streak}</span>`}
            ${showFriends && html`<span class="sk-pchip" data-testid="profile-friends"><${Icon} name="friends" size=${13} /> ${t("friends.countLabel", { count: friendsCount })}</span>`}
          </div>
        `}

        ${bioPending
          ? html`<div class="sk-profile-bio"><${Skeleton} className="h-3 w-full" /><${Skeleton} className="h-3 w-2/3 mt-2" /></div>`
          : html`<p class="sk-profile-bio ${person.bio ? "" : "sk-profile-bio-empty"}">${person.bio || t("feed.noBio")}</p>`}

        <${ProfileActions} person=${person} isSelf=${isSelf} t=${t} />
      <//>
    </div>
  `;
}

/** Mounted once in the shell: shows whichever profile openProfile() last asked for. */
export function ProfileViewerHost() {
  const t = useT();
  const view = useProfileViewer();
  const { mounted, phase, value } = useMountedValue(view);
  return html`<${ProfileCard} view=${value} mounted=${mounted} phase=${phase} t=${t} />`;
}

/** Avatar + name (anything you put inside) as ONE button that opens that
 * person's profile. `who` is anything toPerson() understands. */
export function PersonLink({ who, arena, className = "", children }) {
  const t = useT();
  const person = toPerson(who);
  const label = person?.name ?? t("feed.unknownAuthor");
  return html`
    <button type="button" class=${`sk-person ${className}`} onClick=${() => openProfile(who, { arena })}
      title=${t("people.openProfile", { name: label })} data-testid="person-link">
      ${children}
    </button>
  `;
}
