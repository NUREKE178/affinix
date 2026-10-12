import { html, useState, useEffect, useRef } from "../lib/preact.js";
import { Icon } from "./icons.js";
import { toast } from "./ui.js";
import { useT } from "../lib/i18n.js";
import { useFriendStatus, sendFriendRequest, acceptFriendRequest, removeFriendship } from "../lib/friendsStore.js";

/** Add Friend / Request Sent / Accept Request / Friends -- one button whose
 * action and label both follow from useFriendStatus(), the same status the
 * server itself would derive (send_friend_request/accept_friend_request
 * reject anything the button shouldn't have allowed in the first place, so
 * this is UX, not the real boundary).
 *
 * The "Friends" state needs its own confirm step before it actually
 * removes anyone -- unlike cancelling a pending request, unfriending isn't
 * something a stray tap should do instantly, and hover alone can't guard
 * that on a touch device. First click/tap relabels to "Remove friend?" for
 * a few seconds (or until the pointer leaves, on desktop); a second click
 * in that window is what actually removes. */
export function FriendButton({ targetUserId, className = "" }) {
  const t = useT();
  const { status, friendshipId, loading } = useFriendStatus(targetUserId);
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [popping, setPopping] = useState(false);
  const seenStatus = useRef(status);
  const confirmTimer = useRef(null);

  // Replays once per real status change (not on mount) -- same
  // ref-diff-and-toggle convention as the notification bell's ring.
  useEffect(() => {
    if (seenStatus.current === status) return undefined;
    seenStatus.current = status;
    setConfirmingRemove(false);
    setPopping(true);
    const timer = setTimeout(() => setPopping(false), 320);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  if (status === "self" || status === "signed_out") return null;

  async function runAction(kind) {
    if (busy) return;
    setBusy(true);
    try {
      if (kind === "send") await sendFriendRequest(targetUserId);
      else if (kind === "cancel" || kind === "remove") await removeFriendship(friendshipId);
      else if (kind === "accept") await acceptFriendRequest(friendshipId);
    } catch (err) {
      toast(err.message ?? String(err), "rose");
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  }

  function onClick() {
    if (status === "none") return runAction("send");
    if (status === "pending_outgoing") return runAction("cancel");
    if (status === "pending_incoming") return runAction("accept");
    if (status === "friends") {
      if (confirmingRemove) return runAction("remove");
      setConfirmingRemove(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingRemove(false), 3000);
    }
    return undefined;
  }

  const META = {
    none: { icon: "userPlus", labelKey: "friends.addFriend", primary: true },
    pending_outgoing: { icon: "clock", labelKey: "friends.requestSent", primary: false },
    pending_incoming: { icon: "check", labelKey: "friends.acceptRequest", primary: true },
    friends: confirmingRemove
      ? { icon: "close", labelKey: "friends.removeFriendConfirm", primary: false, danger: true }
      : { icon: "userCheck", labelKey: "friends.friends", primary: false },
  };
  const meta = META[status] ?? META.none;

  return html`
    <button type="button" onClick=${onClick} disabled=${busy || loading}
      onMouseLeave=${() => status === "friends" && setConfirmingRemove(false)}
      aria-label=${t(meta.labelKey)}
      class=${`sk-btn ${meta.primary ? "sk-btn-primary" : ""} inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${meta.danger ? "text-rose-300" : ""} ${popping ? "sk-btn-state-pop" : ""} ${className}`}
    >
      <${Icon} name=${meta.icon} size=${15} />
      ${t(meta.labelKey)}
    <//>
  `;
}
